import { memo } from 'preact/compat';
import type { GroupNode, TabNode } from '../../shared/protocol';
import { CloseIcon, GlobeIcon, PinIcon, RailPinIcon, SleepIcon, SpeakerIcon } from './Icons';

export interface TabRowProps {
  tab: TabNode;
  favicon?: string;
  depth: 0 | 1;
  group?: GroupNode;
  globalActive: boolean;
  selected?: boolean;
  /** Dim right-aligned note (Recent strip: time since last use); yields to the close button on hover. */
  aside?: string;
  /** Number of open tabs with the same URL (badge shown when >= 2). */
  dupCount?: number;
  /** A duplicate of the currently selected tab. */
  dupHighlight?: boolean;
  /** Row lives in the Pinned section: shows a leading pin that unpins. */
  pinnedEntry?: boolean;
  /** Tab is in the Pinned section (hover button says "Unpin"). */
  railPinned?: boolean;
  onTogglePin?: (tabId: number) => void;
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
    p.dupHighlight && 'dup-hl',
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
      {p.pinnedEntry && p.onTogglePin && (
        <button
          class="lead-pin"
          title="Unpin"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            p.onTogglePin!(tab.id);
          }}
        >
          <RailPinIcon filled />
        </button>
      )}
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
      {p.dupCount != null && p.dupCount > 1 && (
        <span class="dup" title={`Open in ${p.dupCount} tabs`}>
          {p.dupCount}
        </span>
      )}
      {p.aside && <span class="aside">{p.aside}</span>}
      {!p.pinnedEntry && p.onTogglePin && (
        <button
          class="row-btn pin-btn"
          title={p.railPinned ? 'Unpin' : 'Pin to top'}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            p.onTogglePin!(tab.id);
          }}
        >
          <RailPinIcon filled={!!p.railPinned} />
        </button>
      )}
      <button
        class="row-btn close"
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
    a.aside === b.aside &&
    a.dupCount === b.dupCount &&
    a.dupHighlight === b.dupHighlight &&
    a.pinnedEntry === b.pinnedEntry &&
    a.railPinned === b.railPinned &&
    a.onTogglePin === b.onTogglePin &&
    a.group?.color === b.group?.color &&
    a.onActivate === b.onActivate &&
    a.onClose === b.onClose &&
    TAB_KEYS.every((k) => a.tab[k] === b.tab[k])
  );
}

export const TabRow = memo(TabRowImpl, sameProps);
