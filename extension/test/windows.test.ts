import { describe, expect, it } from 'vitest';
import { TabStore, urlOverlap } from '../src/background/tabStore';
import { buildSnapshot } from '../src/background/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/protocol';
import { buildFlatList, buildMainList } from '../src/ui/viewModel';
import { SIDEBAR_URL, tab, win } from './helpers';

const u = (n: string) => `https://${n}.example/`;

function setup(windowNames?: { windowId: number; name: string; urls: string[] }[]) {
  const s = new TabStore(SIDEBAR_URL);
  s.init({
    windows: [
      win(1, [tab(11, 1, 0, { active: true, url: u('a'), title: 'beta' })], { focused: true }),
      win(
        2,
        [
          tab(21, 2, 0, { active: true, url: u('b'), title: 'Alpha 10' }),
          tab(22, 2, 1, { url: u('c'), title: 'alpha 9', groupId: 7 }),
        ],
        { state: 'minimized' },
      ),
      win(3, [tab(31, 3, 0, { active: true, url: u('d'), title: 'Gamma' }), tab(32, 3, 1)]),
    ],
    groups: [{ id: 7, windowId: 2, title: 'G', color: 'blue', collapsed: false }],
    windowNames,
  });
  return s;
}
const snap = (s: TabStore) => buildSnapshot(s, 1, DEFAULT_SETTINGS);
const keys = (s: TabStore, opts = {}) =>
  buildMainList(snap(s), opts).map((b) => b.rows.map((r) => r.key));

describe('window names', () => {
  it('a name replaces the header title and gives a single-tab window a header', () => {
    const s = setup();
    s.renameWindow(1, '  Work  ');
    s.renameWindow(3, 'Research');
    const blocks = buildMainList(snap(s));
    expect(blocks[0]!.rows.map((r) => r.key)).toEqual(['w1', 't11']);
    const head = blocks[2]!.rows[0]!;
    expect(head.kind === 'window' && head.title).toBe('Research');
    expect(snap(s).windows[0]!.name).toBe('Work');
  });

  it('an empty name clears it', () => {
    const s = setup();
    s.renameWindow(1, 'Work');
    s.renameWindow(1, ' ');
    expect(snap(s).windows[0]!.name).toBeUndefined();
  });

  it('re-matches saved names by tab URLs after a restart (new window ids)', () => {
    const s = setup([
      { windowId: 90, name: 'Mail', urls: [u('b'), u('c')] }, // same tabs as window 2
      { windowId: 91, name: 'Gone', urls: [u('x'), u('y')] }, // no match: dropped
      { windowId: 92, name: 'Half', urls: [u('d'), u('z'), u('q')] }, // 1/3 overlap: too weak
    ]);
    expect([...s.windowNames].map(([id, e]) => [id, e.name])).toEqual([[2, 'Mail']]);
  });

  it('keeps names of closed windows for the next start (Chrome closes all windows on exit)', () => {
    const s = setup();
    s.renameWindow(2, 'Mail');
    s.windowNamesForStorage(); // refreshes the saved URLs
    s.tabRemoved(21);
    s.tabRemoved(22);
    s.windowRemoved(2);
    expect(s.windowNamesForStorage()).toEqual([
      { windowId: 2, name: 'Mail', urls: [u('b'), u('c')] },
    ]);
  });

  it('urlOverlap is relative to the larger window', () => {
    expect(urlOverlap(['a', 'b'], ['a', 'b', 'c', 'd'])).toBe(0.5);
    expect(urlOverlap([], ['a'])).toBe(0);
  });
});

describe('collapse / expand all', () => {
  it('collapses and expands every listed window', () => {
    const s = setup();
    s.setAllWindowsCollapsed(true);
    expect(snap(s).windows.map((w) => w.collapsed)).toEqual([true, true, true]);
    s.setAllWindowsCollapsed(false);
    expect(snap(s).windows.map((w) => w.collapsed)).toEqual([false, false, false]);
    expect(s.dirty.collapsed).toBe(true);
  });
});

describe('minimized windows', () => {
  it('stay in place, move to the bottom, or are hidden', () => {
    const s = setup();
    const first = (opts: object) => keys(s, opts).map((rows) => rows[0]);
    expect(first({ minimized: 'inline' })).toEqual(['t11', 'w2', 'w3']);
    expect(first({ minimized: 'bottom' })).toEqual(['t11', 'w3', 'w2']);
    expect(first({ minimized: 'hidden' })).toEqual(['t11', 'w3']);
  });
});

describe('flat list', () => {
  it('lists every tab without headers or groups, in window and tab order', () => {
    expect(buildFlatList(snap(setup())).map((t) => t.id)).toEqual([11, 21, 22, 31, 32]);
  });

  it('sorts by name naturally and case-insensitively', () => {
    const titles = buildFlatList(snap(setup()), { sort: 'title' }).map((t) => t.title);
    expect(titles.slice(0, 4)).toEqual(['alpha 9', 'Alpha 10', 'beta', 'Gamma']);
  });

  it('honours hidden tabs and the minimized setting', () => {
    const ids = buildFlatList(snap(setup()), { hidden: new Set([31]), minimized: 'hidden' });
    expect(ids.map((t) => t.id)).toEqual([11, 32]);
  });
});
