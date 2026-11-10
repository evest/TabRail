import { describe, expect, it } from 'vitest';
import { FocusClickGuard, type FocusSource } from '../src/ui/focusGuard';

function fakeSource() {
  let focus = () => {};
  let press = () => {};
  const src: FocusSource & { focused: boolean } = {
    focused: false,
    onWindowFocus: (cb) => void (focus = cb),
    onPointerDown: (cb) => void (press = cb),
    hasFocus: () => src.focused,
  };
  return { src, gainFocus: () => ((src.focused = true), focus()), press: () => press() };
}

describe('FocusClickGuard', () => {
  it('press while unfocused is a focusing click (press before focus event)', () => {
    const f = fakeSource();
    let t = 0;
    const g = new FocusClickGuard(f.src, () => t);
    t = 10_000;
    f.press();
    f.gainFocus();
    expect(g.isFocusingClick()).toBe(true);
  });

  it('press right after the window gained focus is a focusing click (focus event first)', () => {
    const f = fakeSource();
    let t = 10_000;
    const g = new FocusClickGuard(f.src, () => t);
    f.gainFocus();
    t += 20;
    f.press();
    expect(g.isFocusingClick()).toBe(true);
  });

  it('later presses while focused are normal clicks', () => {
    const f = fakeSource();
    let t = 10_000;
    const g = new FocusClickGuard(f.src, () => t);
    f.gainFocus();
    t += 20;
    f.press();
    t += 1000;
    f.press();
    expect(g.isFocusingClick()).toBe(false);
  });

  it('a sidebar that starts focused (never got a focus event) allows minimize', () => {
    const f = fakeSource();
    f.src.focused = true;
    const g = new FocusClickGuard(f.src, () => 10_000);
    f.press();
    expect(g.isFocusingClick()).toBe(false);
  });
});
