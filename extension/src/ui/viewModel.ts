import type { GroupNode, Snapshot, TabNode, WindowNode } from '../shared/protocol';

export type Row =
  | { kind: 'tab'; key: string; tab: TabNode; depth: 0 | 1; group?: GroupNode }
  | { kind: 'window'; key: string; win: WindowNode; title: string }
  | { kind: 'group'; key: string; group: GroupNode; count: number };

export interface WindowBlock {
  win: WindowNode;
  rows: Row[];
}

/**
 * Main list layout rules:
 * - a window with one tab is a single unindented tab row (no header);
 * - a window with more tabs is a header + indented tab rows; tab groups form a collapsible sub-level.
 * `hidden` tabs (pinned tabs, unless shown in the list) are left out; the structure (header, counts)
 * still reflects the whole window, and a window or group with nothing left to show disappears.
 */
export function buildMainList(s: Snapshot, hidden: ReadonlySet<number> = new Set()): WindowBlock[] {
  return s.windows.flatMap((win): WindowBlock[] => {
    const visible = win.tabs.filter((t) => !hidden.has(t.id));
    if (visible.length === 0) return [];
    if (win.tabs.length === 1) {
      const tab = win.tabs[0]!;
      return [{ win, rows: [{ kind: 'tab', key: `t${tab.id}`, tab, depth: 0 }] }];
    }
    const active = win.tabs.find((t) => t.active) ?? win.tabs[0];
    const rows: Row[] = [{ kind: 'window', key: `w${win.id}`, win, title: active?.title ?? '' }];
    if (!win.collapsed) {
      const groups = new Map(win.groups.map((g) => [g.id, g]));
      let current: GroupNode | undefined;
      for (const tab of visible) {
        const group = tab.groupId !== -1 ? groups.get(tab.groupId) : undefined;
        if (group && group !== current) {
          const count = win.tabs.filter((t) => t.groupId === group.id).length;
          rows.push({ kind: 'group', key: `g${group.id}`, group, count });
        }
        current = group;
        if (group?.collapsed) continue;
        rows.push({ kind: 'tab', key: `t${tab.id}`, tab, depth: 1, group });
      }
    }
    return [{ win, rows }];
  });
}

export function isGlobalActive(tab: TabNode, s: Snapshot): boolean {
  return tab.active && tab.windowId === s.focusedWindowId;
}

export function tabIndex(s: Snapshot): Map<number, TabNode> {
  const m = new Map<number, TabNode>();
  for (const w of s.windows) for (const t of w.tabs) m.set(t.id, t);
  return m;
}

/** Compact "time since" for the Recent strip: now, 5m, 3h, 2d. */
export function timeAgo(then: number, now: number): string {
  const min = Math.floor((now - then) / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/**
 * Identity for duplicate detection: the URL without its #fragment. Blank and new-tab pages never
 * count as duplicates (having several open is normal).
 */
export function dupKey(url: string): string | null {
  const u = url.split('#')[0]!;
  if (
    !u ||
    /^(about:blank|about:newtab|chrome:\/\/newtab|chrome:\/\/new-tab-page|edge:\/\/newtab)/.test(u)
  )
    return null;
  return u;
}

/** dupKey -> number of open tabs with that key, only for keys open more than once. */
export function duplicateCounts(s: Snapshot): Map<string, number> {
  const counts = new Map<string, number>();
  for (const w of s.windows)
    for (const t of w.tabs) {
      const k = dupKey(t.url);
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  for (const [k, n] of counts) if (n < 2) counts.delete(k);
  return counts;
}
