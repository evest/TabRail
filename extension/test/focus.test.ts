import { describe, expect, it } from 'vitest';
import { TabStore } from '../src/background/tabStore';
import { WINDOW_ID_NONE } from '../src/background/model';
import { buildSnapshot } from '../src/background/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/protocol';
import { SIDEBAR_URL, tab, win } from './helpers';

function setup() {
  const s = new TabStore(SIDEBAR_URL);
  s.init({
    windows: [
      win(1, [tab(11, 1, 0, { active: true }), tab(12, 1, 1)], { focused: true }),
      win(2, [tab(21, 2, 0, { active: true })]),
      win(3, [tab(31, 3, 0, { active: true, url: SIDEBAR_URL })], { type: 'popup' }),
    ],
    groups: [],
  });
  return s;
}

describe('focus tracking', () => {
  it('starts from the focused normal window', () => {
    expect(setup().lastFocusedWindowId).toBe(1);
  });

  it('falls back to getLastFocused when the sidebar is focused at startup', () => {
    const s = new TabStore(SIDEBAR_URL);
    s.init({
      windows: [
        win(1, [tab(11, 1, 0, { active: true })]),
        win(3, [tab(31, 3, 0, { url: SIDEBAR_URL })], { type: 'popup', focused: true }),
      ],
      groups: [],
      focusedWindowId: 1,
    });
    expect(s.lastFocusedWindowId).toBe(1);
  });

  it('ignores WINDOW_ID_NONE and the sidebar window', () => {
    const s = setup();
    s.windowFocused(2, 10);
    s.windowFocused(WINDOW_ID_NONE, 20);
    s.windowFocused(3, 30);
    expect(s.lastFocusedWindowId).toBe(2);
    const snap = buildSnapshot(s, 1, DEFAULT_SETTINGS);
    expect(snap.focusedWindowId).toBe(2);
    expect(snap.windows.map((w) => w.focused)).toEqual([false, true]);
  });

  it('focusing a window counts as accessing its active tab', () => {
    const s = setup();
    s.windowFocused(2, 1234);
    expect(s.mru[21]).toBe(1234);
  });

  it('isCurrent: only the active tab of the focused, non-minimized window', () => {
    const s = setup();
    expect(s.isCurrent(11)).toBe(true);
    expect(s.isCurrent(12)).toBe(false); // not active
    expect(s.isCurrent(21)).toBe(false); // active, but window 2 is not focused
    s.windowStateChanged(1, 'minimized');
    expect(s.isCurrent(11)).toBe(false); // clicking again restores
    s.windowStateChanged(1, 'maximized');
    expect(s.isCurrent(11)).toBe(true);
  });

  it('a tab activated in the sidebar window is not recorded', () => {
    const s = setup();
    s.tabActivated(31, 3, 99);
    expect(s.mru[31]).toBeUndefined();
  });
});

describe('clickAction (taskbar-style click on the current tab)', () => {
  it('activates a tab that is not current', () => {
    const s = setup();
    expect(s.clickAction(12, false, 5000)).toBe('activate');
    expect(s.clickAction(21, true, 5000)).toBe('activate');
  });

  it('minimizes when the sidebar already had focus', () => {
    const s = setup();
    s.windowFocused(3, 1000); // sidebar
    expect(s.clickAction(11, false, 5000)).toBe('minimize');
  });

  it('does nothing when the click only moved focus from that window to the sidebar', () => {
    const s = setup();
    s.windowFocused(1, 1000);
    s.windowFocused(WINDOW_ID_NONE, 4000); // transient, as Chrome may report mid-switch
    s.windowFocused(3, 4001);
    expect(s.clickAction(11, true, 4010)).toBe('none');
  });

  it('handles the click message arriving before the sidebar focus event', () => {
    const s = setup();
    s.windowFocused(1, 1000);
    expect(s.clickAction(11, true, 4010)).toBe('none');
  });

  it('brings the window back when another application had the foreground', () => {
    const s = setup();
    s.windowFocused(1, 1000);
    s.windowFocused(WINDOW_ID_NONE, 2000); // user switched to another app
    s.windowFocused(3, 60_000); // ...and later clicks the sidebar
    expect(s.clickAction(11, true, 60_010)).toBe('activate');
  });

  it('Phase B: no sidebar window, focus moves to the host app (NONE)', () => {
    const s = setup();
    s.setSidebarWindow(null);
    s.windowFocused(1, 1000);
    s.windowFocused(WINDOW_ID_NONE, 4000);
    expect(s.clickAction(11, true, 4020)).toBe('none');
  });
});
