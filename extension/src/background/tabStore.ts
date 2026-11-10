import type { RawGroup, RawTab, RawWindow } from './model';
import { WINDOW_ID_NONE } from './model';

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
  /**
   * Raw onFocusChanged history (including WINDOW_ID_NONE and the sidebar), newest last. Used to
   * tell which window owned the foreground right before the sidebar was clicked.
   */
  private focusHistory: { id: number; at: number }[] = [];

  /** Set when state that must be persisted changed; cleared by the owner after saving. */
  dirty = { mru: false, collapsed: false };

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
    this.dirty = { mru: false, collapsed: prunedCollapsed };

    const focused =
      data.windows.find((w) => w.focused && w.id != null && this.isIncluded(w.id))?.id ??
      data.focusedWindowId ??
      null;
    if (focused != null && this.isIncluded(focused)) this.lastFocusedWindowId = focused;
    const rawFocused = data.windows.find((w) => w.focused && w.id != null)?.id;
    if (rawFocused != null) this.focusHistory.push({ id: rawFocused, at: 0 });
  }

  // ---- queries -------------------------------------------------------------

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

  private forgetTab(tabId: number): void {
    this.removeFromOrder(tabId);
    this.tabs.delete(tabId);
    if (tabId in this.mru) {
      delete this.mru[tabId];
      this.dirty.mru = true;
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
