# TabRail wishlist

Ideas for improvements and new features, roughly in priority order. Nothing here is committed to;
move an item into CLAUDE.md's feature list when we decide to build it. Every item must respect the
hard rules (no extra permissions, UI talks only to `Transport`, works in Phase B too).

Status: **next** = agreed, build soon · **idea** = worth doing, not decided · **maybe** = open question.

---

## Next

Nothing agreed right now; pick from Ideas.

---

## Ideas

### Right-click menu, more actions

The menu exists (0.9.0). Candidates to add: close other tabs in window, move tab to new window,
mute/unmute, reload, copy URL, discard (sleep) tab. Keyboard access currently works only for the
selected filter result; extend it once the main list has a keyboard selection.

### Recent strip

- Number the Recent rows and allow Alt+1…5 (while the sidebar is focused) to jump to them.
- Setting for the number of slots (the model already supports `recentSlots`).
- Option to hide Recent entirely.

### Navigation and keyboard

- Arrow-key navigation in the main list, not just in filter results.
- Global shortcut to jump straight to the previous tab (Alt+Tab-style toggle), with no sidebar
  interaction.
- Filter keywords: `is:audible`, `is:sleeping`, `is:pinned`, `is:dup`.

### Tab actions

- Bulk close: all duplicates everywhere, all tabs from a host, all sleeping tabs.
- Drag and drop to reorder or move tabs between windows (out of scope for v1).

### Settings panel

The gear panel exists (0.5.0; layout, minimized and pinned options since 0.10.0). Candidates: density, font size, Recent slot count,
theme override.

### Phase B

- AppBar docking on a chosen monitor and edge (see CLAUDE.md).
- Auto-hide AppBar mode.

---

## Maybe

- Optional `sortMode: 'mru-lazy'` for the main list (see CLAUDE.md "Open decision").
- Saved sessions / restore a closed window (overlaps with Chrome's own history).
- Multiple profiles (one sidebar per profile, or a combined view in Phase B).
- Show a tab's window (name or position) in a tooltip in Recent, Pinned and filter results, now
  that the color markers are gone.

---

## Done

- **Pins survive quitting Chrome** (0.10.1): closing a window used to drop its pins, so quitting
  (which closes every window) emptied the Pinned section. Pins and names now wait for their tabs
  and windows to come back, including when session restore finishes after the service worker
  starts. Verified with a real Chrome quit and relaunch.
- **Windows** (0.10.0): sidebar-only window names (right-click a header or tab → Name window…),
  re-matched by tab URLs after a restart; Collapse all /
  Expand all in the header menu; minimized windows kept in place, moved to the bottom, or hidden;
  a flat list layout with no window headers or groups, sortable by window/tab order or by name.
- **Right-click menu** (0.9.0): on tabs: Pin/Unpin, Close duplicate(s), Minimize/Restore window,
  Close tab. On window headers: Minimize/Restore window. Shift+F10 or the menu key opens it for
  the selected filter result.
- **Window markers removed** (0.8.0): per-window colors were noise with many windows open.
- **Current tab at the top of Recent** (0.7.0), shown as "now" with the accent bar.
- **Extension icon** (0.6.0): "Focus row", also used as the sidebar page icon (0.7.0).
- **Settings panel** (0.5.0): gear next to the filter; "Also show pinned tabs in the window list"
  (off by default).
- **Pinned tabs** (0.4.0): hover pin button on any tab row; Pinned section above Recent, leading
  pin unpins. Tabs only, not windows. Kept in `chrome.storage.local` with their URL and re-matched
  by URL after a browser restart. Left out of Recent.
- **Duplicate tabs** (0.4.0): count badge on tabs whose URL (ignoring `#fragment`) is open more
  than once; duplicates of the selected tab are highlighted.
- **Recent restyle** (0.3.0): labelled card with "time since used".
- **Verified on Windows**: the global Ctrl+Shift+1 shortcut fires while Chrome is not focused.
