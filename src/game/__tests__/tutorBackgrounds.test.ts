// The backgrounds (背景) as a list: the classroom and plain black are built in; the player adds up to 6. Adding makes the new one the
// one in use; deleting an added one removes its settings and, when it was in use, the classroom is in use again; the built-in ones are
// never deleted. Each background keeps its own dimming and pinch / drag view. Pure settings functions, nothing is sent anywhere.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TUTOR, TUTOR_BACKGROUNDS_MAX, addBackground, backgroundOptOf, deleteBackground, selectBackground, updateBackgroundOpt,
  type TutorSettings,
} from '../tutor';
import { isBuiltinBackground, newBackgroundId } from '../tutorScene';

const base = (extra: Partial<TutorSettings> = {}): TutorSettings => ({ ...DEFAULT_TUTOR, ...extra });

describe('adding and deleting', () => {
  it('adds a background, makes it the one in use, and keeps its id in the list', () => {
    const s = addBackground(base(), 'b1');
    expect(s).not.toBeNull();
    expect(s!.customBackgrounds).toEqual(['b1']);
    expect(s!.background).toBe('b1');
    expect(backgroundOptOf(s!, 'b1')).toEqual({ dim: null, view: { scale: 1, x: 0, y: 0 } });
  });

  it(`refuses the ${TUTOR_BACKGROUNDS_MAX + 1}th added background`, () => {
    let s: TutorSettings | null = base();
    for (let i = 0; i < TUTOR_BACKGROUNDS_MAX; i++) s = addBackground(s!, `b${i}`);
    expect(s!.customBackgrounds).toHaveLength(TUTOR_BACKGROUNDS_MAX);
    expect(addBackground(s!, 'extra')).toBeNull();
  });

  it('refuses a built-in id or one already listed', () => {
    expect(addBackground(base(), 'classroom')).toBeNull();
    expect(addBackground(base(), 'black')).toBeNull();
    const s = addBackground(base(), 'b1')!;
    expect(addBackground(s, 'b1')).toBeNull();
  });

  it('a new id is never a built-in one', () => {
    expect(isBuiltinBackground(newBackgroundId())).toBe(false);
    expect(newBackgroundId()).not.toBe(newBackgroundId());
  });

  it('the built-in backgrounds are never deleted', () => {
    const s = base();
    expect(deleteBackground(s, 'classroom')).toBe(s);
    expect(deleteBackground(s, 'black')).toBe(s);
  });

  it('deleting an added one removes it and its settings; an unknown id changes nothing', () => {
    const s = updateBackgroundOpt(addBackground(addBackground(base(), 'b1')!, 'b2')!, 'b1', { dim: 30 });
    const gone = deleteBackground(s, 'b1');
    expect(gone.customBackgrounds).toEqual(['b2']);
    expect(gone.backgroundOpts.b1).toBeUndefined();
    expect(deleteBackground(s, 'nobody')).toBe(s);
  });

  it('deleting the one in use puts the classroom back in use; deleting another keeps the one in use', () => {
    const s = addBackground(addBackground(base(), 'b1')!, 'b2')!; // b2 in use
    expect(deleteBackground(s, 'b2').background).toBe('classroom');
    expect(deleteBackground(s, 'b1').background).toBe('b2');
  });
});

describe('selecting the background in use', () => {
  it('selects a built-in or an added one; an unknown id changes nothing', () => {
    const s = addBackground(base(), 'b1')!;
    expect(selectBackground(s, 'black').background).toBe('black');
    expect(selectBackground(s, 'classroom').background).toBe('classroom');
    expect(selectBackground(s, 'b1').background).toBe('b1');
    expect(selectBackground(s, 'zzz')).toBe(s);
  });
});

describe('each background keeps its own dimming and view', () => {
  it('changing one background leaves the others as they were', () => {
    let s = addBackground(base(), 'b1')!;
    s = updateBackgroundOpt(s, 'b1', { dim: 40, view: { scale: 2, x: 5, y: -5 } });
    s = updateBackgroundOpt(s, 'classroom', { dim: 10 });
    expect(backgroundOptOf(s, 'b1')).toEqual({ dim: 40, view: { scale: 2, x: 5, y: -5 } });
    expect(backgroundOptOf(s, 'classroom')).toEqual({ dim: 10, view: { scale: 1, x: 0, y: 0 } });
    expect(backgroundOptOf(s, 'black')).toEqual({ dim: null, view: { scale: 1, x: 0, y: 0 } });
  });

  it('switching the background brings back its own dimming and view', () => {
    let s = addBackground(base(), 'b1')!;
    s = updateBackgroundOpt(s, 'b1', { dim: 60 });
    const back = selectBackground(selectBackground(s, 'classroom'), 'b1');
    expect(backgroundOptOf(back, 'b1').dim).toBe(60);
    expect(backgroundOptOf(back, 'classroom').dim).toBeNull();
  });
});
