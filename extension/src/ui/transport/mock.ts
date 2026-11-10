// Mock transport for running the UI in a plain browser tab (standalone build, `?mock`).
// It drives the real (pure) TabStore with fake Chrome events, so the snapshots are realistic.
import { DEFAULT_SETTINGS } from '../../shared/protocol';
import type { FromUi, ToUi } from '../../shared/protocol';
import { TabStore } from '../../background/tabStore';
import { buildSnapshot, hostOf, type FaviconLookup } from '../../background/snapshot';
import type { RawGroup, RawTab, RawWindow } from '../../background/model';
import { Listeners, type Transport } from './types';

const SITES: [string, string][] = [
  ['GitHub · Pull request #482 · tabrail/tabrail', 'https://github.com/tabrail/tabrail/pull/482'],
  ['Inbox (12) - Gmail', 'https://mail.google.com/mail/u/0/#inbox'],
  ['Vite 8 migration guide', 'https://vite.dev/guide/migration'],
  [
    'chrome.tabs API reference | Chrome for Developers',
    'https://developer.chrome.com/docs/extensions/reference/api/tabs',
  ],
  [
    'Stack Overflow - How to dock a WPF window as an AppBar',
    'https://stackoverflow.com/questions/75785',
  ],
  ['YouTube - Lo-fi beats to refactor to', 'https://www.youtube.com/watch?v=abc123'],
  ['Hacker News', 'https://news.ycombinator.com/'],
  ['Preact – Fast 3kB alternative to React', 'https://preactjs.com/'],
  ['Q4 planning - Google Docs', 'https://docs.google.com/document/d/1x'],
  ['Budget 2027 - Google Sheets', 'https://docs.google.com/spreadsheets/d/2y'],
  [
    'MDN: CSS container queries',
    'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment',
  ],
  [
    'Yr – Værvarsel for Oslo',
    'https://www.yr.no/nb/v%C3%A6rvarsel/daglig-tabell/1-72837/Norge/Oslo',
  ],
  ['Figma – Sidebar density explorations', 'https://www.figma.com/design/xyz'],
  [
    'Native messaging | Chrome for Developers',
    'https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging',
  ],
  [
    'SHAppBarMessage function (shellapi.h) - Win32 apps | Microsoft Learn',
    'https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shappbarmessage',
  ],
  ['Linear – TAB-112 Recent strip flicker', 'https://linear.app/tabrail/issue/TAB-112'],
  ['Spotify – Web Player', 'https://open.spotify.com/'],
  ['Wikipedia – Most recently used', 'https://en.wikipedia.org/wiki/Cache_replacement_policies'],
];

const COLORS = [
  '#4b8bf5',
  '#e8453c',
  '#f9bb2d',
  '#3aa757',
  '#a142f4',
  '#24c1e0',
  '#fa903e',
  '#e52592',
];

function svgIcon(host: string): string {
  let h = 0;
  for (const c of host) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const color = COLORS[h % COLORS.length]!;
  const letter = (host.replace(/^www\./, '')[0] ?? '?').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="3" fill="${color}"/><text x="8" y="12" font-family="Segoe UI,Arial" font-size="10" font-weight="700" text-anchor="middle" fill="#fff">${letter}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

const mockFavicons: FaviconLookup = {
  keyFor: (url) => hostOf(url) || undefined,
  get: (key) => svgIcon(key),
};

export class MockTransport implements Transport {
  private readonly listeners = new Listeners<ToUi>();
  private readonly store = new TabStore('mock://sidebar.html');
  private seq = 0;
  private nextTabId = 1000;
  private pending: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.seed();
    (globalThis as { tabrailMock?: MockTransport }).tabrailMock = this;
    // Gentle background churn so loading/audio/MRU states are visible.
    setInterval(() => this.churn(), 4000);
  }

  send(msg: FromUi): void {
    const s = this.store;
    const now = Date.now();
    switch (msg.type) {
      case 'ready':
        break;
      case 'activateTab': {
        const t = s.tabs.get(msg.tabId);
        if (!t) return;
        const action = msg.click ? s.clickAction(msg.tabId, msg.click.focusing, now) : 'activate';
        if (action === 'none') break;
        if (action === 'minimize') {
          s.windowStateChanged(t.windowId, 'minimized');
          break;
        }
        s.tabActivated(msg.tabId, t.windowId, now);
        s.windowStateChanged(t.windowId, 'normal');
        s.windowFocused(t.windowId, now);
        break;
      }
      case 'closeTab': {
        const t = s.tabs.get(msg.tabId);
        if (!t) return;
        const wasActive = t.active;
        s.tabRemoved(msg.tabId);
        if (s.tabsOf(t.windowId).length === 0) s.windowRemoved(t.windowId);
        else if (wasActive) {
          const next = s.tabsOf(t.windowId)[Math.min(t.index, s.tabsOf(t.windowId).length - 1)];
          if (next?.id != null) s.tabActivated(next.id, t.windowId, now);
        }
        break;
      }
      case 'toggleWindowCollapsed':
        s.toggleWindowCollapsed(msg.windowId);
        break;
      case 'toggleGroupCollapsed':
        s.toggleGroupCollapsed(msg.groupId);
        break;
      case 'toggleRailPin':
        s.toggleRailPin(msg.tabId);
        break;
      case 'focusLastWindow':
        console.info('[mock] focusLastWindow');
        return;
    }
    this.schedule();
  }

  onMessage(cb: (msg: ToUi) => void): () => void {
    const off = this.listeners.add(cb);
    this.schedule();
    return off;
  }

  /** Console helper: tabrailMock.focusFilter() simulates the global shortcut. */
  focusFilter(): void {
    this.listeners.emit({ type: 'focusFilter' });
  }

  private schedule(): void {
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      this.listeners.emit({
        type: 'snapshot',
        snapshot: buildSnapshot(this.store, ++this.seq, DEFAULT_SETTINGS, mockFavicons),
      });
    }, 50);
  }

  private tab(windowId: number, index: number, site: number, extra: Partial<RawTab> = {}): RawTab {
    const [title, url] = SITES[site % SITES.length]!;
    return {
      id: this.nextTabId++,
      windowId,
      index,
      title,
      url,
      active: false,
      pinned: false,
      discarded: false,
      status: 'complete',
      groupId: -1,
      lastAccessed: Date.now() - (site + 1) * 60_000,
      ...extra,
    };
  }

  private seed(): void {
    const w1: RawTab[] = [
      this.tab(1, 0, 1, { pinned: true }),
      this.tab(1, 1, 0, { active: true, groupId: 10 }),
      this.tab(1, 2, 2, { groupId: 10 }),
      this.tab(1, 3, 3, { groupId: 10 }),
      this.tab(1, 4, 13, { groupId: 11 }),
      this.tab(1, 5, 14, { groupId: 11 }),
      this.tab(1, 6, 5, { audible: true }),
      this.tab(1, 7, 6, { discarded: true }),
      this.tab(1, 8, 7),
    ];
    const w2: RawTab[] = [this.tab(2, 0, 11, { active: true })];
    const w3: RawTab[] = [
      this.tab(3, 0, 8, { active: true }),
      this.tab(3, 1, 9),
      this.tab(3, 2, 12, { status: 'loading' }),
      this.tab(3, 3, 15, { mutedInfo: { muted: true }, audible: true }),
      this.tab(3, 4, 0), // duplicate of window 1's active tab
    ];
    const w4: RawTab[] = [
      this.tab(4, 0, 10, { active: true, discarded: true }),
      this.tab(4, 1, 17, { discarded: true }),
      this.tab(4, 2, 1, { discarded: true }), // duplicate
    ];
    const w5: RawTab[] = [this.tab(5, 0, 16, { active: true, audible: true })];
    const windows: RawWindow[] = [
      { id: 1, type: 'normal', focused: true, state: 'normal', tabs: w1 },
      { id: 2, type: 'normal', focused: false, state: 'normal', tabs: w2 },
      { id: 3, type: 'normal', focused: false, state: 'normal', tabs: w3 },
      { id: 4, type: 'normal', focused: false, state: 'minimized', tabs: w4 },
      { id: 5, type: 'normal', focused: false, state: 'normal', tabs: w5 },
      { id: 9, type: 'popup', focused: false, state: 'normal', tabs: [] },
    ];
    const groups: RawGroup[] = [
      { id: 10, windowId: 1, title: 'TabRail', color: 'blue', collapsed: false },
      { id: 11, windowId: 1, title: 'Phase B', color: 'purple', collapsed: false },
    ];
    const pins = [w3[1]!, w2[0]!].map((t) => ({ tabId: t.id!, url: t.url! }));
    this.store.init({ windows, groups, focusedWindowId: 1, railPins: pins });
  }

  private churn(): void {
    const s = this.store;
    for (const t of s.tabs.values()) {
      if (t.status === 'loading') t.status = 'complete';
    }
    const all = [...s.tabs.values()];
    const pick = all[Math.floor(Math.random() * all.length)];
    if (pick && !pick.discarded && Math.random() < 0.3) pick.status = 'loading';
    this.schedule();
  }
}
