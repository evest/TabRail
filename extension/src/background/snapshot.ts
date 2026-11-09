import type { GroupNode, Settings, Snapshot, TabNode, WindowNode } from '../shared/protocol';
import type { RawTab } from './model';
import type { TabStore } from './tabStore';

export interface FaviconLookup {
  /** Cache key for a tab's favicon, or undefined if this tab never gets one. */
  keyFor(url: string): string | undefined;
  /** Data URL if resolved. */
  get(key: string): string | undefined;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

export function buildSnapshot(
  store: TabStore,
  seq: number,
  settings: Settings,
  favicons?: FaviconLookup,
): Snapshot {
  const favs: Record<string, string> = {};
  const windows: WindowNode[] = [];

  const windowIds = [...store.windows.keys()]
    .filter((id) => store.isIncluded(id))
    .sort((a, b) => a - b);
  const focusedWindowId =
    store.lastFocusedWindowId != null && store.isIncluded(store.lastFocusedWindowId)
      ? store.lastFocusedWindowId
      : null;

  for (const wid of windowIds) {
    const win = store.windows.get(wid)!;
    const tabs = store.tabsOf(wid).map((t, index) => toTabNode(t, index, store, favicons, favs));
    const groupIds = [...new Set(tabs.map((t) => t.groupId).filter((g) => g !== -1))];
    const groups: GroupNode[] = groupIds.flatMap((gid) => {
      const g = store.groups.get(gid);
      if (!g) return [];
      return [
        {
          id: g.id,
          windowId: wid,
          title: g.title ?? '',
          color: g.color,
          collapsed: store.collapsedGroups.has(g.id),
        },
      ];
    });
    windows.push({
      id: wid,
      focused: wid === focusedWindowId,
      minimized: win.state === 'minimized',
      sleeping: tabs.length > 0 && tabs.every((t) => t.sleeping),
      collapsed: store.collapsedWindows.has(wid),
      tabs,
      groups,
    });
  }

  const globalActive = store.globalActiveTabId();
  const recent = windows
    .flatMap((w) => w.tabs)
    .filter((t) => t.id !== globalActive)
    .sort((a, b) => b.lastAccessed - a.lastAccessed || a.id - b.id)
    .slice(0, settings.recentSlots)
    .map((t) => t.id);

  return { seq, focusedWindowId, windows, recent, favicons: favs, settings };
}

function toTabNode(
  t: RawTab,
  index: number,
  store: TabStore,
  favicons: FaviconLookup | undefined,
  favs: Record<string, string>,
): TabNode {
  const id = t.id!;
  const url = t.url || t.pendingUrl || '';
  let favicon: string | undefined;
  const key = favicons?.keyFor(url);
  if (key) {
    const data = favicons!.get(key);
    if (data) {
      favs[key] = data;
      favicon = key;
    }
  }
  return {
    id,
    windowId: t.windowId,
    index,
    title: t.title || url || 'New Tab',
    url,
    host: hostOf(url),
    favicon,
    active: t.active,
    pinned: t.pinned,
    audible: !!t.audible,
    muted: !!t.mutedInfo?.muted,
    sleeping: !!(t.discarded || t.frozen),
    loading: t.status === 'loading',
    groupId: t.groupId ?? -1,
    lastAccessed: store.mru[id] ?? t.lastAccessed ?? 0,
  };
}
