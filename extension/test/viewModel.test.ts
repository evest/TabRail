import { describe, expect, it } from 'vitest';
import { TabStore } from '../src/background/tabStore';
import { buildSnapshot } from '../src/background/snapshot';
import { buildMainList } from '../src/ui/viewModel';
import { DEFAULT_SETTINGS } from '../src/shared/protocol';
import { SIDEBAR_URL, tab, win } from './helpers';

function setup() {
  const s = new TabStore(SIDEBAR_URL);
  s.init({
    windows: [
      win(1, [tab(11, 1, 0, { active: true })]),
      win(2, [
        tab(21, 2, 0, { active: true }),
        tab(22, 2, 1, { groupId: 9 }),
        tab(23, 2, 2, { groupId: 9 }),
        tab(24, 2, 3),
      ]),
    ],
    groups: [{ id: 9, windowId: 2, title: 'G', color: 'blue', collapsed: false }],
  });
  return s;
}
const shape = (s: TabStore) =>
  buildMainList(buildSnapshot(s, 1, DEFAULT_SETTINGS)).map((b) =>
    b.rows.map((r) => (r.kind === 'tab' ? `${r.tab.id}@${r.depth}${r.marker ? 'm' : ''}` : r.key)),
  );

describe('main list layout', () => {
  it('flattens single-tab windows and builds a tree for the rest', () => {
    expect(shape(setup())).toEqual([['11@0m'], ['w2', '21@1', 'g9', '22@1', '23@1', '24@1']]);
  });

  it('collapsed group hides its tabs but keeps the header', () => {
    const s = setup();
    s.toggleGroupCollapsed(9);
    expect(shape(s)[1]).toEqual(['w2', '21@1', 'g9', '24@1']);
  });

  it('collapsed window shows only the header', () => {
    const s = setup();
    s.toggleWindowCollapsed(2);
    expect(shape(s)[1]).toEqual(['w2']);
  });

  it('a window that drops to one tab becomes a single row', () => {
    const s = setup();
    for (const id of [22, 23, 24]) s.tabRemoved(id);
    expect(shape(s)[1]).toEqual(['21@0m']);
  });

  it('window header uses the active tab title', () => {
    const blocks = buildMainList(buildSnapshot(setup(), 1, DEFAULT_SETTINGS));
    const head = blocks[1]!.rows[0]!;
    expect(head.kind === 'window' && head.title).toBe('Tab 21');
  });
});
