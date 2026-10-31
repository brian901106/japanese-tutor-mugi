import { describe, expect, it } from 'vitest';
import { keyboardLayout } from '../useIOSKeyboard';

describe('keyboardLayout (chat bar on the on-screen keyboard)', () => {
  it('closed / unfocused: nothing moves', () => {
    expect(keyboardLayout({ focused: false, rootH: 912, vvH: 498, vvTop: 414 })).toEqual({ open: false, shift: 0, bar: 0 });
    expect(keyboardLayout({ focused: true, rootH: 912, vvH: 912, vvTop: 0 })).toEqual({ open: false, shift: 0, bar: 0 });
    // hardware keyboard / accessory bar only: small difference is not a keyboard
    expect(keyboardLayout({ focused: true, rootH: 912, vvH: 860, vvTop: 0 }).open).toBe(false);
  });
  it('an iPhone standalone, no pan: bar docks on the keyboard', () => {
    expect(keyboardLayout({ focused: true, rootH: 912, vvH: 498, vvTop: 0 })).toEqual({ open: true, shift: 0, bar: 414 });
  });
  it('iOS panned anyway: the view follows the pan, the bar stays on the keyboard', () => {
    expect(keyboardLayout({ focused: true, rootH: 912, vvH: 498, vvTop: 414 })).toEqual({ open: true, shift: 414, bar: 414 });
  });
  it('pinch-zoomed: not treated as a keyboard', () => {
    expect(keyboardLayout({ focused: true, rootH: 912, vvH: 400, vvTop: 0, scale: 2 }).open).toBe(false);
  });
});
