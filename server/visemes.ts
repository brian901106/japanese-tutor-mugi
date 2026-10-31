// Mouth timing for the tutor's lip-sync (the mouth clock in src/game/tutorFace.ts uses it). Built from a VOICEVOX audio_query: each accent
// phrase's moras (vowel, consonant_length, vowel_length), its pause_mora, and the sentence's pre / post phoneme padding.
// Every piece becomes one mouth shape: a/i/u/e/o for the vowels, m (closed) for ん, っ, pauses and silence. Times are in
// milliseconds at speed 1 (the synthesis is always made at speedScale 1; the phone scales them by its own 語速).
//
// The wire format (X-TTS-Visemes) is in src/game/visemes.ts.

import type { Viseme, VisemeCode } from '../src/game/visemes.ts';
export { decodeVisemes, encodeVisemes, type Viseme, type VisemeCode } from '../src/game/visemes.ts';

const VOWELS: Record<string, VisemeCode> = { a: 'a', i: 'i', u: 'u', e: 'e', o: 'o' };

/** the mouth shape of one VOICEVOX phoneme vowel: a/i/u/e/o, anything else (N, cl, pau, silence) closed */
export function visemeOfVowel(vowel: unknown): VisemeCode {
  return typeof vowel === 'string' && vowel in VOWELS ? VOWELS[vowel] : 'm';
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * The mouth shapes of an audio_query, in playback order at speed 1. Adjacent pieces with the same shape are merged, so the
 * timeline has one entry per change of mouth. Missing or malformed fields count as 0 (no crash on an odd query).
 */
export function visemesOfQuery(query: unknown): Viseme[] {
  const q = (query && typeof query === 'object' ? query : {}) as Record<string, unknown>;
  const raw: { d: number; v: VisemeCode }[] = [];
  raw.push({ d: num(q.prePhonemeLength), v: 'm' });
  const phrases = Array.isArray(q.accent_phrases) ? q.accent_phrases : [];
  for (const p of phrases) {
    const ap = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
    const moras = Array.isArray(ap.moras) ? ap.moras : [];
    for (const m of moras) {
      const mo = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>;
      // the consonant is spoken with the vowel that follows it: one shape for the whole mora
      raw.push({ d: num(mo.consonant_length) + num(mo.vowel_length), v: visemeOfVowel(mo.vowel) });
    }
    const pause = ap.pause_mora && typeof ap.pause_mora === 'object' ? (ap.pause_mora as Record<string, unknown>) : null;
    if (pause) raw.push({ d: num(pause.vowel_length), v: 'm' });
  }
  raw.push({ d: num(q.postPhonemeLength), v: 'm' });

  const out: Viseme[] = [];
  let t = 0;
  for (const r of raw) {
    if (r.d <= 0) continue;
    const d = Math.round(r.d * 1000);
    const last = out[out.length - 1];
    if (last && last.v === r.v) last.d += d;
    else out.push({ t, d, v: r.v });
    t += d;
  }
  // the rounding above accumulates per piece; the starts are recomputed so they stay contiguous
  let s = 0;
  for (const x of out) { x.t = s; s += x.d; }
  return out;
}

/** remembered audio_query timings by "style|text" (bounded): a cache hit that was never synthesized here still gets its timing */
const memo = new Map<string, Viseme[]>();
const MEMO_MAX = 300;

export function rememberVisemes(style: string, text: string, query: unknown): Viseme[] {
  const list = visemesOfQuery(query);
  const key = `${style}|${text}`;
  memo.delete(key);
  memo.set(key, list);
  if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value as string);
  return list;
}

export const recalledVisemes = (style: string, text: string): Viseme[] | undefined => memo.get(`${style}|${text}`);
