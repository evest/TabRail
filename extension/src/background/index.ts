// Service worker entry. Owns all state; rebuilds it from Chrome on every start (hard rule 4).
// Only the MRU history survives restarts, in chrome.storage.session; sidebar-only UI state
// (collapse, rail pins) lives in chrome.storage.local.

import { DEFAULT_SETTINGS, PORT_NAME } from '../shared/protocol';
import type { FromUi, Settings, ToUi } from '../shared/protocol';
import { TabStore, type RailPin, type WindowName } from './tabStore';
import { buildSnapshot } from './snapshot';
import { FaviconCache, extensionFaviconFetcher } from './favicons';
import { SnapshotScheduler } from './scheduler';
import type { RawTab } from './model';

const SIDEBAR_PATH = 'sidebar.html';
const sidebarUrl = chrome.runtime.getURL(SIDEBAR_PATH);

const store = new TabStore(sidebarUrl);
const favicons = new FaviconCache(extensionFaviconFetcher(chrome.runtime.getURL('/_favicon/')));
let settings: Settings = { ...DEFAULT_SETTINGS };

/** Anything the UI is reachable through. Phase B adds the native-messaging port here. */
interface UiSink {
  post(msg: ToUi): void;
}
const sinks = new Set<UiSink>();

function broadcast(msg: ToUi): void {
  for (const s of sinks) {
    try {
      s.post(msg);
    } catch {
      sinks.delete(s);
    }
  }
}

const scheduler = new SnapshotScheduler(50, (seq) => {
  store.reattachPins();
  store.reattachNames();
  broadcast({ type: 'snapshot', snapshot: buildSnapshot(store, seq, settings, favicons) });
  void persist();
});

/** Last saved window names (JSON), so they are only written when something changed. */
let savedNames = '[]';

async function persist(): Promise<void> {
  // Names carry their windows' URLs for re-matching after a restart, so they change as tabs do.
  const names = JSON.stringify(store.windowNamesForStorage());
  if (names !== savedNames) {
    savedNames = names;
    await chrome.storage.local.set({ windowNames: JSON.parse(names) as WindowName[] });
  }
  if (store.dirty.mru) {
    store.dirty.mru = false;
    await chrome.storage.session.set({ mru: store.mru });
  }
  if (store.dirty.collapsed) {
    store.dirty.collapsed = false;
    await chrome.storage.local.set({
      collapsed: { windows: [...store.collapsedWindows], groups: [...store.collapsedGroups] },
    });
  }
  if (store.dirty.pins) {
    store.dirty.pins = false;
    await chrome.storage.local.set({ railPins: store.railPinsForStorage() });
  }
}

/**
 * `status: complete` often fires before Chrome has stored the page's favicon, so we also retry
 * (bypassing the cooldown) when onUpdated reports a favIconUrl change. We never use that URL itself.
 */
function ensureFavicon(tab: RawTab, faviconChanged = false): void {
  if (!tab.url || (tab.status !== 'complete' && !faviconChanged)) return;
  void favicons.ensure(tab.url, faviconChanged).then((added) => added && scheduler.schedule());
}

// ---- startup ------------------------------------------------------------------

async function init(): Promise<void> {
  const [windows, groups, lastFocused, session, local] = await Promise.all([
    chrome.windows.getAll({ populate: true }),
    chrome.tabGroups.query({}),
    chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => undefined),
    chrome.storage.session.get('mru'),
    chrome.storage.local.get(['collapsed', 'settings', 'railPins', 'windowNames']),
  ]);
  const collapsed = (local.collapsed ?? {}) as { windows?: number[]; groups?: number[] };
  settings = { ...DEFAULT_SETTINGS, ...((local.settings as Partial<Settings>) ?? {}) };
  store.init({
    windows,
    groups,
    focusedWindowId: lastFocused?.id ?? null,
    mru: (session.mru as Record<number, number>) ?? {},
    collapsedWindows: collapsed.windows,
    collapsedGroups: collapsed.groups,
    railPins: (local.railPins as RailPin[] | undefined) ?? [],
    windowNames: (local.windowNames as WindowName[] | undefined) ?? [],
  });
  savedNames = JSON.stringify(local.windowNames ?? []);
  for (const t of store.tabs.values()) ensureFavicon(t);
  scheduler.schedule();
}

const ready = init();

/** Listeners must be registered synchronously; they apply in order once init has finished. */
function on<A extends unknown[]>(fn: (...args: A) => void | Promise<void>): (...args: A) => void {
  return (...args) => {
    void ready
      .then(() => fn(...args))
      .then(() => scheduler.schedule())
      .catch((e) => console.error('[TabRail]', e));
  };
}

// ---- Chrome events --------------------------------------------------------------

chrome.tabs.onCreated.addListener(
  on((tab) => {
    store.tabCreated(tab);
    ensureFavicon(tab);
  }),
);
chrome.tabs.onUpdated.addListener(
  on((_id, change, tab) => {
    store.tabUpdated(tab);
    if (change.status === 'complete' || change.favIconUrl) ensureFavicon(tab, !!change.favIconUrl);
  }),
);
chrome.tabs.onRemoved.addListener(on((id, info) => store.tabRemoved(id, info.isWindowClosing)));
chrome.tabs.onMoved.addListener(on((id, info) => store.tabMoved(id, info.windowId, info.toIndex)));
chrome.tabs.onDetached.addListener(on((id) => store.tabDetached(id)));
chrome.tabs.onAttached.addListener(
  on((id, info) => store.tabAttached(id, info.newWindowId, info.newPosition)),
);
chrome.tabs.onActivated.addListener(
  on((info) => store.tabActivated(info.tabId, info.windowId, Date.now())),
);
chrome.tabs.onReplaced.addListener(
  on(async (added, removed) => {
    const tab = await chrome.tabs.get(added).catch(() => undefined);
    if (tab) store.tabReplaced(removed, tab);
    else store.tabRemoved(removed);
  }),
);

chrome.windows.onCreated.addListener(on((w) => store.windowCreated(w)));
chrome.windows.onRemoved.addListener(on((id) => store.windowRemoved(id)));
chrome.windows.onFocusChanged.addListener(
  on(async (id) => {
    store.windowFocused(id, Date.now());
    // There is no minimize event; focus changes are the cheapest moment to refresh states.
    const all = await chrome.windows.getAll();
    for (const w of all) if (w.id != null) store.windowStateChanged(w.id, w.state ?? 'normal');
  }),
);
chrome.windows.onBoundsChanged.addListener(
  on(async (w) => {
    if (w.id == null) return;
    store.windowStateChanged(w.id, w.state ?? 'normal');
    if (w.id === store.sidebarWindowId && w.state === 'normal') {
      const { left, top, width, height } = w;
      await chrome.storage.local.set({ sidebarBounds: { left, top, width, height } });
    }
  }),
);

chrome.tabGroups.onCreated.addListener(on((g) => store.groupUpserted(g)));
chrome.tabGroups.onUpdated.addListener(on((g) => store.groupUpserted(g)));
chrome.tabGroups.onRemoved.addListener(on((g) => store.groupRemoved(g.id)));

chrome.storage.onChanged.addListener(
  on((changes, area) => {
    if (area === 'local' && changes.settings) {
      settings = {
        ...DEFAULT_SETTINGS,
        ...((changes.settings.newValue as Partial<Settings>) ?? {}),
      };
    }
  }),
);

// ---- sidebar window (Phase A) ----------------------------------------------------

/** Focuses the existing sidebar window or creates one. Returns true if it already existed. */
async function openOrFocusSidebar(): Promise<boolean> {
  await ready;
  const id = store.sidebarWindowId;
  if (id != null) {
    try {
      await chrome.windows.update(id, { focused: true });
      return true;
    } catch {
      store.setSidebarWindow(null);
    }
  }
  const saved = (await chrome.storage.local.get('sidebarBounds')).sidebarBounds as
    chrome.windows.CreateData | undefined;
  const w = await chrome.windows.create({
    type: 'popup',
    url: SIDEBAR_PATH,
    ...(saved ?? (await defaultBounds())),
  });
  if (w?.id != null) store.setSidebarWindow(w.id);
  scheduler.schedule();
  return false;
}

/** Left edge, 300 px wide, full height. The SW has no `screen`, so borrow the last normal window's frame. */
async function defaultBounds(): Promise<chrome.windows.CreateData> {
  const ref = await chrome.windows
    .getLastFocused({ windowTypes: ['normal'] })
    .catch(() => undefined);
  const inset = ref?.state === 'maximized' ? 8 : 0; // maximized frames overhang the work area by ~8px on Windows
  return {
    left: (ref?.left ?? 0) + inset,
    top: (ref?.top ?? 0) + inset,
    width: 300,
    height: ref?.height != null ? ref.height - 2 * inset : 900,
  };
}

chrome.action.onClicked.addListener(() => void openOrFocusSidebar());

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'focus-sidebar') return;
  void openOrFocusSidebar().then((existed) => {
    // A freshly created sidebar focuses its filter on load by itself.
    if (existed) broadcast({ type: 'focusFilter' });
  });
});

// ---- UI commands -------------------------------------------------------------------

async function handle(msg: FromUi, sink: UiSink): Promise<void> {
  switch (msg.type) {
    case 'ready':
      sink.post({
        type: 'snapshot',
        snapshot: buildSnapshot(store, scheduler.nextSeq(), settings, favicons),
      });
      return;
    case 'activateTab': {
      const tab = store.tabs.get(msg.tabId);
      if (!tab) return;
      const action = msg.click
        ? store.clickAction(msg.tabId, msg.click.focusing, Date.now())
        : 'activate';
      if (action === 'none') return;
      if (action === 'minimize') {
        await chrome.windows.update(tab.windowId, { state: 'minimized' });
        store.windowStateChanged(tab.windowId, 'minimized');
        scheduler.schedule();
        return;
      }
      await chrome.tabs.update(msg.tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return;
    }
    case 'closeTab':
      await chrome.tabs.remove(msg.tabId);
      return;
    case 'closeDuplicates': {
      const ids = store.duplicatesOf(msg.tabId);
      if (ids.length) await chrome.tabs.remove(ids);
      return;
    }
    case 'minimizeWindow':
      if (!store.isIncluded(msg.windowId)) return;
      await chrome.windows.update(msg.windowId, { state: 'minimized' });
      store.windowStateChanged(msg.windowId, 'minimized');
      scheduler.schedule();
      return;
    case 'focusWindow':
      if (!store.isIncluded(msg.windowId)) return;
      await chrome.windows.update(msg.windowId, { focused: true });
      return;
    case 'renameWindow':
      store.renameWindow(msg.windowId, msg.name);
      scheduler.schedule();
      return;
    case 'setAllWindowsCollapsed':
      store.setAllWindowsCollapsed(msg.collapsed);
      scheduler.schedule();
      return;
    case 'toggleWindowCollapsed':
      store.toggleWindowCollapsed(msg.windowId);
      scheduler.schedule();
      return;
    case 'toggleGroupCollapsed':
      store.toggleGroupCollapsed(msg.groupId);
      scheduler.schedule();
      return;
    case 'toggleRailPin':
      store.toggleRailPin(msg.tabId);
      scheduler.schedule();
      return;
    case 'updateSettings':
      settings = { ...settings, ...msg.patch };
      await chrome.storage.local.set({ settings });
      scheduler.schedule();
      return;
    case 'focusLastWindow':
      if (store.lastFocusedWindowId != null) {
        await chrome.windows.update(store.lastFocusedWindowId, { focused: true });
      }
      return;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  const sink: UiSink = { post: (m) => port.postMessage(m) };
  sinks.add(sink);
  const senderWindow = port.sender?.tab?.windowId;
  void ready.then(() => {
    if (senderWindow != null && store.windows.get(senderWindow)?.type !== 'normal') {
      store.setSidebarWindow(senderWindow);
    }
  });
  port.onMessage.addListener((msg: FromUi) => {
    void ready.then(() => handle(msg, sink)).catch((e) => console.error('[TabRail]', e));
  });
  port.onDisconnect.addListener(() => sinks.delete(sink));
});
