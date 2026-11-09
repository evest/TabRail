import { memo } from 'preact/compat';
import type { GroupNode, TabNode } from '../../shared/protocol';
import type { Marker } from '../viewModel';
import { CloseIcon, GlobeIcon, PinIcon, SleepIcon, SpeakerIcon } from './Icons';
import { WindowMarker } from './WindowMarker';

export interface TabRowProps {
  tab: TabNode;
  favicon?: string;
  depth: 0 | 1;
  group?: GroupNode;
  marker?: Marker;
  globalActive: boolean;
  selected?: boolean;
  onActivate: (tabId: number) => void;
  onClose: (tabId: number) => void;
}

function TabRowImpl(p: TabRowProps) {
  const { tab } = p;
  const cls = [
    'row',
    'tab',
    `d${p.depth}`,
    tab.active && 'active',
    p.globalActive && 'global-active',
    tab.sleeping && 'sleeping',
    p.selected && 'selected',
    p.group && 'in-group',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      class={cls}
      role="option"
      aria-selected={p.selected ?? tab.active}
      title={tab.url ? `${tab.title}\n${tab.url}` : tab.title}
      style={p.group ? { '--group': `var(--g-${p.group.color})` } : undefined}
      data-selected={p.selected ? '' : undefined}
      onClick={() => p.onActivate(tab.id)}
      onMouseDown={(e) => e.button === 1 && e.preventDefault() /* no autoscroll */}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          p.onClose(tab.id);
        }
      }}
    >
      {p.marker && <WindowMarker marker={p.marker} />}
      <span class={`fav${tab.loading ? ' loading' : ''}`}>
        {p.favicon ? (
          <img src={p.favicon} width={16} height={16} alt="" draggable={false} />
        ) : (
          <GlobeIcon />
        )}
      </span>
      <span class="title">{tab.title}</span>
      {tab.pinned && <PinIcon />}
      {(tab.audible || tab.muted) && <SpeakerIcon muted={tab.muted} />}
      {tab.sleeping && <SleepIcon />}
      <button
        class="close"
        title="Close tab"
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          p.onClose(tab.id);
        }}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

const TAB_KEYS: (keyof TabNode)[] = [
  'id',
  'title',
  'url',
  'active',
  'pinned',
  'audible',
  'muted',
  'sleeping',
  'loading',
  'groupId',
];

/** Snapshots are rebuilt wholesale, so compare tab fields rather than object identity. */
function sameProps(a: TabRowProps, b: TabRowProps): boolean {
  return (
    a.favicon === b.favicon &&
    a.depth === b.depth &&
    a.globalActive === b.globalActive &&
    a.selected === b.selected &&
    a.group?.color === b.group?.color &&
    a.marker?.n === b.marker?.n &&
    a.onActivate === b.onActivate &&
    a.onClose === b.onClose &&
    TAB_KEYS.every((k) => a.tab[k] === b.tab[k])
  );
}

export const TabRow = memo(TabRowImpl, sameProps);
