import { useEffect, useRef } from 'preact/hooks';
import type { GroupNode, WindowNode } from '../../shared/protocol';
import { ChevronIcon, SleepIcon } from './Icons';

export function WindowHeader(p: {
  win: WindowNode;
  title: string;
  /** Show an inline name editor instead of the title. */
  renaming?: boolean;
  /** Finish renaming: the new name (empty clears it), or null to cancel. */
  onRename?: (windowId: number, name: string | null) => void;
  onToggle: (windowId: number) => void;
  onActivate: () => void;
  onMenu: (windowId: number, x: number, y: number) => void;
}) {
  const dim = p.win.sleeping || p.win.minimized;
  const active = p.win.tabs.find((t) => t.active);
  const status = `${p.win.tabs.length} tabs${p.win.minimized ? ' · minimized' : ''}${p.win.sleeping ? ' · sleeping' : ''}`;
  return (
    <div
      class={`row whead${dim ? ' dim' : ''}${p.win.name ? ' named' : ''}`}
      title={p.win.name && active ? `${p.win.name}\nActive: ${active.title}\n${status}` : status}
      onClick={p.onActivate}
      onContextMenu={(e) => {
        e.preventDefault();
        p.onMenu(p.win.id, e.clientX, e.clientY);
      }}
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
      {p.renaming ? (
        <RenameInput
          initial={p.win.name ?? ''}
          placeholder={active?.title ?? 'Window name'}
          onDone={(name) => p.onRename?.(p.win.id, name)}
        />
      ) : (
        <span class="title">{p.title}</span>
      )}
      {dim && <SleepIcon />}
      <span class="count">{p.win.tabs.length}</span>
    </div>
  );
}

function RenameInput(p: {
  initial: string;
  placeholder: string;
  onDone: (name: string | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    p.onDone(name);
  };
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      class="rename"
      aria-label="Window name"
      defaultValue={p.initial}
      placeholder={p.placeholder}
      spellcheck={false}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(e.currentTarget.value);
        else if (e.key === 'Escape') finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
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
