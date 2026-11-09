// Minimal structural subsets of the chrome.* types the store consumes.
// chrome.tabs.Tab / chrome.windows.Window / chrome.tabGroups.TabGroup are assignable to these,
// and tests can build them as plain objects.

export interface RawTab {
  id?: number;
  windowId: number;
  index: number;
  title?: string;
  url?: string;
  pendingUrl?: string;
  active: boolean;
  pinned: boolean;
  audible?: boolean;
  mutedInfo?: { muted: boolean };
  discarded: boolean;
  frozen?: boolean;
  status?: string;
  groupId: number;
  lastAccessed?: number;
}

export interface RawWindow {
  id?: number;
  type?: string;
  focused: boolean;
  state?: string;
  tabs?: RawTab[];
}

export interface RawGroup {
  id: number;
  windowId: number;
  title?: string;
  color: string;
  collapsed: boolean;
}

export const WINDOW_ID_NONE = -1;
