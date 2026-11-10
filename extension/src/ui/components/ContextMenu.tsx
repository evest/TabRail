import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

export type MenuItem = { label: string; onSelect: () => void; danger?: boolean } | 'separator';

/**
 * Small in-page context menu (not chrome.contextMenus, so it also works inside WebView2).
 * Opens at (x, y), clamped to the viewport; closes on outside press, Esc, blur, scroll or a choice.
 * Arrow keys move between items, Enter/Space choose.
 */
export function ContextMenu(p: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: p.x, top: p.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(2, Math.min(p.x, window.innerWidth - width - 2)),
      top: Math.max(2, Math.min(p.y, window.innerHeight - height - 2)),
    });
    el.querySelector<HTMLButtonElement>('button')?.focus();
  }, [p.x, p.y]);

  useEffect(() => {
    const onPress = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) p.onClose();
    };
    const close = () => p.onClose();
    window.addEventListener('pointerdown', onPress, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('pointerdown', onPress, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [p.onClose]);

  function onKeyDown(e: KeyboardEvent) {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      buttons[(i + d + buttons.length) % buttons.length]?.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      p.onClose();
    }
  }

  return (
    <div
      ref={ref}
      class="ctx"
      role="menu"
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {p.items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} class="ctx-sep" role="separator" />
        ) : (
          <button
            key={i}
            class={`ctx-item${item.danger ? ' danger' : ''}`}
            role="menuitem"
            onClick={() => {
              p.onClose();
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
