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
  /** Tab ids pinned to the sidebar's Pinned section, in pin order. */
  railPins: number[] = [];
  /** windowId -> sidebar-only name and the last known (non-empty) tab URLs. */
  readonly windowNames = new Map<number, { name: string; urls: string[] }>();
  /**
   * Names of windows closed this session, kept so that closing Chrome (which closes every window)
   * doesn't lose them before the next start re-matches them. Capped; cleared on init.
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

    // Rail pins: same tab id and URL (service worker restart), else the first unclaimed tab with
    // the same URL (browser restart, where tab ids are reassigned). Unmatched pins are dropped.
    this.railPins = [];
    let prunedPins = false;
    for (const pin of data.railPins ?? []) {
      const same = this.tabs.get(pin.tabId);
      const match =
        same?.url === pin.url && !this.railPins.includes(pin.tabId)
          ? pin.tabId
          : [...this.tabs.values()].find((t) => t.url === pin.url && !this.railPins.includes(t.id!))
              ?.id;
      if (match != null) this.railPins.push(match);
      if (match !== pin.tabId) prunedPins = true;
    }
    this.dirty = { mru: false, collapsed: prunedCollapsed, pins: prunedPins };

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
    for (const id of this.order.get(windowId) ?? []) this.forgetTab(id);
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

  tabRemoved(tabId: number): void {
    this.forgetTab(tabId);
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
    const pin = this.railPins.indexOf(removedTabId);
    if (pin !== -1) {
      this.railPins[pin] = added.id;
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

  toggleRailPin(tabId: number): void {
    const i = this.railPins.indexOf(tabId);
    if (i !== -1) this.railPins.splice(i, 1);
    else if (this.tabs.has(tabId)) this.railPins.push(tabId);
    else return;
    this.dirty.pins = true;
  }

  /** What to persist: ids plus URLs for re-matching after a browser restart. */
  railPinsForStorage(): RailPin[] {
    return this.railPins.map((tabId) => ({ tabId, url: this.tabs.get(tabId)?.url ?? '' }));
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

  /**
   * Re-attach persisted names to live windows by tab-URL overlap (at least half), best matches
   * first, preferring the same window id on ties (service worker restart). Unmatched names drop.
   */
  private matchWindowNames(saved: WindowName[]): void {
    this.windowNames.clear();
    this.closedNames = [];
    const live = [...this.windows.keys()]
      .filter((id) => this.isIncluded(id))
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
  }

  private forgetTab(tabId: number): void {
    this.removeFromOrder(tabId);
    this.tabs.delete(tabId);
    if (tabId in this.mru) {
      delete this.mru[tabId];
      this.dirty.mru = true;
    }
    const pin = this.railPins.indexOf(tabId);
    if (pin !== -1) {
      this.railPins.splice(pin, 1);
      this.dirty.pins = true;
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
