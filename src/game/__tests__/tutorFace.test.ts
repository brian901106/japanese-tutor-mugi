import { describe, expect, it } from 'vitest';
import {
  AmplitudeMouth, BLINK_GAP_MS, BLINK_MS, BlinkClock, LEVEL_EDGES, LEVEL_HYSTERESIS, TutorFaceClock,
  overlayFile, overlayFiles, parseFigure, parseTutorArt, mouthPlacement, portraitPlacement, type TutorFaceInput,
} from '../tutorFace';

const idle: TutorFaceInput = { speaking: false, cue: null, level: 0 };

describe('BlinkClock', () => {
  it('blinks after the gap, shut for 120 ms', () => {
    const b = new BlinkClock(0, () => 0); // the shortest gap
    expect(b.closedAt(0)).toBe(false);
    expect(b.closedAt(BLINK_GAP_MS[0] - 1)).toBe(false);
    expect(b.closedAt(BLINK_GAP_MS[0])).toBe(true); // the blink starts
    expect(b.closedAt(BLINK_GAP_MS[0] + BLINK_MS - 1)).toBe(true);
    expect(b.closedAt(BLINK_GAP_MS[0] + BLINK_MS)).toBe(false); // open again after 120 ms
  });
  it('the gap is random within 3–6 s', () => {
    const lo = new BlinkClock(0, () => 0);
    const hi = new BlinkClock(0, () => 0.999999);
    expect(lo.closedAt(2999)).toBe(false);
    expect(lo.closedAt(3000)).toBe(true);
    expect(hi.closedAt(5999)).toBe(false);
    expect(hi.closedAt(6000)).toBe(true);
  });
  it('the next blink comes a full gap after the previous one ends', () => {
    const b = new BlinkClock(0, () => 0);
    expect(b.closedAt(3000)).toBe(true);
    const end = 3000 + BLINK_MS;
    expect(b.closedAt(end + 2999)).toBe(false);
    expect(b.closedAt(end + 3000)).toBe(true);
  });
});

describe('AmplitudeMouth: loudness → shape, with hysteresis', () => {
  it('silent is closed, louder is a', () => {
    const m = new AmplitudeMouth();
    expect(m.step(0)).toBe('m');
    expect(m.step(0.9)).toBe('a');
  });
  it('goes up one band at a time past each edge plus the margin', () => {
    const m = new AmplitudeMouth();
    expect(m.step(LEVEL_EDGES[0] + LEVEL_HYSTERESIS)).toBe('i');
    expect(m.step(LEVEL_EDGES[1] + LEVEL_HYSTERESIS)).toBe('e');
    expect(m.step(LEVEL_EDGES[2] + LEVEL_HYSTERESIS)).toBe('o');
    expect(m.step(LEVEL_EDGES[3] + LEVEL_HYSTERESIS)).toBe('a');
  });
  it('does not flicker on an edge: a level just past it stays in the band it was in', () => {
    const m = new AmplitudeMouth();
    m.step(0.5); // band 'o' (between 0.4 and 0.6)
    expect(m.step(LEVEL_EDGES[3] + 0.001)).toBe('o'); // just past 0.6, inside the margin
    expect(m.step(LEVEL_EDGES[3] + LEVEL_HYSTERESIS)).toBe('a');
    expect(m.step(LEVEL_EDGES[3] - 0.001)).toBe('a'); // just under, still inside the margin
    expect(m.step(LEVEL_EDGES[2] - LEVEL_HYSTERESIS - 0.001)).toBe('e'); // below 0.37: one band down (from 'a' via 'o')
  });
  it('reset goes back to closed', () => {
    const m = new AmplitudeMouth();
    m.step(0.9);
    m.reset();
    expect(m.step(0)).toBe('m');
  });
});

describe('TutorFaceClock: blink and lip-sync together', () => {
  it('idle: eyes open with no mouth, then a blink closes them', () => {
    const c = new TutorFaceClock(0, { rng: () => 0 });
    expect(c.frame(0, idle)).toEqual({ closed: false, mouth: null });
    expect(c.frame(3000, idle)).toEqual({ closed: true, mouth: null });
  });
  it('speaking with a timeline: the shape is the cue, the take alternates per shape of the timeline', () => {
    const c = new TutorFaceClock(0, { rng: () => 1 }); // no blink in this window
    const speak = (v: 'a' | 'i' | 'm', i: number) => c.frame(100, { ...idle, speaking: true, cue: { v, i } });
    expect(speak('a', 0)).toEqual({ closed: false, mouth: { take: 1, viseme: 'a' } });
    expect(speak('i', 1)).toEqual({ closed: false, mouth: { take: 2, viseme: 'i' } });
    expect(speak('m', 2)).toEqual({ closed: false, mouth: { take: 1, viseme: 'm' } });
  });
  it('speaking without a timeline: the loudness drives the shape and the takes alternate on each change', () => {
    const c = new TutorFaceClock(0, { rng: () => 1 });
    const a = c.frame(100, { ...idle, speaking: true, level: 0.9 });
    expect(a.mouth).toEqual({ take: 2, viseme: 'a' }); // the first change flips 1 → 2
    const same = c.frame(120, { ...idle, speaking: true, level: 0.9 });
    expect(same.mouth).toEqual({ take: 2, viseme: 'a' }); // no change of shape, no flip
    const m = c.frame(140, { ...idle, speaking: true, level: 0 });
    expect(m.mouth).toEqual({ take: 1, viseme: 'm' });
  });
});

describe('the art description (tutor.json)', () => {
  const good = { size: 512, box: [120, 300, 380, 350], takes: [1, 2], faceless: true };
  it('parses the file the art script writes', () => {
    const art = parseTutorArt(good);
    expect(art?.box).toEqual([120, 300, 380, 350]);
    expect(art?.size).toBe(512);
    expect(art?.takes).toEqual([1, 2]);
    expect(art?.faceless).toBe(true);
    expect(art?.figure).toBeNull(); // no body in this file: the portrait fills its frame
  });
  it('faceless is only true when the file says so', () => {
    expect(parseTutorArt({ ...good, faceless: undefined })?.faceless).toBe(false);
  });
  it('rejects a file without a box, a size or takes', () => {
    expect(parseTutorArt(null)).toBeNull();
    expect(parseTutorArt({ ...good, box: [10, 10, 5, 20] })).toBeNull();
    expect(parseTutorArt({ ...good, box: [1, 2, 3] })).toBeNull();
    expect(parseTutorArt({ ...good, size: 0 })).toBeNull();
    expect(parseTutorArt({ ...good, takes: [3] })).toBeNull();
    expect(parseTutorArt({ ...good, takes: [] })).toBeNull();
  });
  it('overlay file names: one file per take and shape', () => {
    expect(overlayFile(1, 'a')).toBe('mouth-1-a.webp');
    expect(overlayFile(2, 'm')).toBe('mouth-2-m.webp');
    expect(overlayFiles()).toHaveLength(12);
  });
});

describe('the figure (tutor.json): the body and where the portrait sits on it', () => {
  const figure = { file: 'body.webp', w: 1000, h: 2000, portrait: { x: 100, y: 200, scale: 1 } };
  const good = { size: 512, box: [120, 300, 380, 350], takes: [1, 2], faceless: true, figure };
  it('parses the placement fields; backdrop is null when the file does not say', () => {
    expect(parseFigure(figure)).toEqual({ ...figure, backdrop: null });
    expect(parseTutorArt(good)?.figure).toEqual({ ...figure, backdrop: null });
  });
  it('reads figure.backdrop: true or false; any other value is null (the picture then decides)', () => {
    expect(parseFigure({ ...figure, backdrop: true })?.backdrop).toBe(true);
    expect(parseFigure({ ...figure, backdrop: false })?.backdrop).toBe(false);
    expect(parseFigure({ ...figure, backdrop: 'yes' })?.backdrop).toBeNull();
  });
  it('a missing or malformed figure is null and the art still parses (the portrait stands alone)', () => {
    expect(parseTutorArt({ ...good, figure: undefined })?.figure).toBeNull();
    expect(parseTutorArt({ ...good, figure: { ...figure, w: 0 } })?.figure).toBeNull();
    expect(parseTutorArt({ ...good, figure: { ...figure, portrait: { x: 1, y: 2 } } })?.figure).toBeNull();
    expect(parseTutorArt({ ...good, figure: { ...figure, portrait: { x: 1, y: 2, scale: -1 } } })?.figure).toBeNull();
    expect(parseTutorArt({ ...good, figure: { ...figure, file: '' } })?.figure).toBeNull();
    expect(parseTutorArt({ ...good, figure: 'body.webp' })).not.toBeNull();
  });
  it('places the portrait in percent of the figure: its side is size × scale over the figure size', () => {
    const art = parseTutorArt(good)!;
    expect(portraitPlacement(art)).toEqual({ left: 10, top: 10, width: 51.2, height: 25.6 });
    const scaled = parseTutorArt({ ...good, figure: { ...figure, portrait: { x: 0, y: 0, scale: 2 } } })!;
    expect(portraitPlacement(scaled)).toEqual({ left: 0, top: 0, width: 102.4, height: 51.2 });
  });
  it('without a figure the portrait fills its frame', () => {
    expect(portraitPlacement(parseTutorArt({ ...good, figure: undefined })!)).toEqual({ left: 0, top: 0, width: 100, height: 100 });
  });
});

describe('the mouth overlay on the figure: its screen rect follows the body as drawn (photo crop or cut-out)', () => {
  // a photo body, 1024 × 1536 figure px, mouth box in the same px
  const art = parseTutorArt({
    size: 1024, box: [486, 294, 585, 378], takes: [1], faceless: true,
    figure: { file: 'body.webp', w: 1024, h: 1536, portrait: { x: 0, y: 0, scale: 1 } },
  })!;
  /** the on-screen rect (px) of the portrait layer and the overlay, for a body box W × H at (left, top) */
  function rects(W: number, H: number, left: number, top: number) {
    const p = portraitPlacement(art);
    const m = mouthPlacement(art)!;
    const layer = { left: left + (p.left / 100) * W, top: top + (p.top / 100) * H, width: (p.width / 100) * W, height: (p.height / 100) * H };
    const overlay = {
      left: layer.left + (m.left / 100) * layer.width, top: layer.top + (m.top / 100) * layer.height,
      width: (m.width / 100) * layer.width, height: (m.height / 100) * layer.height,
    };
    return { layer, overlay };
  }
  /** where the mouth box must be: the figure's own px scaled to the drawn body */
  function expected(W: number, H: number, left: number, top: number) {
    const [x0, y0, x1, y1] = art.box;
    const sx = W / art.figure!.w, sy = H / art.figure!.h;
    return { left: left + x0 * sx, top: top + y0 * sy, width: (x1 - x0) * sx, height: (y1 - y0) * sy };
  }
  const near = (a: object, b: object) => {
    for (const k of Object.keys(b) as (keyof typeof b)[]) expect((a as Record<string, number>)[k]).toBeCloseTo(b[k], 6);
  };
  it('a photo body fills the stage height from the top and is cropped at the sides (backdrop): the overlay lands on the mouth at 375×812 and 320×640', () => {
    for (const [sw, sh] of [[375, 812], [320, 640]] as const) {
      const H = sh;                       // .tutor-portrait.backdrop: height 100% of the stage
      const W = H * (1024 / 1536);        // the aspect from the figure
      const left = sw / 2 - W / 2;        // translateX(-50%): the stage clips the sides evenly
      const { overlay } = rects(W, H, left, 0);
      near(overlay, expected(W, H, left, 0));
      expect(W).toBeGreaterThan(sw);      // the crop is real: the photo is wider than the stage
    }
  });
  it('a cut-out body on the stage: the same mapping, with the figure smaller than the stage', () => {
    const H = 444, W = 296, left = 12, top = 64;
    const { overlay } = rects(W, H, left, top);
    near(overlay, expected(W, H, left, top));
  });
  it('the mouth percentages are the box in the art size: the box edge at 0 and at the full size maps to 0% and 100%', () => {
    const full = parseTutorArt({ ...art, size: 1024, box: [0, 0, 1024, 1024], figure: art.figure })!;
    expect(mouthPlacement(full)).toEqual({ left: 0, top: 0, width: 100, height: 100 });
    expect(mouthPlacement({ ...art, box: null } as unknown as typeof art)).toBeNull();
  });
});
