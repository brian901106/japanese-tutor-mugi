// Red-team: the declared size of a picture is read from its header before the browser decodes it (src/game/imageSize.ts).
// Every file here is built in memory with a crafted header: no decoder runs, nothing is read from disk.
import { describe, expect, it } from 'vitest';
import { declaredSize, imageSizeRefusal, IMAGE_TOO_BIG_MESSAGE, MAX_PIXELS, MAX_SIDE_PX } from '../game/imageSize.ts';

const bytes = (...xs: number[]) => new Uint8Array(xs);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16be = (n: number) => [(n >>> 8) & 255, n & 255];
const u16le = (n: number) => [n & 255, (n >>> 8) & 255];
const u24le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const u32le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

function png(w: number, h: number) {
  return bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32be(13), ...ascii('IHDR'), ...u32be(w), ...u32be(h), 8, 2, 0, 0, 0, 0, 0, 0, 0, 0);
}
function gif(w: number, h: number) {
  return bytes(...ascii('GIF89a'), ...u16le(w), ...u16le(h), 0x80, 0, 0, 0, 0, 0);
}
/** JPEG: SOI, an APP0 segment (to test the walk), then a baseline SOF0 with the given size */
function jpeg(w: number, h: number) {
  return bytes(0xff, 0xd8, 0xff, 0xe0, ...u16be(16), ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, ...u16be(17), 8, ...u16be(h), ...u16be(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xda, 0, 2);
}
function webpVp8x(w: number, h: number) {
  return bytes(...ascii('RIFF'), ...u32le(30), ...ascii('WEBP'), ...ascii('VP8X'), ...u32le(10), 0x10, 0, 0, 0, ...u24le(w - 1), ...u24le(h - 1));
}
function webpVp8l(w: number, h: number) {
  const w1 = w - 1;
  const h1 = h - 1;
  const b0 = w1 & 0xff;
  const b1 = ((w1 >> 8) & 0x3f) | ((h1 & 0x03) << 6);
  const b2 = (h1 >> 2) & 0xff;
  const b3 = (h1 >> 10) & 0x0f;
  return bytes(...ascii('RIFF'), ...u32le(20), ...ascii('WEBP'), ...ascii('VP8L'), ...u32le(5), 0x2f, b0, b1, b2, b3);
}
function webpVp8(w: number, h: number) {
  return bytes(...ascii('RIFF'), ...u32le(30), ...ascii('WEBP'), ...ascii('VP8 '), ...u32le(10), 0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, ...u16le(w), ...u16le(h));
}

describe('the declared size is read from each format header', () => {
  it('PNG: width and height from IHDR', () => {
    expect(declaredSize(png(640, 480))).toEqual({ width: 640, height: 480 });
  });
  it('GIF: the logical screen size', () => {
    expect(declaredSize(gif(300, 200))).toEqual({ width: 300, height: 200 });
  });
  it('JPEG: the size in the start-of-frame segment, after other segments', () => {
    expect(declaredSize(jpeg(1024, 768))).toEqual({ width: 1024, height: 768 });
  });
  it('WebP: lossy (VP8), lossless (VP8L) and extended (VP8X) canvases', () => {
    expect(declaredSize(webpVp8(1200, 900))).toEqual({ width: 1200, height: 900 });
    expect(declaredSize(webpVp8l(1500, 1000))).toEqual({ width: 1500, height: 1000 });
    expect(declaredSize(webpVp8x(4000, 3000))).toEqual({ width: 4000, height: 3000 });
  });
  it('a format it does not know, a cut-short header, and an empty file give null (the decoder decides)', () => {
    expect(declaredSize(bytes(1, 2, 3, 4))).toBeNull();
    expect(declaredSize(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
    expect(declaredSize(new Uint8Array(0))).toBeNull();
    expect(declaredSize(bytes(0xff, 0xd8, 0xff, 0xda, 0, 2))).toBeNull(); // a JPEG whose scan starts before any frame
  });
});

describe('the limits: a side over 12000, or more than 25 megapixels, is refused', () => {
  it('MAX_SIDE_PX is 12000 and MAX_PIXELS is 25 million', () => {
    expect(MAX_SIDE_PX).toBe(12000);
    expect(MAX_PIXELS).toBe(25_000_000);
  });
  it('a PNG declaring 30000 × 30000 (a tiny file) is refused', () => {
    expect(imageSizeRefusal(png(30000, 30000))).toBe(IMAGE_TOO_BIG_MESSAGE);
  });
  it('a side over 12000 is refused even when the area is small', () => {
    expect(imageSizeRefusal(png(12001, 2))).toBe(IMAGE_TOO_BIG_MESSAGE);
    expect(imageSizeRefusal(gif(2, 12001))).toBe(IMAGE_TOO_BIG_MESSAGE);
    expect(imageSizeRefusal(webpVp8(12001, 2))).toBe(IMAGE_TOO_BIG_MESSAGE);
    expect(imageSizeRefusal(webpVp8x(12001, 2))).toBe(IMAGE_TOO_BIG_MESSAGE);
  });
  it('a JPEG frame declaring 13000 × 100 is refused (the SOF after an APP0 segment)', () => {
    expect(imageSizeRefusal(jpeg(13000, 100))).toBe(IMAGE_TOO_BIG_MESSAGE);
  });
  it('more than 25 megapixels is refused: 6000 × 6000 is 36 MP, 5000 × 5000 (25 MP) is fine', () => {
    expect(imageSizeRefusal(png(6000, 6000))).toBe(IMAGE_TOO_BIG_MESSAGE);
    expect(imageSizeRefusal(png(7000, 7000))).toBe(IMAGE_TOO_BIG_MESSAGE);
    expect(imageSizeRefusal(png(5000, 5000))).toBeNull();
    expect(imageSizeRefusal(png(5001, 5000))).toBe(IMAGE_TOO_BIG_MESSAGE);
  });
  it('a lossless WebP declaring 12000 × 4000 (48 MP) is refused, a 4000 × 3000 one is fine', () => {
    expect(imageSizeRefusal(webpVp8l(12000, 4000))).toBe(IMAGE_TOO_BIG_MESSAGE);
    expect(imageSizeRefusal(webpVp8l(4000, 3000))).toBeNull();
  });
  it('a GIF declaring 65535 × 65535 is refused', () => {
    expect(imageSizeRefusal(gif(65535, 65535))).toBe(IMAGE_TOO_BIG_MESSAGE);
  });
  it('an ordinary photo size passes, and so does a picture with no readable header', () => {
    expect(imageSizeRefusal(jpeg(4032, 3024))).toBeNull();
    expect(imageSizeRefusal(bytes(9, 9, 9))).toBeNull();
  });
});
