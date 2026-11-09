import type { GroupNode, Snapshot, TabNode, WindowNode } from '../shared/protocol';

export interface Marker {
  /** 1-based position of the window in creation order. */
  n: number;
  color: string;
}

export type Row =
  | { kind: 'tab'; key: string; tab: TabNode; depth: 0 | 1; group?: GroupNode; marker?: Marker }
  | { kind: 'window'; key: string; win: WindowNode; marker: Marker; title: string }
  | { kind: 'group'; key: string; group: GroupNode; count: number };

export interface WindowBlock {
  win: WindowNode;
  marker: Marker;
  rows: Row[];
}

export const MARKER_COLORS = [
  'var(--m1)',
  'var(--m2)',
  'var(--m3)',
  'var(--m4)',
  'var(--m5)',
  'var(--m6)',
  'var(--m7)',
  'var(--m8)',
];

export function windowMarkers(s: Snapshot): Map<number, Marker> {
  return new Map(
    s.windows.map((w, i) => [w.id, { n: i + 1, color: MARKER_COLORS[i % MARKER_COLORS.length]! }]),
  );
}

/**
 * Main list layout rules:
 * - a window with one tab is a single tab row carrying the window marker (no header, no indent);
 * - a window with more tabs is a header + indented tab rows; tab groups form a collapsible sub-level.
 */
export function buildMainList(s: Snapshot, markers = windowMarkers(s)): WindowBlock[] {
  return s.windows.map((win) => {
    const marker = markers.get(win.id)!;
    if (win.tabs.length === 1) {
      const tab = win.tabs[0]!;
      return { win, marker, rows: [{ kind: 'tab', key: `t${tab.id}`, tab, depth: 0, marker }] };
    }
    const active = win.tabs.find((t) => t.active) ?? win.tabs[0];
    const rows: Row[] = [
      { kind: 'window', key: `w${win.id}`, win, marker, title: active?.title ?? '' },
    ];
    if (!win.collapsed) {
      const groups = new Map(win.groups.map((g) => [g.id, g]));
      let current: GroupNode | undefined;
      for (const tab of win.tabs) {
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
    return { win, marker, rows };
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
