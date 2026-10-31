import { describe, expect, it } from 'vitest';
import {
  canUseFrames, customPortraitOf, frameFor, loadCustomArt, nextFreeShape, prepareImage, saveCustomArt,
  type CustomArt, type CustomArtFrame,
} from '../customArt';
import type { VisemeCode } from '../visemes';

const fr = (id: string, viseme: VisemeCode | null): CustomArtFrame => ({ id, viseme, blob: new Blob([id], { type: 'image/webp' }) });
const frames = (...vs: (VisemeCode | null)[]) => vs.map((v, i) => fr(`f${i}`, v));
const framesArt = (...vs: VisemeCode[]): CustomArt => ({ mode: 'frames', frames: frames(...vs) });

describe('frameFor (人設圖片 frame rules)', () => {
  it('single mode always shows its one picture', () => {
    const art: CustomArt = { mode: 'single', frames: frames(null) };
    expect(frameFor(art, 'o')?.id).toBe('f0');
    expect(frameFor(art, null)?.id).toBe('f0');
  });

  it('a shape with its own frame shows that frame', () => {
    const art = framesArt('a', 'e', 'i', 'o', 'u', 'm');
    for (const v of ['a', 'e', 'i', 'o', 'u', 'm'] as const) expect(frameFor(art, v)?.viseme).toBe(v);
  });

  it('a missing vowel uses the a frame', () => {
    const art = framesArt('a', 'e');
    expect(frameFor(art, 'i')?.viseme).toBe('a');
    expect(frameFor(art, 'u')?.viseme).toBe('a');
  });

  it('with no a frame, a missing shape uses the first frame', () => {
    const art = framesArt('e', 'o');
    expect(frameFor(art, 'i')?.id).toBe('f0');
  });

  it('silent shows the m frame when there is one', () => {
    expect(frameFor(framesArt('a', 'm'), null)?.viseme).toBe('m');
  });

  it('silent without an m frame shows the first frame, not the a frame', () => {
    const art = framesArt('e', 'a');
    expect(frameFor(art, null)?.id).toBe('f0');
    expect(frameFor(art, null)?.viseme).toBe('e');
  });

  it('a missing m frame is not replaced by the a frame when speaking an m', () => {
    expect(frameFor(framesArt('e', 'a'), 'm')?.viseme).toBe('a');
  });

  it('no frames gives null', () => {
    expect(frameFor({ mode: 'frames', frames: [] }, 'a')).toBeNull();
    expect(frameFor({ mode: 'single', frames: [] }, null)).toBeNull();
  });
});

describe('canUseFrames', () => {
  it('needs frame mode with at least two frames', () => {
    expect(canUseFrames(framesArt('a'))).toBe(false);
    expect(canUseFrames(framesArt('a', 'e'))).toBe(true);
    expect(canUseFrames({ mode: 'single', frames: frames(null, null) })).toBe(false);
  });
});

describe('nextFreeShape', () => {
  it('is the first shape no frame uses, null when all six are taken', () => {
    expect(nextFreeShape(frames('a', 'e'))).toBe('i');
    expect(nextFreeShape(frames())).toBe('a');
    expect(nextFreeShape(frames('a', 'e', 'i', 'o', 'u', 'm'))).toBeNull();
  });
});

describe('customPortraitOf (what the portrait draws)', () => {
  it('is null without a usable picture', () => {
    expect(customPortraitOf(null, {})).toBeNull();
    expect(customPortraitOf({ mode: 'frames', frames: [] }, {})).toBeNull();
  });

  it('a frames picture with one frame is shown as a single picture', () => {
    const art = framesArt('e');
    const p = customPortraitOf(art, { f0: 'blob:one' });
    expect(p?.mode).toBe('single');
    expect(p?.pictureFor('a')).toBe('blob:one');
    expect(p?.urls).toEqual(['blob:one']);
  });

  it('frames mode picks the URL of the frame for the shape', () => {
    const art = framesArt('a', 'e');
    const p = customPortraitOf(art, { f0: 'blob:a', f1: 'blob:e' });
    expect(p?.mode).toBe('frames');
    expect(p?.pictureFor('e')).toBe('blob:e');
    expect(p?.pictureFor('i')).toBe('blob:a');
    expect(p?.pictureFor(null)).toBe('blob:a');
  });

  it('a frame without a URL yet gives null (nothing is drawn)', () => {
    const p = customPortraitOf(framesArt('a', 'e'), { f0: 'blob:a' });
    expect(p?.pictureFor('e')).toBeNull();
  });
});

describe('storage (no IndexedDB in this test environment)', () => {
  it('loadCustomArt reads as no custom art', async () => {
    await expect(loadCustomArt()).resolves.toBeNull();
  });

  it('saveCustomArt reports a Chinese message instead of a raw error', async () => {
    await expect(saveCustomArt(framesArt('a', 'e'))).rejects.toThrow('無法儲存圖片');
  });
});

describe('prepareImage (checks before decoding)', () => {
  it('rejects SVG and other types with a Chinese message', async () => {
    const svg = new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' });
    await expect(prepareImage(svg)).rejects.toThrow('只能選');
    const txt = new File(['hi'], 'a.txt', { type: 'text/plain' });
    await expect(prepareImage(txt)).rejects.toThrow('只能選');
  });

  it('rejects an input over 15 MB before decoding', async () => {
    const big = new File(['x'], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 15 * 1024 * 1024 + 1 });
    await expect(prepareImage(big)).rejects.toThrow('15 MB');
  });

  it('a picture that cannot be decoded says so', async () => {
    const png = new File(['not really a png'], 'a.png', { type: 'image/png' });
    await expect(prepareImage(png)).rejects.toThrow('讀不到這張圖');
  });
});


describe('mouth flapping with two pictures', () => {
  it('a built-in open/closed pair opens on a and o and closes on e, i, u, m and silence', async () => {
    const { filePortrait } = await import('../customArt');
    const p = filePortrait('open.webp', 'closed.webp');
    expect(['a', 'o'].map((v) => p.pictureFor(v as never))).toEqual(['open.webp', 'open.webp']);
    expect(['e', 'i', 'u', 'm'].map((v) => p.pictureFor(v as never))).toEqual(['closed.webp', 'closed.webp', 'closed.webp', 'closed.webp']);
    expect(p.pictureFor(null)).toBe('closed.webp');
  });

  it('a player two-frame set (a and m) uses m for the narrow vowels', async () => {
    const { frameFor } = await import('../customArt');
    const blob = new Blob();
    const art = { mode: 'frames' as const, frames: [{ id: 'A', viseme: 'a' as const, blob }, { id: 'M', viseme: 'm' as const, blob }] };
    expect(frameFor(art, 'i')?.id).toBe('M');
    expect(frameFor(art, 'u')?.id).toBe('M');
    expect(frameFor(art, 'e')?.id).toBe('M');
    expect(frameFor(art, 'o')?.id).toBe('A');
  });
});
