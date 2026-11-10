import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/protocol';
import { TabStore } from '../src/background/tabStore';
import { buildSnapshot } from '../src/background/snapshot';
import { SIDEBAR_URL, tab, win } from './helpers';

function setup() {
  const s = new TabStore(SIDEBAR_URL);
  s.init({
    windows: [
      win(
        1,
        [
          tab(11, 1, 0, { active: true, lastAccessed: 100 }),
          tab(12, 1, 1, { lastAccessed: 300 }),
          tab(13, 1, 2, { lastAccessed: 200 }),
        ],
        { focused: true },
      ),
      win(2, [tab(21, 2, 0, { active: true, lastAccessed: 50 })]),
    ],
    groups: [],
  });
  return s;
}

describe('recent / MRU', () => {
  it('puts the current tab first, then falls back to tab.lastAccessed', () => {
    const snap = buildSnapshot(setup(), 1, { ...DEFAULT_SETTINGS, recentSlots: 5 });
    expect(snap.recent).toEqual([11, 12, 13, 21]);
  });

  it('our own MRU timestamps override tab.lastAccessed', () => {
    const s = setup();
    s.tabActivated(13, 1, 1000);
    s.tabActivated(11, 1, 2000);
    expect(buildSnapshot(s, 1, { ...DEFAULT_SETTINGS, recentSlots: 5 }).recent).toEqual([
      11, 13, 12, 21,
    ]);
  });

  it('cross-window: the newly focused window tab goes to the top', () => {
    const s = setup();
    s.windowFocused(2, 5000);
    expect(buildSnapshot(s, 1, { ...DEFAULT_SETTINGS, recentSlots: 2 }).recent).toEqual([21, 12]);
    s.windowFocused(1, 6000);
    expect(buildSnapshot(s, 2, { ...DEFAULT_SETTINGS, recentSlots: 2 }).recent).toEqual([11, 21]);
  });

  it('caps at recentSlots and drops closed tabs', () => {
    const s = setup();
    s.tabActivated(13, 1, 1000);
    s.tabActivated(11, 1, 2000);
    s.tabRemoved(13);
    expect(buildSnapshot(s, 1, { ...DEFAULT_SETTINGS, recentSlots: 1 }).recent).toEqual([11]);
    expect(s.mru[13]).toBeUndefined();
  });
});
