import { describe, expect, it } from 'vitest';
import { TabStore } from '../src/background/tabStore';
import { buildSnapshot } from '../src/background/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/protocol';
import { SIDEBAR_URL, tab, win } from './helpers';

function setup() {
  const s = new TabStore(SIDEBAR_URL);
  s.init({
    windows: [
      win(1, [tab(11, 1, 0, { active: true }), tab(12, 1, 1), tab(13, 1, 2)], { focused: true }),
      win(2, [tab(21, 2, 0, { active: true })]),
      win(3, [tab(31, 3, 0, { active: true, url: SIDEBAR_URL })], { type: 'popup' }),
      win(4, [tab(41, 4, 0, { active: true })], { type: 'devtools' }),
    ],
    groups: [],
  });
  return s;
}
const snap = (s: TabStore) => buildSnapshot(s, 1, DEFAULT_SETTINGS);
const ids = (s: TabStore, w: number) =>
  snap(s)
    .windows.find((x) => x.id === w)!
    .tabs.map((t) => t.id);

describe('TabStore', () => {
  it('excludes the sidebar popup and non-normal windows', () => {
    const s = setup();
    expect(s.sidebarWindowId).toBe(3);
    expect(snap(s).windows.map((w) => w.id)).toEqual([1, 2]);
  });

  it('does not treat sidebar.html in a normal window as the sidebar', () => {
    const s = setup();
    s.tabCreated(tab(14, 1, 3, { url: SIDEBAR_URL }));
    expect(s.sidebarWindowId).toBe(3);
    expect(s.isIncluded(1)).toBe(true);
  });

  it('keeps tab-strip order through create/move/remove', () => {
    const s = setup();
    s.tabCreated(tab(14, 1, 1));
    expect(ids(s, 1)).toEqual([11, 14, 12, 13]);
    s.tabMoved(11, 1, 3);
    expect(ids(s, 1)).toEqual([14, 12, 13, 11]);
    s.tabRemoved(12);
    expect(ids(s, 1)).toEqual([14, 13, 11]);
    expect(snap(s).windows[0]!.tabs.map((t) => t.index)).toEqual([0, 1, 2]);
  });

  it('moves tabs between windows via detach/attach', () => {
    const s = setup();
    s.tabDetached(12);
    s.tabAttached(12, 2, 0);
    expect(ids(s, 1)).toEqual([11, 13]);
    expect(ids(s, 2)).toEqual([12, 21]);
    expect(s.tabs.get(12)!.windowId).toBe(2);
  });

  it('activation flips the active flag within a window and records MRU', () => {
    const s = setup();
    s.tabActivated(13, 1, 500);
    const w = snap(s).windows[0]!;
    expect(w.tabs.filter((t) => t.active).map((t) => t.id)).toEqual([13]);
    expect(w.tabs.find((t) => t.id === 13)!.lastAccessed).toBe(500);
    expect(s.dirty.mru).toBe(true);
  });

  it('onUpdated does not clobber the active flag', () => {
    const s = setup();
    s.tabActivated(12, 1, 1);
    s.tabUpdated(tab(11, 1, 0, { active: true, title: 'renamed' }));
    expect(s.tabs.get(11)!.active).toBe(false);
    expect(s.tabs.get(11)!.title).toBe('renamed');
  });

  it('maps sleeping, audio and loading state', () => {
    const s = setup();
    s.tabUpdated(tab(12, 1, 1, { discarded: true }));
    s.tabUpdated(
      tab(13, 1, 2, { frozen: true, audible: true, mutedInfo: { muted: true }, status: 'loading' }),
    );
    const t = snap(s).windows[0]!.tabs;
    expect(t[1]!.sleeping).toBe(true);
    expect(t[2]).toMatchObject({ sleeping: true, audible: true, muted: true, loading: true });
    expect(snap(s).windows[0]!.sleeping).toBe(false);
    s.tabUpdated(tab(11, 1, 0, { discarded: true }));
    expect(snap(s).windows[0]!.sleeping).toBe(true);
  });

  it('tabReplaced keeps position and MRU', () => {
    const s = setup();
    s.tabActivated(12, 1, 700);
    s.tabReplaced(12, tab(99, 1, 1, { active: true }));
    expect(ids(s, 1)).toEqual([11, 99, 13]);
    expect(s.mru[99]).toBe(700);
    expect(s.mru[12]).toBeUndefined();
  });

  it('removing a window drops its tabs, groups and collapse state', () => {
    const s = setup();
    s.groupUpserted({ id: 5, windowId: 1, color: 'blue', collapsed: false });
    s.toggleWindowCollapsed(1);
    s.toggleGroupCollapsed(5);
    s.windowRemoved(1);
    expect(s.tabs.has(11)).toBe(false);
    expect(s.groups.has(5)).toBe(false);
    expect(s.collapsedWindows.has(1)).toBe(false);
    expect(s.lastFocusedWindowId).toBeNull();
  });

  it('prunes stale MRU and collapse entries on init', () => {
    const s = new TabStore(SIDEBAR_URL);
    s.init({
      windows: [win(1, [tab(11, 1, 0, { active: true })])],
      groups: [],
      mru: { 11: 5, 999: 9 },
      collapsedWindows: [1, 77],
      collapsedGroups: [88],
    });
    expect(s.mru).toEqual({ 11: 5 });
    expect([...s.collapsedWindows]).toEqual([1]);
    expect(s.collapsedGroups.size).toBe(0);
    expect(s.dirty.collapsed).toBe(true);
  });

  it('handles tab events that arrive before windows.onCreated', () => {
    const s = setup();
    s.tabCreated(tab(51, 5, 0, { active: true }));
    expect(s.isIncluded(5)).toBe(false);
    s.windowCreated({ id: 5, type: 'normal', focused: false });
    expect(ids(s, 5)).toEqual([51]);
  });

  it('collapse state is reflected in the snapshot', () => {
    const s = setup();
    s.groupUpserted({ id: 7, windowId: 1, title: 'G', color: 'red', collapsed: false });
    s.tabUpdated(tab(12, 1, 1, { groupId: 7 }));
    s.toggleWindowCollapsed(1);
    s.toggleGroupCollapsed(7);
    const w = snap(s).windows[0]!;
    expect(w.collapsed).toBe(true);
    expect(w.groups).toEqual([{ id: 7, windowId: 1, title: 'G', color: 'red', collapsed: true }]);
  });
});
