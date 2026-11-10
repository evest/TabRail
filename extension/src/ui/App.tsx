import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Snapshot, TabNode } from '../shared/protocol';
import type { Transport } from './transport/types';
import {
  buildMainList,
  dupKey,
  duplicateCounts,
  isGlobalActive,
  tabIndex,
  timeAgo,
} from './viewModel';
import { filterTabs } from './filter';
import { TabRow } from './components/TabRow';
import { GroupHeader, WindowHeader } from './components/Headers';
import { GearIcon } from './components/Icons';
import { FocusClickGuard, windowFocusSource } from './focusGuard';

export function App({ transport }: { transport: Transport }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Clock for the Recent strip's "time since" labels; snapshots only arrive on tab events.
  const [now, setNow] = useState(() => Date.now());
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      transport.onMessage((msg) => {
        if (msg.type === 'snapshot') {
          setSnap(msg.snapshot);
          setNow(Date.now());
        } else if (msg.type === 'focusFilter') {
          window.focus();
          input.current?.focus();
          input.current?.select();
        }
      }),
    [transport],
  );
  useEffect(() => input.current?.focus(), []);
  // Snapshots only arrive on tab events; tick so the labels age.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const [focusGuard] = useState(() => new FocusClickGuard(windowFocusSource(window)));
  // Mouse activation. The click that merely brings the sidebar into focus never minimizes.
  const activate = useCallback(
    (tabId: number) =>
      transport.send({
        type: 'activateTab',
        tabId,
        click: { focusing: focusGuard.isFocusingClick() },
      }),
    [transport, focusGuard],
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
  const togglePin = useCallback(
    (tabId: number) => transport.send({ type: 'toggleRailPin', tabId }),
    [transport],
  );

  const byId = useMemo(() => (snap ? tabIndex(snap) : new Map()), [snap]);
  const blocks = useMemo(() => {
    if (!snap) return [];
    const hidden = new Set(snap.settings.showPinnedInList ? [] : snap.pinned);
    return buildMainList(snap, hidden);
  }, [snap]);
  const filtered = useMemo(() => (snap && query ? filterTabs(snap, query) : []), [snap, query]);
  const filtering = query.trim().length > 0;
  const selIndex = Math.min(sel, Math.max(filtered.length - 1, 0));
  const dups = useMemo(() => (snap ? duplicateCounts(snap) : new Map<string, number>()), [snap]);
  const pinnedSet = useMemo(() => new Set(snap?.pinned ?? []), [snap]);

  // The "selected" tab whose duplicates get highlighted: the filter selection while filtering,
  // otherwise the globally active tab.
  const selectedTab: TabNode | undefined = filtering
    ? filtered[selIndex]
    : snap?.windows.find((w) => w.id === snap.focusedWindowId)?.tabs.find((t) => t.active);
  const selectedDupKey = selectedTab ? dupKey(selectedTab.url) : null;
  const hlKey = selectedDupKey && dups.has(selectedDupKey) ? selectedDupKey : null;

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
      if (tab) transport.send({ type: 'activateTab', tabId: tab.id });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (query) {
        setQuery('');
        setSel(0);
      } else transport.send({ type: 'focusLastWindow' });
    }
  }

  const fav = (key?: string) => (key ? snap?.favicons[key] : undefined);
  /** Props every tab row shares, wherever it appears. */
  const common = (tab: TabNode) => {
    const k = dupKey(tab.url);
    return {
      tab,
      favicon: fav(tab.favicon),
      dupCount: k ? dups.get(k) : undefined,
      dupHighlight: hlKey != null && k === hlKey && tab.id !== selectedTab?.id,
      railPinned: pinnedSet.has(tab.id),
      onTogglePin: togglePin,
      onActivate: activate,
      onClose: close,
    };
  };
  const pinnedTabs = (snap?.pinned ?? []).flatMap((id) => byId.get(id) ?? []);
  const slots = snap?.settings.recentSlots ?? 5;

  return (
    <div class="app">
      <div class="top">
        <div class="filter-row">
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
          <button
            class={`gear${settingsOpen ? ' open' : ''}`}
            title="Settings"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((o) => !o)}
          >
            <GearIcon />
          </button>
        </div>
        {settingsOpen && snap && (
          <div class="settings" role="dialog" aria-label="Settings">
            <label>
              <input
                type="checkbox"
                checked={snap.settings.showPinnedInList}
                onChange={(e) =>
                  transport.send({
                    type: 'updateSettings',
                    patch: { showPinnedInList: e.currentTarget.checked },
                  })
                }
              />
              Also show pinned tabs in the window list
            </label>
          </div>
        )}
        {pinnedTabs.length > 0 && (
          <>
            <div class="section-label" title="Tabs you pinned here; click the pin to unpin">
              Pinned
            </div>
            <div class="card pinned" aria-label="Pinned tabs">
              {pinnedTabs.map((tab) => (
                <TabRow
                  key={tab.id}
                  {...common(tab)}
                  depth={0}
                  globalActive={isGlobalActive(tab, snap!)}
                  pinnedEntry
                />
              ))}
            </div>
          </>
        )}
        <div
          class="section-label"
          title="Tabs you used most recently, newest first; the current tab is at the top"
        >
          Recent
        </div>
        <div class="card recent" style={{ '--slots': slots }} aria-label="Recent tabs">
          {Array.from({ length: slots }, (_, i) => {
            const tab = snap ? byId.get(snap.recent[i] ?? -1) : undefined;
            // Keyed by slot so rows swap content in place instead of moving.
            return tab ? (
              <TabRow
                key={i}
                {...common(tab)}
                depth={0}
                globalActive={isGlobalActive(tab, snap!)}
                aside={isGlobalActive(tab, snap!) ? 'now' : timeAgo(tab.lastAccessed, now)}
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
                {...common(tab)}
                depth={0}
                globalActive={isGlobalActive(tab, snap!)}
                selected={i === selIndex}
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
                    {...common(r.tab)}
                    depth={r.depth}
                    group={r.group}
                    globalActive={isGlobalActive(r.tab, snap!)}
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
