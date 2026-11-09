import type { GroupNode, WindowNode } from '../../shared/protocol';
import type { Marker } from '../viewModel';
import { ChevronIcon, SleepIcon } from './Icons';
import { WindowMarker } from './WindowMarker';

export function WindowHeader(p: {
  win: WindowNode;
  marker: Marker;
  title: string;
  onToggle: (windowId: number) => void;
  onActivate: () => void;
}) {
  const dim = p.win.sleeping || p.win.minimized;
  return (
    <div
      class={`row whead${dim ? ' dim' : ''}`}
      title={`${p.win.tabs.length} tabs${p.win.minimized ? ' · minimized' : ''}${p.win.sleeping ? ' · sleeping' : ''}`}
      onClick={p.onActivate}
    >
      <button
        class="chev-btn"
        aria-expanded={!p.win.collapsed}
        title={p.win.collapsed ? 'Expand' : 'Collapse'}
        onClick={(e) => {
          e.stopPropagation();
          p.onToggle(p.win.id);
        }}
      >
        <ChevronIcon open={!p.win.collapsed} />
      </button>
      <WindowMarker marker={p.marker} />
      <span class="title">{p.title}</span>
      {dim && <SleepIcon />}
      <span class="count">{p.win.tabs.length}</span>
    </div>
  );
}

export function GroupHeader(p: {
  group: GroupNode;
  count: number;
  onToggle: (groupId: number) => void;
}) {
  return (
    <div
      class="row ghead d1 in-group"
      style={{ '--group': `var(--g-${p.group.color})` }}
      onClick={() => p.onToggle(p.group.id)}
      aria-expanded={!p.group.collapsed}
    >
      <ChevronIcon open={!p.group.collapsed} />
      <span class="gname">{p.group.title || 'Group'}</span>
      <span class="count">{p.count}</span>
    </div>
  );
}
