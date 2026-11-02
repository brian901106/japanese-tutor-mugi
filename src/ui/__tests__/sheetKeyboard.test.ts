import { describe, expect, it } from 'vitest';
import { scrollToShow, sheetLift } from '../useSheetKeyboard';

describe('sheetLift (速查 sheet on the iOS keyboard)', () => {
  it('raises the sheet only until the field row clears the keyboard', () => {
    // keyboard top at 500, field row bottom at 620 → up by 128 (8px room)
    expect(sheetLift({ focused: true, fullH: 844, vvH: 500, vvTop: 0, anchorBottom: 620 })).toEqual({ kbTop: 500, shift: 128 });
    // the row is already above the keyboard → no raise, the backdrop is still painted from the keyboard down
    expect(sheetLift({ focused: true, fullH: 844, vvH: 500, vvTop: 0, anchorBottom: 300 })).toEqual({ kbTop: 500, shift: 0 });
    // iOS panned anyway: the keyboard top is where the visible strip ends
    expect(sheetLift({ focused: true, fullH: 844, vvH: 500.4, vvTop: 120.6, anchorBottom: 620 })).toEqual({ kbTop: 621, shift: 7 });
  });
  it('does nothing when not focused, no keyboard, or pinch-zoomed', () => {
    expect(sheetLift({ focused: false, fullH: 844, vvH: 500, vvTop: 0, anchorBottom: 620 })).toBeNull();
    expect(sheetLift({ focused: true, fullH: 844, vvH: 800, vvTop: 0, anchorBottom: 620 })).toBeNull();
    expect(sheetLift({ focused: true, fullH: 844, vvH: 400, vvTop: 0, scale: 2, anchorBottom: 620 })).toBeNull();
  });
});

describe('scrollToShow (a settings field scrolled into view above the keyboard)', () => {
  const body = { bodyTop: 100, bodyBottom: 400 };
  it('leaves a field that is already in view', () => {
    expect(scrollToShow({ fieldTop: 150, fieldBottom: 190, ...body })).toBe(0);
  });
  it('brings a field below the body up to its bottom, with a little room', () => {
    expect(scrollToShow({ fieldTop: 500, fieldBottom: 540, ...body })).toBe(148);
  });
  it('brings a field above the body down to its top', () => {
    expect(scrollToShow({ fieldTop: 40, fieldBottom: 80, ...body })).toBe(-68);
  });
  it('shows the top of a field taller than the body (the persona box)', () => {
    expect(scrollToShow({ fieldTop: 300, fieldBottom: 900, ...body })).toBe(192);
  });
});
