# TabRail wishlist

Ideas for improvements and new features, roughly in priority order. Nothing here is committed to;
move an item into CLAUDE.md's feature list when we decide to build it. Every item must respect the
hard rules (no extra permissions, UI talks only to `Transport`, works in Phase B too).

Status: **next** = agreed, build soon · **idea** = worth doing, not decided · **maybe** = open question.

---

## Next

### Right-click menu on tabs and window headers

A small custom menu (HTML in the sidebar, not `chrome.contextMenus`, so it works unchanged in
WebView2 for Phase B).

- **Minimize window** — shown only when the window isn't minimized already. Complements the
  click-the-current-tab gesture, which is easy to miss.
- **Restore / bring to front** — for a minimized window.
- **Pin to top** / **Unpin** for a tab (same as the hover pin button).
- Later candidates: close tab, close other tabs in window, move tab to new window, mute/unmute,
  reload, copy URL, discard (sleep) tab.

Protocol: new `FromUi` commands (`minimizeWindow`, …); the service worker executes
them. Keyboard: the context-menu key / Shift+F10 should open it for the selected row.

---

## Done

- **Pinned tabs** (0.4.0): hover pin button on any tab row; Pinned section above Recent, leading
  pin unpins. Tabs only, not windows. Pins are kept in `chrome.storage.local` with their URL and
  re-matched by URL after a browser restart. Pinned tabs are left out of Recent.
- **Duplicate tabs** (0.4.0): count badge on tabs whose URL (ignoring `#fragment`) is open more
  than once; duplicates of the selected tab (current tab, or the filter selection) are highlighted.
- **Recent restyle** (0.3.0): labelled card with "time since used".

---

## Ideas

### Recent strip

- Number the Recent rows and allow Alt+1…5 (while the sidebar is focused) to jump to them.
- Setting for the number of slots (the model already supports `recentSlots`).
- Option to hide Recent entirely.

### Navigation and keyboard

- Arrow-key navigation in the main list, not just in filter results.
- Global shortcut to jump straight to the previous tab (Alt+Tab-style toggle), with no sidebar
  interaction.
- Filter syntax: `w:2` (window), `is:audible`, `is:sleeping`, `is:pinned`.

### Window management

- Rename windows (a sidebar-only name shown in the header instead of the active tab's title).
  Chrome's own window names are not exposed to extensions.
- Collapse all / expand all.
- Show minimized windows grouped at the bottom, or optionally hide them.

### Tab actions

- Bulk close: duplicates, all tabs from a host, all sleeping tabs.
- Close all duplicates of a tab (keep the selected one).
- Drag and drop to reorder or move tabs between windows (out of scope for v1).

### Appearance

- Settings panel (in the sidebar, stored in `chrome.storage.local`): density, font size, recent
  slot count, theme override.

### Phase B

- AppBar docking on a chosen monitor and edge (see CLAUDE.md).
- Auto-hide AppBar mode.

---

## Maybe

- Optional `sortMode: 'mru-lazy'` for the main list (see CLAUDE.md "Open decision").
- Saved sessions / restore a closed window (overlaps with Chrome's own history).
- Multiple profiles (one sidebar per profile, or a combined view in Phase B).
