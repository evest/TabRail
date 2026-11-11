import type { RawGroup, RawTab, RawWindow } from './model';
import { WINDOW_ID_NONE } from './model';
import { dupKey } from '../shared/dupKey';

interface WinState {
  id: number;
  type: string;
  state: string;
}

export interface StoreInit {
  windows: RawWindow[];
  groups: RawGroup[];
  /** Last focused normal window if known (e.g. from windows.getLastFocused). */
  focusedWindowId?: number | null;
  mru?: Record<number, number>;
  collapsedWindows?: number[];
  collapsedGroups?: number[];
  /** Persisted rail pins; re-matched to live tabs (tab ids don't survive browser restarts). */
  railPins?: RailPin[];
  /** Persisted window names; re-matched by tab URLs (window ids don't survive restarts). */
  windowNames?: WindowName[];
}

/** A sidebar-only window name plus the window's tab URLs, for re-matching after a restart. */
export interface WindowName {
  windowId: number;
  name: string;
  urls: string[];
}

/** Share of URLs two windows have in common (0..1), relative to the larger window. */
export function urlOverlap(a: readonly string[], b: readonly string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let common = 0;
  for (const u of sa) if (sb.has(u)) common++;
  return common / Math.max(sa.size, sb.size);
}

/** A tab pinned to the sidebar's Pinned section (not Chrome's own tab pinning). */
export interface RailPin {
  tabId: number;
  url: string;
}

/** Most detached pins kept (tabs whose window closed); the oldest go first. */
const MAX_DETACHED_PINS = 30;

/**
 * Pure in-memory model of Chrome's windows/tabs/groups, driven by Chrome events.
 * No chrome.* access here: index.ts feeds events in, snapshot.ts reads state out.
 */
export class TabStore {
  readonly windows = new Map<number, WinState>();
  /** windowId -> tab ids in tab-strip order (index is derived from position). */
  readonly order = new Map<number, number[]>();
  readonly tabs = new Map<number, RawTab>();
  readonly groups = new Map<number, RawGroup>();
  /** tabId -> our own last-activation timestamp. */
  mru: Record<number, number> = {};
  readonly collapsedWindows = new Set<number>();
  readonly collapsedGroups = new Set<number>();
  sidebarWindowId: number | null = null;
  lastFocusedWindowId: number | null = null;
  /**
   * The Pinned section, in pin order. A pin is `live` while its tab is open. Pins whose window
   * closed (including Chrome quitting, which closes every window) or that haven't been matched yet
   * after a restart (session restore can finish after the service worker starts) stay detached
   * and re-attach to the first tab that shows up with their URL. Closing the tab itself unpins.
   */
  private pins: { tabId: number; url: string; live: boolean }[] = [];
  /** windowId -> sidebar-only name and the last known (non-empty) tab URLs. */
  readonly windowNames = new Map<number, { name: string; urls: string[] }>();
  /**
   * Names without a live window: saved names not matched yet after a start (session restore can
   * finish after the service worker starts) and names of windows closed this session (closing
   * Chrome closes every window). Persisted, and re-attached when a matching window shows up.
   */
  private closedNames: WindowName[] = [];
  /**
   * Raw onFocusChanged history (including WINDOW_ID_NONE and the sidebar), newest last. Used to
   * tell which window owned the foreground right before the sidebar was clicked.
   */
  private focusHistory: { id: number; at: number }[] = [];

  /** Set when state that must be persisted changed; cleared by the owner after saving. */
  dirty = { mru: false, collapsed: false, pins: false };

  constructor(private readonly sidebarUrl: string) {}

  init(data: StoreInit): void {
    this.windows.clear();
    this.order.clear();
    this.tabs.clear();
    this.groups.clear();
    this.sidebarWindowId = null;
    this.lastFocusedWindowId = null;
    this.focusHistory = [];
    this.pins = [];

    for (const w of data.windows) {
      if (w.id == null) continue;
      this.windowCreated(w);
      const tabs = [...(w.tabs ?? [])].sort((a, b) => a.index - b.index);
      for (const t of tabs) this.tabCreated(t);
    }
    for (const g of data.groups) this.groupUpserted(g);

    // MRU: keep only entries for tabs that still exist (ids are stable within a browser session).
    this.mru = {};
    for (const [k, v] of Object.entries(data.mru ?? {})) {
      if (this.tabs.has(Number(k))) this.mru[Number(k)] = v;
    }

    // Window/group ids are not stable across browser restarts: prune stale collapse entries.
    this.collapsedWindows.clear();
    for (const id of data.collapsedWindows ?? [])
      if (this.windows.has(id)) this.collapsedWindows.add(id);
    this.collapsedGroups.clear();
    for (const id of data.collapsedGroups ?? [])
      if (this.groups.has(id)) this.collapsedGroups.add(id);
    const prunedCollapsed =
      this.collapsedWindows.size !== (data.collapsedWindows?.length ?? 0) ||
      this.collapsedGroups.size !== (data.collapsedGroups?.length ?? 0);

    this.matchWindowNames(data.windowNames ?? []);

    // Rail pins start detached and are re-attached by URL; unmatched ones wait for their tab.
    this.pins = (data.railPins ?? [])
      .filter((p) => p.url)
      .map((p) => ({ tabId: p.tabId, url: p.url, live: false }));
    this.dirty = { mru: false, collapsed: prunedCollapsed, pins: false };
    this.reattachPins();

    const focused =
      data.windows.find((w) => w.focused && w.id != null && this.isIncluded(w.id))?.id ??
      data.focusedWindowId ??
      null;
    if (focused != null && this.isIncluded(focused)) this.lastFocusedWindowId = focused;
    const rawFocused = data.windows.find((w) => w.focused && w.id != null)?.id;
    if (rawFocused != null) this.focusHistory.push({ id: rawFocused, at: 0 });
  }

  // ---- queries -------------------------------------------------------------

  /** Other tabs (in listed windows) with the same URL as this one; see shared/dupKey. */
  duplicatesOf(tabId: number): number[] {
    const key = dupKey(this.tabs.get(tabId)?.url ?? '');
    if (!key) return [];
    return [...this.tabs.values()]
      .filter((t) => t.id !== tabId && this.isIncluded(t.windowId) && dupKey(t.url ?? '') === key)
      .map((t) => t.id!);
  }

  /** Windows that appear in the model: normal windows other than the sidebar itself. */
  isIncluded(windowId: number): boolean {
    const w = this.windows.get(windowId);
    return !!w && w.type === 'normal' && windowId !== this.sidebarWindowId;
  }

  tabsOf(windowId: number): RawTab[] {
    return (this.order.get(windowId) ?? []).map((id) => this.tabs.get(id)!).filter(Boolean);
  }

  activeTabOf(windowId: number): RawTab | undefined {
    return this.tabsOf(windowId).find((t) => t.active);
  }

  /** Active tab of the last focused normal window. */
  globalActiveTabId(): number | null {
    if (this.lastFocusedWindowId == null) return null;
    return this.activeTabOf(this.lastFocusedWindowId)?.id ?? null;
  }

  /** True if activating `tabId` should minimize its window instead (it is already the current tab). */
  isCurrent(tabId: number): boolean {
    const tab = this.tabs.get(tabId);
    if (!tab || !tab.active || tab.windowId !== this.lastFocusedWindowId) return false;
    return this.windows.get(tab.windowId)?.state !== 'minimized';
  }

  // ---- windows -------------------------------------------------------------

  windowCreated(w: RawWindow): void {
    if (w.id == null) return;
    this.windows.set(w.id, { id: w.id, type: w.type ?? 'normal', state: w.state ?? 'normal' });
    if (!this.order.has(w.id)) this.order.set(w.id, []);
  }

  windowRemoved(windowId: number): void {
    const named = this.windowNames.get(windowId);
    if (named) {
      this.windowNames.delete(windowId);
      this.closedNames = [{ windowId, ...named }, ...this.closedNames].slice(0, 10);
    }
    for (const id of [...(this.order.get(windowId) ?? [])]) this.forgetTab(id, true);
    this.order.delete(windowId);
    this.windows.delete(windowId);
    for (const g of [...this.groups.values()]) if (g.windowId === windowId) this.groupRemoved(g.id);
    if (this.collapsedWindows.delete(windowId)) this.dirty.collapsed = true;
    if (this.sidebarWindowId === windowId) this.sidebarWindowId = null;
    if (this.lastFocusedWindowId === windowId) this.lastFocusedWindowId = null;
  }

  /** windows.onFocusChanged. Ignores WINDOW_ID_NONE, the sidebar and non-normal windows. */
  windowFocused(windowId: number, at: number): void {
    this.focusHistory.push({ id: windowId, at });
    if (this.focusHistory.length > 8) this.focusHistory.shift();
    if (windowId === WINDOW_ID_NONE || !this.isIncluded(windowId)) return;
    this.lastFocusedWindowId = windowId;
    const active = this.activeTabOf(windowId);
    if (active?.id != null) this.touch(active.id, at);
  }

  /**
   * The window that had the foreground before the sidebar took it (WINDOW_ID_NONE if another
   * application had it). Skips the sidebar's own focus entries and the transient NONE that Chrome
   * may report while focus moves to the sidebar (or, in Phase B, to the host app) for this click.
   */
  foregroundBeforeSidebar(now: number, transientMs = 1000): number {
    const h = this.focusHistory;
    for (let i = h.length - 1; i >= 0; i--) {
      const e = h[i]!;
      if (e.id === this.sidebarWindowId) continue;
      if (e.id === WINDOW_ID_NONE && (h[i + 1]?.at ?? now) - e.at < transientMs) continue;
      return e.id;
    }
    return WINDOW_ID_NONE;
  }

  /**
   * What a mouse click on a tab (or its window header) should do, taskbar style:
   * - not the current tab: activate it;
   * - current tab, sidebar already had focus: minimize its window;
   * - current tab, the click only moved focus from that window to the sidebar: nothing (the
   *   sidebar keeps focus, so the next click minimizes);
   * - current tab but another application had the foreground: bring the window back.
   */
  clickAction(
    tabId: number,
    focusingClick: boolean,
    now: number,
  ): 'activate' | 'minimize' | 'none' {
    if (!this.isCurrent(tabId)) return 'activate';
    if (!focusingClick) return 'minimize';
    const windowId = this.tabs.get(tabId)!.windowId;
    return this.foregroundBeforeSidebar(now) === windowId ? 'none' : 'activate';
  }

  windowStateChanged(windowId: number, state: string): void {
    const w = this.windows.get(windowId);
    if (w) w.state = state;
  }

  setSidebarWindow(windowId: number | null): void {
    this.sidebarWindowId = windowId;
    if (windowId != null && this.lastFocusedWindowId === windowId) this.lastFocusedWindowId = null;
  }

  // ---- tabs ----------------------------------------------------------------

  tabCreated(tab: RawTab): void {
    if (tab.id == null) return;
    if (!this.windows.has(tab.windowId)) {
      // Tab event raced ahead of windows.onCreated; type is filled in when that arrives.
      this.windows.set(tab.windowId, { id: tab.windowId, type: 'unknown', state: 'normal' });
    }
    this.removeFromOrder(tab.id);
    const order = this.orderOf(tab.windowId);
    order.splice(clamp(tab.index, 0, order.length), 0, tab.id);
    this.tabs.set(tab.id, { ...tab });
    if (tab.active) this.setActive(tab.windowId, tab.id);
    this.detectSidebar(tab);
  }

  /** tabs.onUpdated (the full tab object). Position is owned by move/attach events. */
  tabUpdated(tab: RawTab): void {
    if (tab.id == null) return;
    const prev = this.tabs.get(tab.id);
    if (!prev || prev.windowId !== tab.windowId) {
      this.tabCreated(tab);
      return;
    }
    if (prev.url !== tab.url && this.railPins.includes(tab.id)) this.dirty.pins = true;
    // Keep our own active flag; onActivated is authoritative.
    this.tabs.set(tab.id, { ...tab, active: prev.active });
    this.detectSidebar(tab);
  }

  /**
   * tabs.onRemoved. `windowClosing` (removeInfo.isWindowClosing) keeps the tab's pin, detached,
   * so pins survive closing a window or quitting Chrome.
   */
  tabRemoved(tabId: number, windowClosing = false): void {
    this.forgetTab(tabId, windowClosing);
  }

  tabMoved(tabId: number, windowId: number, toIndex: number): void {
    const order = this.orderOf(windowId);
    const from = order.indexOf(tabId);
    if (from === -1) return;
    order.splice(from, 1);
    order.splice(clamp(toIndex, 0, order.length), 0, tabId);
  }

  tabDetached(tabId: number): void {
    this.removeFromOrder(tabId);
  }

  tabAttached(tabId: number, windowId: number, position: number): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    this.removeFromOrder(tabId);
    if (!this.windows.has(windowId)) {
      this.windows.set(windowId, { id: windowId, type: 'unknown', state: 'normal' });
    }
    const order = this.orderOf(windowId);
    order.splice(clamp(position, 0, order.length), 0, tabId);
    tab.windowId = windowId;
    if (tab.active) this.setActive(windowId, tabId);
  }

  tabActivated(tabId: number, windowId: number, at: number): void {
    this.setActive(windowId, tabId);
    if (this.isIncluded(windowId)) this.touch(tabId, at);
  }

  /** tabs.onReplaced (prerender/instant swaps): the new tab takes over the old one's slot. */
  tabReplaced(removedTabId: number, added: RawTab): void {
    if (added.id == null) return;
    const order = [...this.order.values()].find((o) => o.includes(removedTabId));
    const mruAt = this.mru[removedTabId];
    if (order) order[order.indexOf(removedTabId)] = added.id;
    this.tabs.delete(removedTabId);
    delete this.mru[removedTabId];
    this.tabs.set(added.id, { ...added });
    if (!order) this.tabCreated(added);
    if (mruAt != null) this.touch(added.id, mruAt);
    const pin = this.pins.find((p) => p.live && p.tabId === removedTabId);
    if (pin) {
      pin.tabId = added.id;
      this.dirty.pins = true;
    }
  }

  // ---- groups --------------------------------------------------------------

  groupUpserted(g: RawGroup): void {
    this.groups.set(g.id, { ...g });
  }

  groupRemoved(groupId: number): void {
    this.groups.delete(groupId);
    if (this.collapsedGroups.delete(groupId)) this.dirty.collapsed = true;
  }

  // ---- sidebar-only UI state --------------------------------------------------

  toggleWindowCollapsed(windowId: number): void {
    if (!this.windows.has(windowId)) return;
    if (!this.collapsedWindows.delete(windowId)) this.collapsedWindows.add(windowId);
    this.dirty.collapsed = true;
  }

  renameWindow(windowId: number, name: string): void {
    if (!this.windows.has(windowId)) return;
    const trimmed = name.trim();
    if (trimmed) this.windowNames.set(windowId, { name: trimmed, urls: this.urlsOf(windowId) });
    else this.windowNames.delete(windowId);
  }

  setAllWindowsCollapsed(collapsed: boolean): void {
    for (const id of this.windows.keys()) {
      if (!this.isIncluded(id)) continue;
      if (collapsed) this.collapsedWindows.add(id);
      else this.collapsedWindows.delete(id);
    }
    this.dirty.collapsed = true;
  }

  /**
   * What to persist: live names with their windows' current URLs (kept from before when a window
   * is momentarily empty, e.g. while closing), plus names of windows closed this session.
   */
  windowNamesForStorage(): WindowName[] {
    const live: WindowName[] = [];
    for (const [windowId, entry] of this.windowNames) {
      const urls = this.urlsOf(windowId);
      if (urls.length) entry.urls = urls;
      live.push({ windowId, name: entry.name, urls: entry.urls });
    }
    return [...live, ...this.closedNames];
  }

  /** Tab ids shown in the Pinned section (live pins), in pin order. */
  get railPins(): number[] {
    return this.pins.filter((p) => p.live).map((p) => p.tabId);
  }

  toggleRailPin(tabId: number): void {
    const i = this.pins.findIndex((p) => p.live && p.tabId === tabId);
    const url = this.tabs.get(tabId)?.url;
    if (i !== -1) this.pins.splice(i, 1);
    else if (url) {
      // A detached pin for the same URL would otherwise grab the next tab with that URL.
      this.pins = this.pins.filter((p) => p.live || p.url !== url);
      this.pins.push({ tabId, url, live: true });
    } else return;
    this.dirty.pins = true;
  }

  /**
   * Attach detached pins to open tabs: the same tab id with the same URL (service worker
   * restart), else the first unpinned tab with that URL (browser restart: ids are reassigned).
   * Cheap when nothing is detached; called by the owner before every snapshot.
   */
  reattachPins(): void {
    if (this.pins.every((p) => p.live)) return;
    const taken = new Set(this.railPins);
    for (const p of this.pins) {
      if (p.live) continue;
      const same = this.tabs.get(p.tabId);
      const id =
        same?.url === p.url && !taken.has(p.tabId) && this.isIncluded(same.windowId)
          ? p.tabId
          : [...this.tabs.values()].find(
              (t) => t.url === p.url && !taken.has(t.id!) && this.isIncluded(t.windowId),
            )?.id;
      if (id == null) continue;
      p.tabId = id;
      p.live = true;
      taken.add(id);
      this.dirty.pins = true;
    }
  }

  /** What to persist: every pin, live or detached, with its last known URL. */
  railPinsForStorage(): RailPin[] {
    return this.pins.map((p) => ({
      tabId: p.tabId,
      url: (p.live && this.tabs.get(p.tabId)?.url) || p.url,
    }));
  }

  toggleGroupCollapsed(groupId: number): void {
    if (!this.groups.has(groupId)) return;
    if (!this.collapsedGroups.delete(groupId)) this.collapsedGroups.add(groupId);
    this.dirty.collapsed = true;
  }

  // ---- internals -----------------------------------------------------------

  private touch(tabId: number, at: number): void {
    this.mru[tabId] = at;
    this.dirty.mru = true;
  }

  private setActive(windowId: number, tabId: number): void {
    for (const id of this.order.get(windowId) ?? []) {
      const t = this.tabs.get(id);
      if (t) t.active = id === tabId;
    }
  }

  private urlsOf(windowId: number): string[] {
    return this.tabsOf(windowId)
      .map((t) => t.url || t.pendingUrl || '')
      .filter(Boolean);
  }

  private matchWindowNames(saved: WindowName[]): void {
    this.windowNames.clear();
    this.closedNames = saved.filter((s) => s.name && s.urls?.length);
    this.reattachNames();
  }

  /**
   * Attach names without a window to unnamed live windows by tab-URL overlap (at least half), best
   * matches first, preferring the same window id on ties (service worker restart). Unmatched names
   * keep waiting. Cheap when nothing is waiting; called by the owner before every snapshot.
   */
  reattachNames(): void {
    if (this.closedNames.length === 0) return;
    const saved = this.closedNames;
    const live = [...this.windows.keys()]
      .filter((id) => this.isIncluded(id) && !this.windowNames.has(id))
      .map((id) => ({ id, urls: this.urlsOf(id) }));
    const pairs = saved.flatMap((s, si) =>
      live.map((w) => ({
        si,
        id: w.id,
        score: urlOverlap(s.urls, w.urls),
        same: s.windowId === w.id,
      })),
    );
    pairs.sort((a, b) => b.score - a.score || Number(b.same) - Number(a.same));
    const usedSaved = new Set<number>();
    for (const p of pairs) {
      if (p.score < 0.5) break;
      if (usedSaved.has(p.si) || this.windowNames.has(p.id)) continue;
      usedSaved.add(p.si);
      const s = saved[p.si]!;
      this.windowNames.set(p.id, { name: s.name, urls: this.urlsOf(p.id) });
    }
    if (usedSaved.size) this.closedNames = saved.filter((_, i) => !usedSaved.has(i));
  }

  private forgetTab(tabId: number, keepPin = false): void {
    const url = this.tabs.get(tabId)?.url;
    this.removeFromOrder(tabId);
    this.tabs.delete(tabId);
    if (tabId in this.mru) {
      delete this.mru[tabId];
      this.dirty.mru = true;
    }
    const pin = this.pins.findIndex((p) => p.live && p.tabId === tabId);
    if (pin === -1) return;
    this.dirty.pins = true;
    const entry = this.pins[pin]!;
    if (!keepPin) {
      this.pins.splice(pin, 1);
      return;
    }
    entry.live = false;
    if (url) entry.url = url;
    const detached = this.pins.filter((p) => !p.live);
    if (detached.length > MAX_DETACHED_PINS) {
      const drop = new Set(detached.slice(0, detached.length - MAX_DETACHED_PINS));
      this.pins = this.pins.filter((p) => !drop.has(p));
    }
  }

  private removeFromOrder(tabId: number): void {
    for (const order of this.order.values()) {
      const i = order.indexOf(tabId);
      if (i !== -1) order.splice(i, 1);
    }
  }

  private orderOf(windowId: number): number[] {
    let o = this.order.get(windowId);
    if (!o) this.order.set(windowId, (o = []));
    return o;
  }

  private detectSidebar(tab: RawTab): void {
    const url = tab.url || tab.pendingUrl || '';
    // Only a popup counts: sidebar.html opened in a normal tab is just a tab.
    if (url.startsWith(this.sidebarUrl) && this.windows.get(tab.windowId)?.type !== 'normal') {
      this.setSidebarWindow(tab.windowId);
    }
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
