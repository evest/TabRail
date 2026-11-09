import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Snapshot } from '../shared/protocol';
import type { Transport } from './transport/types';
import { buildMainList, isGlobalActive, tabIndex, windowMarkers } from './viewModel';
import { filterTabs } from './filter';
import { TabRow } from './components/TabRow';
import { GroupHeader, WindowHeader } from './components/Headers';

export function App({ transport }: { transport: Transport }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      transport.onMessage((msg) => {
        if (msg.type === 'snapshot') setSnap(msg.snapshot);
        else if (msg.type === 'focusFilter') {
          window.focus();
          input.current?.focus();
          input.current?.select();
        }
      }),
    [transport],
  );
  useEffect(() => input.current?.focus(), []);

  const activate = useCallback(
    (tabId: number) => transport.send({ type: 'activateTab', tabId }),
    [transport],
  );
  const close = useCallback(
    (tabId: number) => transport.send({ type: 'closeTab', tabId }),
    [transport],
  );
  const toggleWindow = useCallback(
    (windowId: number) => transport.send({ type: 'toggleWindowCollapsed', windowId }),
    [transport],
  );
  const toggleGroup = useCallback(
    (groupId: number) => transport.send({ type: 'toggleGroupCollapsed', groupId }),
    [transport],
  );

  const markers = useMemo(() => (snap ? windowMarkers(snap) : new Map()), [snap]);
  const byId = useMemo(() => (snap ? tabIndex(snap) : new Map()), [snap]);
  const blocks = useMemo(() => (snap ? buildMainList(snap, markers) : []), [snap, markers]);
  const filtered = useMemo(() => (snap && query ? filterTabs(snap, query) : []), [snap, query]);
  const filtering = query.trim().length > 0;
  const selIndex = Math.min(sel, Math.max(filtered.length - 1, 0));

  useEffect(() => {
    results.current?.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' });
  }, [selIndex, filtering]);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setSel(Math.max(0, Math.min(filtered.length - 1, selIndex + d)));
    } else if (e.key === 'Enter') {
      const tab = filtered[selIndex];
      if (tab) activate(tab.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (query) {
        setQuery('');
        setSel(0);
      } else transport.send({ type: 'focusLastWindow' });
    }
  }

  const fav = (key?: string) => (key ? snap?.favicons[key] : undefined);
  const slots = snap?.settings.recentSlots ?? 5;

  return (
    <div class="app">
      <div class="top">
        <input
          ref={input}
          class="filter"
          type="search"
          placeholder="Filter tabs"
          spellcheck={false}
          autocomplete="off"
          value={query}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setSel(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div class="recent" style={{ '--slots': slots }} aria-label="Recent tabs">
          {Array.from({ length: slots }, (_, i) => {
            const tab = snap ? byId.get(snap.recent[i] ?? -1) : undefined;
            // Keyed by slot so rows swap content in place instead of moving.
            return tab ? (
              <TabRow
                key={i}
                tab={tab}
                favicon={fav(tab.favicon)}
                depth={0}
                marker={markers.get(tab.windowId)}
                globalActive={false}
                onActivate={activate}
                onClose={close}
              />
            ) : (
              <div key={i} class="row empty" />
            );
          })}
        </div>
      </div>

      <div class="list" ref={results} role="listbox">
        {!snap && <div class="hint">Connecting…</div>}
        {filtering ? (
          filtered.length === 0 ? (
            <div class="hint">No matching tabs</div>
          ) : (
            filtered.map((tab, i) => (
              <TabRow
                key={tab.id}
                tab={tab}
                favicon={fav(tab.favicon)}
                depth={0}
                marker={markers.get(tab.windowId)}
                globalActive={isGlobalActive(tab, snap!)}
                selected={i === selIndex}
                onActivate={activate}
                onClose={close}
              />
            ))
          )
        ) : (
          blocks.map((b) => (
            <section key={b.win.id} class={`win${b.win.focused ? ' focused' : ''}`}>
              {b.rows.map((r) =>
                r.kind === 'window' ? (
                  <WindowHeader
                    key={r.key}
                    win={r.win}
                    marker={r.marker}
                    title={r.title}
                    onToggle={toggleWindow}
                    onActivate={() => {
                      const t = r.win.tabs.find((x) => x.active);
                      if (t) activate(t.id);
                    }}
                  />
                ) : r.kind === 'group' ? (
                  <GroupHeader key={r.key} group={r.group} count={r.count} onToggle={toggleGroup} />
                ) : (
                  <TabRow
                    key={r.key}
                    tab={r.tab}
                    favicon={fav(r.tab.favicon)}
                    depth={r.depth}
                    group={r.group}
                    marker={r.marker}
                    globalActive={isGlobalActive(r.tab, snap!)}
                    onActivate={activate}
                    onClose={close}
                  />
                ),
              )}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
