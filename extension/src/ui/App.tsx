import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Settings, Snapshot, TabNode } from '../shared/protocol';
import type { Transport } from './transport/types';
import {
  buildFlatList,
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
import { ContextMenu, type MenuItem } from './components/ContextMenu';

import { FocusClickGuard, windowFocusSource } from './focusGuard';

type MenuState = { x: number; y: number } & ({ tabId: number } | { windowId: number });

export function App({ transport }: { transport: Transport }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const openTabMenu = useCallback(
    (tabId: number, x: number, y: number) => setMenu({ x, y, tabId }),
    [],
  );
  const openWindowMenu = useCallback(
    (windowId: number, x: number, y: number) => setMenu({ x, y, windowId }),
    [],
  );
  const closeMenu = useCallback(() => setMenu(null), []);
  const [renaming, setRenaming] = useState<number | null>(null);
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
  const finishRename = useCallback(
    (windowId: number, name: string | null) => {
      setRenaming(null);
      if (name !== null) transport.send({ type: 'renameWindow', windowId, name });
    },
    [transport],
  );
  const updateSettings = (patch: Partial<Settings>) =>
    transport.send({ type: 'updateSettings', patch });

  const byId = useMemo(() => (snap ? tabIndex(snap) : new Map()), [snap]);
  const flat = snap?.settings.layout === 'flat';
  const hidden = useMemo(
    () => new Set(!snap || snap.settings.showPinnedInList ? [] : snap.pinned),
    [snap],
  );
  const blocks = useMemo(
    () =>
      snap && !flat
        ? buildMainList(snap, {
            hidden,
            minimized: snap.settings.minimizedWindows,
            forceHeader: renaming,
          })
        : [],
    [snap, flat, hidden, renaming],
  );
  const flatTabs = useMemo(
    () =>
      snap && flat
        ? buildFlatList(snap, {
            hidden,
            minimized: snap.settings.minimizedWindows,
            sort: snap.settings.flatSort,
          })
        : [],
    [snap, flat, hidden],
  );
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
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      // Keyboard access to the context menu for the selected filter result.
      e.preventDefault();
      const tab = filtered[selIndex];
      const row = results.current?.querySelector('[data-selected]')?.getBoundingClientRect();
      if (tab && row) setMenu({ x: row.left + 24, y: row.bottom, tabId: tab.id });
      return;
    }
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
      onMenu: openTabMenu,
    };
  };

  function windowItems(windowId: number): MenuItem[] {
    const win = snap?.windows.find((w) => w.id === windowId);
    if (!win) return [];
    // Names only show in the windows layout.
    const rename: MenuItem[] = flat
      ? []
      : [
          {
            label: win.name ? 'Rename window…' : 'Name window…',
            onSelect: () => setRenaming(windowId),
          },
        ];
    return [...rename, ...stateItems(win)];
  }

  function stateItems(win: { id: number; minimized: boolean }): MenuItem[] {
    const windowId = win.id;
    return win.minimized
      ? [
          {
            label: 'Restore window',
            onSelect: () => transport.send({ type: 'focusWindow', windowId }),
          },
        ]
      : [
          {
            label: 'Minimize window',
            onSelect: () => transport.send({ type: 'minimizeWindow', windowId }),
          },
        ];
  }

  function menuItems(m: MenuState): MenuItem[] {
    if ('windowId' in m)
      return [
        ...windowItems(m.windowId),
        'separator',
        {
          label: 'Collapse all windows',
          onSelect: () => transport.send({ type: 'setAllWindowsCollapsed', collapsed: true }),
        },
        {
          label: 'Expand all windows',
          onSelect: () => transport.send({ type: 'setAllWindowsCollapsed', collapsed: false }),
        },
      ];
    const tab = byId.get(m.tabId);
    if (!tab) return [];
    const k = dupKey(tab.url);
    const others = (k ? (dups.get(k) ?? 1) : 1) - 1;
    const items: MenuItem[] = [
      {
        label: pinnedSet.has(tab.id) ? 'Unpin' : 'Pin to top',
        onSelect: () => togglePin(tab.id),
      },
    ];
    if (others > 0)
      items.push({
        label: others === 1 ? 'Close duplicate' : `Close ${others} duplicates`,
        onSelect: () => transport.send({ type: 'closeDuplicates', tabId: tab.id }),
      });
    items.push('separator', ...windowItems(tab.windowId), 'separator', {
      label: 'Close tab',
      danger: true,
      onSelect: () => close(tab.id),
    });
    return items;
  }
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
            <label class="field">
              <span>List</span>
              <select
                id="set-layout"
                value={snap.settings.layout}
                onChange={(e) =>
                  updateSettings({ layout: e.currentTarget.value as Settings['layout'] })
                }
              >
                <option value="windows">Windows and groups</option>
                <option value="flat">Flat list of tabs</option>
              </select>
            </label>
            {flat && (
              <label class="field">
                <span>Sort by</span>
                <select
                  id="set-sort"
                  value={snap.settings.flatSort}
                  onChange={(e) =>
                    updateSettings({ flatSort: e.currentTarget.value as Settings['flatSort'] })
                  }
                >
                  <option value="tabOrder">Window and tab order</option>
                  <option value="title">Name</option>
                </select>
              </label>
            )}
            <label class="field">
              <span>Minimized</span>
              <select
                id="set-minimized"
                value={snap.settings.minimizedWindows}
                onChange={(e) =>
                  updateSettings({
                    minimizedWindows: e.currentTarget.value as Settings['minimizedWindows'],
                  })
                }
              >
                <option value="inline">Keep in place</option>
                <option value="bottom">Move to the bottom</option>
                <option value="hidden">Hide</option>
              </select>
            </label>
            <label class="check">
              <input
                id="set-pinned"
                type="checkbox"
                checked={snap.settings.showPinnedInList}
                onChange={(e) => updateSettings({ showPinnedInList: e.currentTarget.checked })}
              />
              Also show pinned tabs in the list
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
        ) : flat ? (
          flatTabs.map((tab) => (
            <TabRow
              key={tab.id}
              {...common(tab)}
              depth={0}
              globalActive={isGlobalActive(tab, snap!)}
            />
          ))
        ) : (
          blocks.map((b) => (
            <section key={b.win.id} class={`win${b.win.focused ? ' focused' : ''}`}>
              {b.rows.map((r) =>
                r.kind === 'window' ? (
                  <WindowHeader
                    key={r.key}
                    win={r.win}
                    title={r.title}
                    renaming={renaming === r.win.id}
                    onRename={finishRename}
                    onToggle={toggleWindow}
                    onMenu={openWindowMenu}
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
      {menu && snap && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} onClose={closeMenu} />
      )}
    </div>
  );
}
