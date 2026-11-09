# TabRail: Chrome tab sidebar

An always-visible sidebar that lists every Chrome window and tab, so I can find tabs quickly. It covers one Chrome profile on Windows.

- **Phase A (now):** extension only. The sidebar is a Chrome popup window, kept on top with PowerToys "Always On Top".
- **Phase B (soon):** a WPF + WebView2 desktop host docked as a real Windows **AppBar**. It runs the *same UI bundle* and gets data from the extension over Native Messaging.

Every Phase A decision must keep Phase B cheap. If a feature forces a trade-off between the two phases, stop and ask before implementing it.

---

## Hard rules

1. **Privacy.**
   - Permissions are limited to `tabs`, `tabGroups`, `storage` and `favicon` (plus `nativeMessaging` in Phase B).
   - No host permissions and no content scripts.
   - No network calls, analytics or third-party runtime dependencies that phone home.
2. **The UI never calls `chrome.*` APIs.** It talks only to a `Transport` interface (see Protocol). In Phase B it runs inside WebView2, where `chrome.*` doesn't exist.
3. **The service worker owns all state.** The UI is a pure render of snapshots plus commands it sends back.
4. **The service worker is stateless across restarts.** On startup it rebuilds state from `chrome.windows.getAll({populate: true})` and `chrome.tabGroups.query`. Only the MRU history lives in `chrome.storage.session`; `tab.lastAccessed` is the fallback.
5. **Never send anything to stdout from the Phase B host** except Native Messaging frames. Logging goes to a file.

---

## Repository layout

```
/extension
  public/manifest.json     MV3; includes "key" so the extension ID is stable (Phase B allowed_origins depends on it)
                           Extension ID: mfdnjhlfloplkkoheffholbeobhdimhd (private key in extension/.keys/, gitignored)
  src/background/          service worker: TabStore, Chrome event listeners, MRU tracking, commands, transports
  src/ui/                  sidebar app (Preact + TypeScript)
  src/shared/protocol.ts   message and model types shared by background, UI and host
  test/                    Vitest unit tests
/host                      Phase B: .NET 10 WPF + WebView2 (not yet)
```

## Build

- pnpm, Vite, TypeScript `strict`, Preact for the UI, Vitest, ESLint and Prettier.
- Use a plain multi-entry Vite build (`background.ts`, `sidebar.html`) that outputs to `extension/dist`, which is loaded unpacked. Don't add a CRX bundling plugin.
- A second build target, `ui-standalone`, outputs the same UI with relative asset paths and no extension assumptions. Phase B's WebView2 loads this through virtual host mapping.
- Scripts: `dev` (watch build), `build`, `test`, `lint`.

---

## Architecture

```
chrome.tabs / windows / tabGroups events
              │
              ▼
   Service worker: TabStore ──snapshot──► Transport ──► UI
              ▲                                │
              └────────────command─────────────┘

Transport, Phase A: chrome.runtime.connect port named "sidebar" (UI in the extension popup window)
Transport, Phase B: chrome.runtime.connectNative("no.tabrail.host") ⇄ .NET host ⇄ WebView2 postMessage
```

The UI picks its transport at startup:
- If `window.chrome?.webview` exists, it uses `WebViewTransport`.
- Otherwise it uses `RuntimePortTransport`.

## Protocol (`src/shared/protocol.ts`)

```ts
export interface TabNode {
  id: number; windowId: number; index: number;
  title: string; url: string; host: string;
  favicon?: string;          // key into Snapshot.favicons (data: URLs resolved by the service worker, never chrome:// or remote)
  active: boolean; pinned: boolean; audible: boolean; muted: boolean;
  sleeping: boolean;         // tab.discarded (|| tab.frozen where available)
  loading: boolean;
  groupId: number;           // -1 = ungrouped
  lastAccessed: number;      // MRU timestamp (our own tracking, falling back to tab.lastAccessed)
}
export interface GroupNode { id: number; windowId: number; title: string; color: string;
  collapsed: boolean;        // sidebar-only state; never mirrored to Chrome's tab strip
}
export interface WindowNode {
  id: number; focused: boolean; minimized: boolean;
  sleeping: boolean;         // all tabs sleeping
  collapsed: boolean;        // sidebar collapse state, persisted by the service worker
  tabs: TabNode[]; groups: GroupNode[];
}
export interface Snapshot {
  seq: number; focusedWindowId: number | null; windows: WindowNode[];
  recent: number[];                    // tab ids, most recent first, excluding the globally active tab
  favicons: Record<string, string>;    // favicon key (host) -> data: URL, only keys used in this snapshot
  settings: { recentSlots: number };
}

export type ToUi =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'focusFilter' };                  // shortcut pressed: focus the filter input

export type FromUi =
  | { type: 'ready' }
  | { type: 'activateTab'; tabId: number }    // activates the tab and focuses its window
  | { type: 'closeTab'; tabId: number }
  | { type: 'toggleWindowCollapsed'; windowId: number }
  | { type: 'toggleGroupCollapsed'; groupId: number }
  | { type: 'focusLastWindow' };              // second Esc in the filter
```

`src/shared/protocol.ts` is the source of truth; this block mirrors it.

- The service worker sends full snapshots, debounced to about 50 ms. The UI renders with keyed lists so unchanged rows don't re-render. Switch to patches only if profiling shows a need.
- **Favicons:** the service worker fetches `chrome-extension://<id>/_favicon/?pageUrl=…&size=16` (requires the `favicon` permission), converts the result to a data URL and caches it per host. *Verified on Chrome 157: a service worker can fetch its own `_favicon` endpoint. The response has an empty Content-Type (it's PNG). Unknown pages return a generic globe, which is never cached; a fetch is retried when `onUpdated` reports a `favIconUrl` change.*
- **Window filtering:** exclude the sidebar's own popup window and any non-`normal` windows from the model.
- **Focus tracking:** keep `lastFocusedNormalWindowId` and ignore `WINDOW_ID_NONE` and the sidebar window. When the sidebar itself is focused, which is always the case in Phase B, the last real Chrome window stays marked.

---

## Features (v1)

### Layout and density
- Aim for as many rows as possible on screen: row height about 22 px, 12–13 px system font, 16 px favicon, single-line ellipsized title, and minimal padding. Target width is 260–340 px, and the layout must stay usable at 220 px.
- **A window with one tab renders as a single row**: the tab row with a small window marker. It has no header and no indentation.
- **A window with more than one tab renders as a tree**: a compact header (active tab's title, tab count, collapse chevron) followed by indented tab rows. Tab groups form a collapsible sub-level with a colored left bar.
- Window collapse state persists in `chrome.storage.local`, keyed by window ID.
- The host or URL appears only in a tooltip, not as an extra line.
- Light and dark modes follow the system theme.

### Focus and state indicators
- The **focused window** gets a tinted background on its whole block.
- Each window's active tab is shown in semibold. The globally active tab (the active tab in the focused window) also gets an accent bar.
- **Sleeping** tabs are dimmed and show a small sleep glyph. A window that is fully asleep or minimized gets a dimmed header with the same glyph.
- Audible and muted tabs show a small speaker glyph.

### Recency without layout shift
- A **Recent** strip sits at the top with a **fixed** number of slots (default 5, configurable) and a fixed height. It shows the most recently activated tabs across all windows. It updates in place, and its rows swap content rather than the strip resizing.
- The **main list is stable**: windows in creation order, tabs in tab-strip order. The highlight moves; rows don't.
- *Open decision:* an optional `sortMode: 'mru-lazy'` that reorders the main list by recency, but only while the sidebar is neither hovered nor focused, and with FLIP animation. Don't build it until asked.

### Filter
- A filter input is pinned at the top, above Recent.
- Matching is case-insensitive and token-based against title and URL; every token must match.
- While a filter is active, show a flat ranked list: match quality first, then recency. Show each result's window marker so I can tell which window it belongs to.
- Keys: ↑ and ↓ move the selection, Enter activates the selected tab, Esc clears the filter, and a second Esc returns focus to the last Chrome window.

### Interactions
- Click activates the tab and brings its window to the front (`chrome.tabs.update` plus `chrome.windows.update({focused: true})`).
- Middle-click closes the tab. A close button appears on hover.

### Keyboard shortcut to focus the sidebar
- **Phase A:** use a `commands` entry with `"global": true`. Global shortcuts are limited to Ctrl+Shift+0–9, so default to Ctrl+Shift+1.
  - If the sidebar window exists, focus it and send `focusFilter`.
  - Otherwise, create it.
  - *Verify on Windows that global commands fire while Chrome is not focused.*
- **Phase B:** the host registers its own hotkey with `RegisterHotKey`, and the Chrome command is ignored.

### Sidebar window (Phase A)
- Clicking the toolbar action opens or focuses a single `type: 'popup'` window loading `sidebar.html`.
- Save its bounds on `windows.onBoundsChanged` and restore them on the next open. The default is the left edge, 300 px wide and full height.

### Out of scope for v1
Drag and drop, saved sessions, multiple profiles, sync, and context menus.

---

## Testing
- Use Vitest for the pure logic: the TabStore reducer (Chrome events in, snapshot out), MRU tracking, the single-tab-window flattening rule, filter ranking, and focus tracking (ignoring the sidebar window and `WINDOW_ID_NONE`).
- Keep Chrome API access behind a thin adapter so the reducer can be tested without Chrome.

## Milestones
1. Scaffold: Vite, TypeScript, Preact, manifest with `key`, and an empty sidebar window that opens from the action.
2. TabStore, the snapshot protocol and `RuntimePortTransport`, rendering a plain list.
3. Layout rules: single-tab rows, tree, groups, focus tint, sleeping and audio indicators, and density pass.
4. Recent strip and MRU tracking.
5. Filter and keyboard navigation, plus the global shortcut.
6. Favicons through `_favicon` and data URLs.
7. `ui-standalone` build target, with the UI checked running against a mock transport in a normal browser tab.

---

## Phase B notes (don't implement yet; just don't block them)
- **Host:** .NET 10, WPF and WebView2 (the Evergreen runtime ships with Windows 11), published as a single-file executable.
- **Launch model:** Chrome launches the host through `connectNative`. The host *is* the sidebar app and lives as long as the port does.
  - This avoids an open localhost port, at the cost of the sidebar existing only while Chrome runs. That's acceptable.
  - The extension connects on `runtime.onStartup` and `onInstalled`. If the user deliberately closes the app, the extension must not respawn it; that needs a flag.
- **Native Messaging framing:** a 4-byte length prefix in native byte order, followed by UTF-8 JSON.
  - Messages from the host to Chrome are limited to 1 MB.
  - Messages from Chrome to the host can be much larger, so snapshots flow in the safe direction.
  - The stdin reader runs on a background thread.
- **Registration:** an install script writes the host manifest JSON and sets `HKCU\Software\Google\Chrome\NativeMessagingHosts\no.tabrail.host`. The manifest's `allowed_origins` contains the stable extension ID.
- **Relay:** stdin feeds `CoreWebView2.PostWebMessageAsJson`, and `WebMessageReceived` writes to stdout. The host adds only host-level messages such as `focusFilter`.
- **AppBar:** use `SHAppBarMessage` (`ABM_NEW`, `ABM_QUERYPOS`, `ABM_SETPOS`, `ABM_REMOVE`), handle `ABN_POSCHANGED`, use per-monitor DPI v2, and let me choose the monitor and edge.
