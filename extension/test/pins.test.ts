import { describe, expect, it } from 'vitest';
import { TabStore } from '../src/background/tabStore';
import { buildSnapshot } from '../src/background/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/protocol';
import { buildMainList, duplicateCounts, dupKey } from '../src/ui/viewModel';
import { SIDEBAR_URL, tab, win } from './helpers';

const A = 'https://a.example/';
const B = 'https://b.example/';

function setup(railPins?: { tabId: number; url: string }[]) {
  const s = new TabStore(SIDEBAR_URL);
  s.init({
    windows: [
      win(1, [tab(11, 1, 0, { active: true, url: A }), tab(12, 1, 1, { url: B })], {
        focused: true,
      }),
      win(2, [tab(21, 2, 0, { active: true, url: `${A}#section` })]),
    ],
    groups: [],
    railPins,
  });
  return s;
}

describe('rail pins', () => {
  it('toggles, keeps pin order, and excludes pinned tabs from Recent', () => {
    const s = setup();
    s.toggleRailPin(21);
    s.toggleRailPin(12);
    const snap = buildSnapshot(s, 1, DEFAULT_SETTINGS);
    expect(snap.pinned).toEqual([21, 12]);
    expect(snap.recent).not.toContain(12);
    expect(snap.recent).not.toContain(21);
    s.toggleRailPin(21);
    expect(buildSnapshot(s, 2, DEFAULT_SETTINGS).pinned).toEqual([12]);
    expect(s.dirty.pins).toBe(true);
  });

  it('drops the pin when the tab closes and follows tab replacement', () => {
    const s = setup();
    s.toggleRailPin(12);
    s.toggleRailPin(21);
    s.tabRemoved(12);
    s.tabReplaced(21, tab(22, 2, 0, { active: true, url: A }));
    expect(s.railPins).toEqual([22]);
  });

  it('re-matches persisted pins by id, then by URL (browser restart), else drops them', () => {
    const s = setup([
      { tabId: 11, url: A }, // same id + url: kept
      { tabId: 999, url: B }, // id gone, url open as tab 12: re-matched
      { tabId: 998, url: 'https://gone.example/' }, // dropped
    ]);
    expect(s.railPins).toEqual([11, 12]);
    expect(s.dirty.pins).toBe(true);
  });

  it('persists ids with current URLs', () => {
    const s = setup();
    s.toggleRailPin(12);
    expect(s.railPinsForStorage()).toEqual([{ tabId: 12, url: B }]);
  });
});

describe('duplicates', () => {
  it('matches URLs ignoring the fragment; new-tab pages never count', () => {
    expect(dupKey(`${A}#x`)).toBe(A);
    expect(dupKey('chrome://newtab/')).toBeNull();
    expect(dupKey('about:blank')).toBeNull();
  });

  it('counts only URLs open more than once', () => {
    const snap = buildSnapshot(setup(), 1, DEFAULT_SETTINGS);
    expect([...duplicateCounts(snap)]).toEqual([[A, 2]]);
  });
});

describe('pinned tabs in the window list', () => {
  const rowsOf = (hidden: number[]) => {
    const snap = buildSnapshot(setup(), 1, DEFAULT_SETTINGS);
    return buildMainList(snap, new Set(hidden)).map((b) => b.rows.map((r) => r.key));
  };

  it('leaves hidden tabs out but keeps the window header', () => {
    expect(rowsOf([12])).toEqual([['w1', 't11'], ['t21']]);
  });

  it('drops a window with nothing left to show', () => {
    expect(rowsOf([21])).toEqual([['w1', 't11', 't12']]);
  });

  it('defaults to hiding pinned tabs', () => {
    expect(DEFAULT_SETTINGS.showPinnedInList).toBe(false);
  });
});
