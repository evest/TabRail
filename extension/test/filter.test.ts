import { describe, expect, it } from 'vitest';
import { filterTabs, scoreTab, tokenize } from '../src/ui/filter';
import type { Snapshot, TabNode } from '../src/shared/protocol';

function t(id: number, title: string, url: string, lastAccessed = 0): TabNode {
  return {
    id,
    windowId: 1,
    index: id,
    title,
    url,
    host: new URL(url).host,
    active: false,
    pinned: false,
    audible: false,
    muted: false,
    sleeping: false,
    loading: false,
    groupId: -1,
    lastAccessed,
  };
}
function snap(tabs: TabNode[]): Snapshot {
  return {
    seq: 1,
    focusedWindowId: 1,
    pinned: [],
    recent: [],
    favicons: {},
    settings: { recentSlots: 5 },
    windows: [
      {
        id: 1,
        focused: true,
        minimized: false,
        sleeping: false,
        collapsed: false,
        tabs,
        groups: [],
      },
    ],
  };
}

describe('filter', () => {
  it('tokenizes case-insensitively', () => {
    expect(tokenize('  Foo   BAR ')).toEqual(['foo', 'bar']);
  });

  it('requires every token to match title or URL', () => {
    const tab = t(1, 'Pull request #482', 'https://github.com/tabrail/pull/482');
    expect(scoreTab(tab, ['pull', 'github'])).not.toBeNull();
    expect(scoreTab(tab, ['pull', 'gitlab'])).toBeNull();
  });

  it('ranks title prefix > word start > host > substring > url', () => {
    const tabs = [
      t(1, 'Something', 'https://x.example/docs'), // url only
      t(2, 'Mydocs page', 'https://a.example/'), // title substring
      t(3, 'Other', 'https://docs.example/'), // host word start
      t(4, 'Google docs list', 'https://b.example/'), // title word start
      t(5, 'Docs home', 'https://c.example/'), // title prefix
    ];
    expect(filterTabs(snap(tabs), 'docs').map((x) => x.id)).toEqual([5, 4, 3, 2, 1]);
  });

  it('breaks ties by recency', () => {
    const tabs = [t(1, 'Inbox', 'https://a.example/', 10), t(2, 'Inbox', 'https://b.example/', 30)];
    expect(filterTabs(snap(tabs), 'inbox').map((x) => x.id)).toEqual([2, 1]);
  });

  it('empty query yields nothing', () => {
    expect(filterTabs(snap([t(1, 'a', 'https://a.example/')]), '   ')).toEqual([]);
  });
});
