// Message and model types shared by the service worker, the UI and (Phase B) the .NET host.
// Keep this file free of runtime dependencies on chrome.* or the DOM.

export interface TabNode {
  id: number;
  windowId: number;
  index: number;
  title: string;
  url: string;
  host: string;
  /** Key into Snapshot.favicons (data URLs are deduplicated per snapshot). */
  favicon?: string;
  active: boolean;
  pinned: boolean;
  audible: boolean;
  muted: boolean;
  /** tab.discarded || tab.frozen */
  sleeping: boolean;
  loading: boolean;
  /** -1 = ungrouped */
  groupId: number;
  /** MRU timestamp (our own tracking, falling back to tab.lastAccessed). */
  lastAccessed: number;
}

export interface GroupNode {
  id: number;
  windowId: number;
  title: string;
  color: string;
  /** Sidebar-only collapse state; never mirrored to Chrome's tab strip. */
  collapsed: boolean;
}

export interface WindowNode {
  id: number;
  focused: boolean;
  minimized: boolean;
  /** All tabs sleeping. */
  sleeping: boolean;
  /** Sidebar collapse state (persisted by the service worker). */
  collapsed: boolean;
  /** Sidebar-only window name, shown instead of the active tab's title. */
  name?: string;
  tabs: TabNode[];
  groups: GroupNode[];
}

/** Where minimized windows go in the main list. */
export type MinimizedMode = 'inline' | 'bottom' | 'hidden';
/** `flat`: one list of tabs, no window headers or groups. */
export type ListLayout = 'windows' | 'flat';
export type FlatSort = 'tabOrder' | 'title';

export interface Settings {
  recentSlots: number;
  /** Also list pinned tabs in the window list (default: only in the Pinned section). */
  showPinnedInList: boolean;
  minimizedWindows: MinimizedMode;
  layout: ListLayout;
  /** Only used by the flat layout. */
  flatSort: FlatSort;
}

export interface Snapshot {
  seq: number;
  focusedWindowId: number | null;
  /** Windows in creation order, tabs in tab-strip order. */
  windows: WindowNode[];
  /** Tab ids pinned to the sidebar's Pinned section, in pin order (not Chrome's tab pinning). */
  pinned: number[];
  /**
   * Tab ids, most recent first, the globally active (current) tab first, excluding pinned tabs.
   * At most settings.recentSlots.
   */
  recent: number[];
  /** favicon key -> data: URL. Only keys referenced by tabs in this snapshot. */
  favicons: Record<string, string>;
  settings: Settings;
}

export type ToUi =
  | { type: 'snapshot'; snapshot: Snapshot }
  /** Shortcut pressed: focus the filter input. */
  | { type: 'focusFilter' };

export type FromUi =
  | { type: 'ready' }
  /**
   * Activates the tab and focuses its window. Mouse clicks set `click`: clicking the tab that is
   * already current minimizes its window instead (taskbar style), except when the click only moved
   * focus from that window into the sidebar (`focusing`). See TabStore.clickAction.
   */
  | {
      type: 'activateTab';
      tabId: number;
      click?: { focusing: boolean };
    }
  | { type: 'closeTab'; tabId: number }
  /** Close every other open tab with the same URL (see shared/dupKey), keeping this one. */
  | { type: 'closeDuplicates'; tabId: number }
  | { type: 'minimizeWindow'; windowId: number }
  /** Bring a window to the front, restoring it if minimized. */
  | { type: 'focusWindow'; windowId: number }
  /** Set a sidebar-only window name; an empty name clears it. */
  | { type: 'renameWindow'; windowId: number; name: string }
  | { type: 'setAllWindowsCollapsed'; collapsed: boolean }
  | { type: 'toggleWindowCollapsed'; windowId: number }
  | { type: 'toggleGroupCollapsed'; groupId: number }
  /** Add the tab to, or remove it from, the sidebar's Pinned section. */
  | { type: 'toggleRailPin'; tabId: number }
  /** Change settings; the service worker persists them and sends a new snapshot. */
  | { type: 'updateSettings'; patch: Partial<Settings> }
  /** Second Esc in the filter: hand focus back to the last real Chrome window. */
  | { type: 'focusLastWindow' };

export const PORT_NAME = 'sidebar';
export const NATIVE_HOST_NAME = 'no.tabrail.host';
export const DEFAULT_SETTINGS: Settings = {
  recentSlots: 5,
  showPinnedInList: false,
  minimizedWindows: 'inline',
  layout: 'windows',
  flatSort: 'tabOrder',
};
