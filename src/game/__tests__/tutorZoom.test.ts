import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ZOOM_IDENTITY, ZOOM_MAX, ZOOM_MIN, clampScale, clampView, isDoubleTap, panView, pinchBase, pinchView, readZoomOn, resetView, toggleZoom,
  wheelView, writeZoomOn, zoomAbout, type ZoomGeom, type ZoomView,
} from '../tutorZoom';

// a 100x200 figure centred at (500, 400) in a 1000x800 stage at the origin
const geom: ZoomGeom = { origin: { x: 500, y: 400 }, box: { w: 100, h: 200 }, stage: { left: 0, top: 0, right: 1000, bottom: 800 } };
const at = (scale: number, x = 0, y = 0): ZoomView => ({ scale, x, y });

/** the point of the figure (relative to its centre) that sits under a screen point, before/after a view */
function contentUnder(v: ZoomView, screen: { x: number; y: number }) {
  return { x: (screen.x - geom.origin.x - v.x) / v.scale, y: (screen.y - geom.origin.y - v.y) / v.scale };
}

describe('clampScale', () => {
  it('keeps the scale between 1x and 4x, and a bad number reads as 1x', () => {
    expect(clampScale(0.2)).toBe(ZOOM_MIN);
    expect(clampScale(9)).toBe(ZOOM_MAX);
    expect(clampScale(2.5)).toBe(2.5);
    expect(clampScale(Number.NaN)).toBe(ZOOM_MIN);
  });
});

describe('zoomAbout and pinch zoom around the midpoint', () => {
  it('keeps the content under the pivot where it was', () => {
    const v0 = at(1.5, 40, -30);
    const pivot = { x: 620, y: 350 };
    const before = contentUnder(v0, pivot);
    const v1 = zoomAbout(v0, 3, pivot, geom.origin);
    expect(v1.scale).toBe(3);
    const after = contentUnder(v1, pivot);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('a pinch doubles the scale with the fingers apart twice as far, and holds the midpoint', () => {
    const base = pinchBase(ZOOM_IDENTITY, { x: 150, y: 200 }, { x: 250, y: 200 }); // mid (200,200), 100 px apart
    const v = pinchView(base, { x: 100, y: 200 }, { x: 300, y: 200 }, geom.origin); // same mid, 200 px apart
    expect(v.scale).toBe(2);
    // the content that was under the midpoint is still under it
    const under = contentUnder(v, { x: 200, y: 200 });
    expect(under.x).toBeCloseTo(-300, 9);
    expect(v.x).toBeCloseTo(300, 9);
  });

  it('a pinch whose midpoint moves also pans the figure with it', () => {
    const base = pinchBase(ZOOM_IDENTITY, { x: 150, y: 200 }, { x: 250, y: 200 });
    // the same spread, moved 40 px right and 20 px down
    const v = pinchView(base, { x: 190, y: 220 }, { x: 290, y: 220 }, geom.origin);
    expect(v.scale).toBe(1);
    expect(v.x).toBeCloseTo(40, 9);
    expect(v.y).toBeCloseTo(20, 9);
  });

  it('a pinch stops at 4x', () => {
    const base = pinchBase(ZOOM_IDENTITY, { x: 450, y: 400 }, { x: 550, y: 400 });
    expect(pinchView(base, { x: 300, y: 400 }, { x: 700, y: 400 }, geom.origin).scale).toBe(ZOOM_MAX);
  });

  it('one finger pans by its own movement', () => {
    expect(panView(at(2, 10, 10), { x: 100, y: 100 }, { x: 130, y: 90 })).toEqual({ scale: 2, x: 40, y: 0 });
  });
});

describe('clampView', () => {
  it('keeps the scale in range and the translation inside the pan bounds', () => {
    // at 1x the figure (100 px) may move until 30 px of it still shows at the stage's edge: 520 px from the centre
    expect(clampView(at(1, 9999, 0), geom).x).toBe(520);
    expect(clampView(at(1, -9999, 0), geom).x).toBe(-520);
    expect(clampView(at(9, 0, 0), geom).scale).toBe(ZOOM_MAX);
  });

  it('never lets the figure be dragged fully out of view (30% of it stays on the stage)', () => {
    // dragged as far right as it goes: its left edge stops at 30% of its width from the stage's right edge
    const right = clampView(at(4, 99999, 0), geom);
    expect(geom.origin.x + right.x - (geom.box.w * 4) / 2).toBeCloseTo(geom.stage.right - 0.3 * 400, 9); // 880
    // dragged as far up as it goes: its bottom edge stops 30% of its height below the stage's top
    const up = clampView(at(4, 0, -99999), geom);
    expect(geom.origin.y + up.y + (geom.box.h * 4) / 2).toBeCloseTo(geom.stage.top + 0.3 * 800, 9); // 240
  });

  it('a view inside the bounds is left alone', () => {
    expect(clampView(at(2, 30, -40), geom)).toEqual({ scale: 2, x: 30, y: -40 });
  });
});

describe('wheel', () => {
  it('a wheel tick up zooms in around the cursor, a tick down zooms out', () => {
    const cursor = { x: 560, y: 430 };
    const v1 = wheelView(ZOOM_IDENTITY, -200, cursor, geom.origin);
    expect(v1.scale).toBeGreaterThan(1);
    const v2 = wheelView(at(2), 200, cursor, geom.origin);
    expect(v2.scale).toBeLessThan(2);
    expect(wheelView(ZOOM_IDENTITY, 200, cursor, geom.origin).scale).toBe(ZOOM_MIN); // out from 1x stops at 1x
    const before = contentUnder(ZOOM_IDENTITY, cursor);
    const after = contentUnder(v1, cursor);
    expect(after.x).toBeCloseTo(before.x, 9);
  });
});

describe('double tap', () => {
  it('two taps close in time and place make a double tap; slow or far taps do not', () => {
    const a = { t: 1000, x: 200, y: 300 };
    expect(isDoubleTap(a, { t: 1250, x: 205, y: 305 })).toBe(true);
    expect(isDoubleTap(a, { t: 1400, x: 200, y: 300 })).toBe(false);
    expect(isDoubleTap(a, { t: 1100, x: 260, y: 300 })).toBe(false);
    expect(isDoubleTap(null, a)).toBe(false);
  });
});

describe('toggle and session memory', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('turning 自由縮放 on or off always gives the default view, and it is not being dragged', () => {
    const zoomed = { on: true, view: at(3, 50, 20), dragging: true };
    expect(toggleZoom(zoomed)).toEqual({ on: false, view: ZOOM_IDENTITY, dragging: false });
    expect(toggleZoom({ on: false, view: at(2), dragging: false })).toEqual({ on: true, view: ZOOM_IDENTITY, dragging: false });
  });

  it('a switch of teacher starts the view over and keeps the toggle', () => {
    expect(resetView({ on: true, view: at(3, 50, 20), dragging: true })).toEqual({ on: true, view: ZOOM_IDENTITY, dragging: false });
  });

  it('the toggle is remembered in sessionStorage; a store that throws or is missing reads as off', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
    expect(readZoomOn()).toBe(false);
    writeZoomOn(true);
    expect(readZoomOn()).toBe(true);
    writeZoomOn(false);
    expect(readZoomOn()).toBe(false);

    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
    expect(readZoomOn()).toBe(false);
    expect(() => writeZoomOn(true)).not.toThrow();
  });
});

describe('a smaller minimum (a custom picture may go down to 0.5x)', () => {
  const pivot = { x: 620, y: 350 };

  it('clampScale keeps the scale between the minimum and the maximum; the default minimum is still 1x', () => {
    expect(clampScale(0.2, ZOOM_MAX, 0.5)).toBe(0.5);
    expect(clampScale(0.7, ZOOM_MAX, 0.5)).toBe(0.7);
    expect(clampScale(Number.NaN, ZOOM_MAX, 0.5)).toBe(0.5);
    expect(clampScale(0.7)).toBe(ZOOM_MIN);
  });

  it('zoomAbout and the wheel stop at the minimum', () => {
    expect(zoomAbout(at(1), 0.2, pivot, geom.origin, ZOOM_MAX, 0.5).scale).toBe(0.5);
    expect(zoomAbout(at(1), 0.7, pivot, geom.origin, ZOOM_MAX, 0.5).scale).toBe(0.7);
    expect(wheelView(ZOOM_IDENTITY, 2000, pivot, geom.origin, ZOOM_MAX, 0.5).scale).toBe(0.5);
  });

  it('a pinch to half the distance stops at 0.5x', () => {
    const base = pinchBase(at(1), { x: 100, y: 200 }, { x: 300, y: 200 }); // 200 px apart
    expect(pinchView(base, { x: 175, y: 200 }, { x: 225, y: 200 }, geom.origin, ZOOM_MAX, 0.5).scale).toBe(0.5); // 50 px apart
    expect(pinchView(base, { x: 175, y: 200 }, { x: 225, y: 200 }, geom.origin).scale).toBe(ZOOM_MIN);
  });

  it('at 0.5x the figure may be moved anywhere, but stays fully on the stage', () => {
    // the scaled box is 50 x 100 px around (500, 400) in the 1000 x 800 stage: its centre may move 475 px sideways, 350 px up or down
    expect(clampView(at(0.5, 99999, 0), geom, ZOOM_MAX, 0.5)).toEqual({ scale: 0.5, x: 475, y: 0 });
    expect(clampView(at(0.5, -99999, 99999), geom, ZOOM_MAX, 0.5)).toEqual({ scale: 0.5, x: -475, y: 350 });
    expect(clampView(at(0.5, 0, -99999), geom, ZOOM_MAX, 0.5).y).toBe(-350);
    // a view inside the bounds is left alone
    expect(clampView(at(0.5, 30, -40), geom, ZOOM_MAX, 0.5)).toEqual({ scale: 0.5, x: 30, y: -40 });
    // wherever it is dragged, the picture's edges stay on the stage
    for (const x of [-5000, -300, 0, 300, 5000]) {
      for (const y of [-5000, -100, 0, 100, 5000]) {
        const v = clampView(at(0.5, x, y), geom, ZOOM_MAX, 0.5);
        const left = geom.origin.x + v.x - (geom.box.w * 0.5) / 2;
        const right = geom.origin.x + v.x + (geom.box.w * 0.5) / 2;
        const top = geom.origin.y + v.y - (geom.box.h * 0.5) / 2;
        const bottom = geom.origin.y + v.y + (geom.box.h * 0.5) / 2;
        expect(left).toBeGreaterThanOrEqual(geom.stage.left - 1e-9);
        expect(right).toBeLessThanOrEqual(geom.stage.right + 1e-9);
        expect(top).toBeGreaterThanOrEqual(geom.stage.top - 1e-9);
        expect(bottom).toBeLessThanOrEqual(geom.stage.bottom + 1e-9);
      }
    }
  });

  it('at 1x and above the pan bounds are unchanged (the 30% rule)', () => {
    expect(clampView(at(1, 9999, 0), geom, ZOOM_MAX, 0.5).x).toBe(520);
  });
});
