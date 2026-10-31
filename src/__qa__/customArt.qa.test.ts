// QA: the custom picture (game/customArt.ts): frame rules, file intake limits, and storage that is missing or refused.
import { describe, expect, it } from 'vitest';
import {
  canUseFrames, customPortraitOf, frameFor, nextFreeShape, prepareImage, loadCustomArt, saveCustomArt, CUSTOM_MAX_FRAMES,
  type CustomArt, type CustomArtFrame,
} from '../game/customArt';

const f = (id: string, viseme: CustomArtFrame['viseme']): CustomArtFrame => ({ id, viseme, blob: new Blob(['x'], { type: 'image/png' }) });

describe('frame rules', () => {
  it('a frames picture with one frame is shown as a single picture', () => {
    const art: CustomArt = { mode: 'frames', frames: [f('1', 'a')] };
    expect(canUseFrames(art)).toBe(false);
    const view = customPortraitOf(art, { '1': 'blob:one' });
    expect(view?.mode).toBe('single');
    expect(view?.pictureFor('e')).toBe('blob:one');
    expect(view?.pictureFor(null)).toBe('blob:one');
  });

  it('a mouth shape with no frame of its own uses the a frame, then the first frame', () => {
    const art: CustomArt = { mode: 'frames', frames: [f('i', 'i'), f('a', 'a')] };
    expect(frameFor(art, 'o')?.id).toBe('a');
    const noA: CustomArt = { mode: 'frames', frames: [f('i', 'i'), f('u', 'u')] };
    expect(frameFor(noA, 'o')?.id).toBe('i');
  });

  it('silence uses the m frame, else the first frame', () => {
    expect(frameFor({ mode: 'frames', frames: [f('a', 'a'), f('m', 'm')] }, null)?.id).toBe('m');
    expect(frameFor({ mode: 'frames', frames: [f('a', 'a'), f('e', 'e')] }, null)?.id).toBe('a');
  });

  it('a single picture ignores the mouth shape', () => {
    expect(frameFor({ mode: 'single', frames: [f('only', null)] }, 'a')?.id).toBe('only');
  });

  it('no frames: nothing to show, and the portrait falls back to the hamster (null)', () => {
    expect(frameFor({ mode: 'frames', frames: [] }, 'a')).toBeNull();
    expect(customPortraitOf({ mode: 'single', frames: [] }, {})).toBeNull();
  });

  it('a frame without a loaded URL is not drawn (pictureFor null)', () => {
    const view = customPortraitOf({ mode: 'frames', frames: [f('a', 'a'), f('e', 'e')] }, { a: 'blob:a' });
    expect(view?.pictureFor('e')).toBeNull();
  });

  it('nextFreeShape: the first shape no frame uses, null when all six are taken', () => {
    expect(nextFreeShape([f('1', 'a'), f('2', 'e')])).toBe('i');
    expect(nextFreeShape(['a', 'e', 'i', 'o', 'u', 'm'].map((v, i) => f(String(i), v as never)))).toBeNull();
  });

  it('the cap is 6 frames', () => {
    expect(CUSTOM_MAX_FRAMES).toBe(6);
  });
});

describe('image intake', () => {
  it('an SVG is refused before anything is decoded', async () => {
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], 'a.svg', { type: 'image/svg+xml' });
    await expect(prepareImage(svg)).rejects.toThrow('只能選 PNG、JPG、WebP 或 GIF 圖片');
  });

  it('a file over 15 MB is refused by its size, before decoding', async () => {
    const big = new File([new Uint8Array(15 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    await expect(prepareImage(big)).rejects.toThrow('超過 15 MB');
  });

  it('exactly 15 MB passes the size check (then fails to decode in this test runner)', async () => {
    const edge = new File([new Uint8Array(15 * 1024 * 1024)], 'edge.png', { type: 'image/png' });
    // the size check passes; decoding is impossible here (no image decoder in jsdom), so it fails with the decode message
    await expect(prepareImage(edge)).rejects.toThrow(/讀不到這張圖|createImageBitmap|無法/);
  });

  it('a GIF is accepted by type (its first frame is drawn by the browser)', async () => {
    const gif = new File([new Uint8Array([0x47, 0x49, 0x46])], 'a.gif', { type: 'image/gif' });
    // the type check passes; decoding fails in jsdom, which is a decode failure, not a type refusal
    await expect(prepareImage(gif)).rejects.not.toThrow('只能選');
  });
});

describe('storage that is missing or refused', () => {
  it('no IndexedDB in this runner: loading gives no custom art (no throw)', async () => {
    await expect(loadCustomArt('mugi')).resolves.toBeNull();
    await expect(loadCustomArt('yui')).resolves.toBeNull();
  });

  it('no IndexedDB: saving throws the Chinese storage message', async () => {
    await expect(saveCustomArt({ mode: 'single', frames: [f('1', null)] }, 'yui')).rejects.toThrow('無法儲存圖片');
  });
});
