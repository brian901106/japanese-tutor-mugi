// The size a picture declares in its own header (PNG IHDR, GIF logical screen, JPEG SOF, WebP VP8 / VP8L / VP8X), read before
// the browser decodes it: a small file can declare a huge canvas, and decoding it would take a lot of memory. Pure: no DOM.
// A format that is not recognised gives null (the decoder then decides, as before). Refused: a side over MAX_SIDE_PX or more
// than MAX_PIXELS in all (checked by imageSizeRefusal, used by customArt.ts and tutorBackground.ts).

/** the longest side a picture may declare, in pixels */
export const MAX_SIDE_PX = 12000;
/** the most pixels (width × height) a picture may declare: 25 megapixels */
export const MAX_PIXELS = 25_000_000;
export const IMAGE_TOO_BIG_MESSAGE = '圖片尺寸太大，請換一張小一點的圖';

const u16be = (d: Uint8Array, i: number): number => (d[i] << 8) | d[i + 1];
const u16le = (d: Uint8Array, i: number): number => d[i] | (d[i + 1] << 8);
const u24le = (d: Uint8Array, i: number): number => d[i] | (d[i + 1] << 8) | (d[i + 2] << 16);
const u32be = (d: Uint8Array, i: number): number => ((d[i] << 24) >>> 0) + ((d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]);
const ascii = (d: Uint8Array, i: number, s: string): boolean => {
  for (let k = 0; k < s.length; k++) if (d[i + k] !== s.charCodeAt(k)) return false;
  return true;
};

function pngSize(d: Uint8Array): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (d.length < 24 || !sig.every((b, i) => d[i] === b) || !ascii(d, 12, 'IHDR')) return null;
  return { width: u32be(d, 16), height: u32be(d, 20) };
}

function gifSize(d: Uint8Array): { width: number; height: number } | null {
  if (d.length < 10 || !(ascii(d, 0, 'GIF87a') || ascii(d, 0, 'GIF89a'))) return null;
  return { width: u16le(d, 6), height: u16le(d, 8) };
}

/** JPEG: walk the marker segments up to the first start-of-frame (SOF0..SOF15 except DHT, JPG and DAC) */
function jpegSize(d: Uint8Array): { width: number; height: number } | null {
  if (d.length < 4 || d[0] !== 0xff || d[1] !== 0xd8) return null;
  let p = 2;
  while (p + 4 <= d.length) {
    if (d[p] !== 0xff) return null;
    let m = d[p + 1];
    while (m === 0xff && p + 2 < d.length) { p++; m = d[p + 1]; } // fill bytes before a marker
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; } // markers without a length
    if (m === 0xda) return null; // start of scan: no frame header came before it
    const len = u16be(d, p + 2);
    const isSof = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
    if (isSof) {
      if (p + 9 > d.length) return null;
      return { height: u16be(d, p + 5), width: u16be(d, p + 7) };
    }
    if (len < 2) return null;
    p += 2 + len;
  }
  return null;
}

function webpSize(d: Uint8Array): { width: number; height: number } | null {
  if (d.length < 25 || !ascii(d, 0, 'RIFF') || !ascii(d, 8, 'WEBP')) return null;
  if (ascii(d, 12, 'VP8 ')) {
    if (d.length < 30) return null;
    // lossy: the frame tag (3 bytes) at 20, the start code 9d 01 2a at 23, then the dimensions (14 bits each, little-endian)
    return { width: u16le(d, 26) & 0x3fff, height: u16le(d, 28) & 0x3fff };
  }
  if (ascii(d, 12, 'VP8L')) {
    // lossless: signature 0x2f at 20, then 28 bits: width-1 (14), height-1 (14)
    const b0 = d[21];
    const b1 = d[22];
    const b2 = d[23];
    const b3 = d[24];
    return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
  }
  if (ascii(d, 12, 'VP8X')) {
    if (d.length < 30) return null;
    // extended: flags at 20, the canvas width-1 (24 bits) at 24 and height-1 at 27
    return { width: u24le(d, 24) + 1, height: u24le(d, 27) + 1 };
  }
  return null;
}

/** the size a picture declares in its header, or null when the format is not one of the four (or the header is cut short) */
export function declaredSize(d: Uint8Array): { width: number; height: number } | null {
  return pngSize(d) ?? jpegSize(d) ?? webpSize(d) ?? gifSize(d);
}

/** IMAGE_TOO_BIG_MESSAGE when the declared size is over the limits, else null (also null for an unknown format) */
export function imageSizeRefusal(d: Uint8Array): string | null {
  const s = declaredSize(d);
  if (!s) return null;
  if (s.width > MAX_SIDE_PX || s.height > MAX_SIDE_PX || s.width * s.height > MAX_PIXELS) return IMAGE_TOO_BIG_MESSAGE;
  return null;
}
