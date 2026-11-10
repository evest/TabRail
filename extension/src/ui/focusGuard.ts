/**
 * Tells apart "the click that brought the sidebar window into focus" from later clicks.
 * The focusing click must never trigger click-to-minimize. Covers both event orders seen on
 * Windows: the press arrives while the page is still unfocused, or the window `focus` event
 * fires just before the press. Uses only DOM APIs, so it also works inside WebView2 (Phase B).
 */
export interface FocusSource {
  onWindowFocus(cb: () => void): void;
  /** Must run before click handlers (capture phase). */
  onPointerDown(cb: () => void): void;
  hasFocus(): boolean;
}

export class FocusClickGuard {
  private focusedAt = Number.NEGATIVE_INFINITY;
  private pressWasFocusing = false;

  constructor(
    source: FocusSource,
    private readonly now: () => number = () => performance.now(),
    private readonly graceMs = 300,
  ) {
    source.onWindowFocus(() => {
      this.focusedAt = this.now();
    });
    source.onPointerDown(() => {
      this.pressWasFocusing = !source.hasFocus() || this.now() - this.focusedAt < this.graceMs;
    });
  }

  /** True while handling the click whose press brought the sidebar into focus. */
  isFocusingClick(): boolean {
    return this.pressWasFocusing;
  }
}

export function windowFocusSource(w: Window): FocusSource {
  return {
    onWindowFocus: (cb) =>
      w.addEventListener('focus', (e) => {
        // Element focus events don't bubble; still, only the window itself gaining focus counts.
        if (e.target === w) cb();
      }),
    onPointerDown: (cb) => w.addEventListener('pointerdown', cb, true),
    hasFocus: () => w.document.hasFocus(),
  };
}
