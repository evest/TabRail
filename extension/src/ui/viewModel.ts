import type {
  FlatSort,
  GroupNode,
  MinimizedMode,
  Snapshot,
  TabNode,
  WindowNode,
} from '../shared/protocol';
import { dupKey } from '../shared/dupKey';

export { dupKey };

export type Row =
  | { kind: 'tab'; key: string; tab: TabNode; depth: 0 | 1; group?: GroupNode }
  | { kind: 'window'; key: string; win: WindowNode; title: string }
  | { kind: 'group'; key: string; group: GroupNode; count: number };

export interface WindowBlock {
  win: WindowNode;
  rows: Row[];
}

export interface ListOptions {
  /** Tabs to leave out (pinned tabs, unless shown in the list). */
  hidden?: ReadonlySet<number>;
  minimized?: MinimizedMode;
  /** Show this window's header even if it has a single tab (while renaming it). */
  forceHeader?: number | null;
}

/** Windows in display order: minimized ones kept in place, moved to the end, or left out. */
export function orderWindows(
  windows: WindowNode[],
  minimized: MinimizedMode = 'inline',
): WindowNode[] {
  if (minimized === 'hidden') return windows.filter((w) => !w.minimized);
  if (minimized === 'bottom')
    return [...windows.filter((w) => !w.minimized), ...windows.filter((w) => w.minimized)];
  return windows;
}

/**
 * Main list layout rules:
 * - a window with one tab is a single unindented tab row (no header), unless it has a name;
 * - otherwise a header (name, or the active tab's title) + indented tab rows; tab groups form a
 *   collapsible sub-level.
 * `hidden` tabs are left out; the structure (header, counts) still reflects the whole window, and a
 * window or group with nothing left to show disappears.
 */
export function buildMainList(s: Snapshot, opts: ListOptions = {}): WindowBlock[] {
  const hidden = opts.hidden ?? new Set<number>();
  return orderWindows(s.windows, opts.minimized).flatMap((win): WindowBlock[] => {
    const visible = win.tabs.filter((t) => !hidden.has(t.id));
    if (visible.length === 0) return [];
    if (win.tabs.length === 1 && !win.name && opts.forceHeader !== win.id) {
      const tab = win.tabs[0]!;
      return [{ win, rows: [{ kind: 'tab', key: `t${tab.id}`, tab, depth: 0 }] }];
    }
    const active = win.tabs.find((t) => t.active) ?? win.tabs[0];
    const title = win.name || active?.title || '';
    const rows: Row[] = [{ kind: 'window', key: `w${win.id}`, win, title }];
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

/**
 * Flat layout: every tab in one list, with no window headers and no groups. `tabOrder` keeps the
 * window order and each window's tab-strip order; `title` sorts by name (natural, case-insensitive).
 */
export function buildFlatList(
  s: Snapshot,
  opts: { hidden?: ReadonlySet<number>; minimized?: MinimizedMode; sort?: FlatSort } = {},
): TabNode[] {
  const hidden = opts.hidden ?? new Set<number>();
  const tabs = orderWindows(s.windows, opts.minimized).flatMap((w) =>
    w.tabs.filter((t) => !hidden.has(t.id)),
  );
  if (opts.sort === 'title') {
    const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
    tabs.sort((a, b) => collator.compare(a.title, b.title) || a.id - b.id);
  }
  return tabs;
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
