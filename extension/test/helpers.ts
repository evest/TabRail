import type { RawTab, RawWindow } from '../src/background/model';

export const SIDEBAR_URL = 'chrome-extension://abc/sidebar.html';

export function tab(
  id: number,
  windowId: number,
  index: number,
  extra: Partial<RawTab> = {},
): RawTab {
  return {
    id,
    windowId,
    index,
    title: `Tab ${id}`,
    url: `https://site${id}.example/page`,
    active: false,
    pinned: false,
    discarded: false,
    status: 'complete',
    groupId: -1,
    lastAccessed: 0,
    ...extra,
  };
}

export function win(id: number, tabs: RawTab[], extra: Partial<RawWindow> = {}): RawWindow {
  return { id, type: 'normal', focused: false, state: 'normal', tabs, ...extra };
}
