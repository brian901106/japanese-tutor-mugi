import { describe, expect, it } from 'vitest';
import { decodeVisemes, encodeVisemes, visemeAt, visemeIndexAt, type Viseme } from '../visemes';
import { visemesOfQuery, visemeOfVowel } from '../../../server/visemes.ts';

// a small audio_query: pre 0.1 s, two accent phrases ("あい。" with a pause), post 0.2 s
const query = {
  prePhonemeLength: 0.1,
  postPhonemeLength: 0.2,
  accent_phrases: [
    { moras: [{ text: 'ア', vowel: 'a', vowel_length: 0.1, consonant: null, consonant_length: null }, { text: 'イ', vowel: 'i', vowel_length: 0.2, consonant: null, consonant_length: null }], pause_mora: { vowel: 'pau', vowel_length: 0.3 } },
    { moras: [{ text: 'ッ', vowel: 'cl', vowel_length: 0.05, consonant: null, consonant_length: null }, { text: 'ン', vowel: 'N', vowel_length: 0.15, consonant: null, consonant_length: null }, { text: 'カ', vowel: 'a', vowel_length: 0.1, consonant: 'k', consonant_length: 0.05 }] },
  ],
};

describe('viseme codes from VOICEVOX vowels', () => {
  it('maps a/i/u/e/o to their shapes and every other vowel (N, cl, pau, unknown) to closed m', () => {
    expect(['a', 'i', 'u', 'e', 'o'].map(visemeOfVowel)).toEqual(['a', 'i', 'u', 'e', 'o']);
    expect(['N', 'cl', 'pau', 'xx', undefined].map(visemeOfVowel)).toEqual(['m', 'm', 'm', 'm', 'm']);
  });
});

describe('visemesOfQuery: mora → timeline', () => {
  const list = visemesOfQuery(query);
  it('starts with the pre-silence and ends with the post-silence, both closed', () => {
    expect(list[0]).toEqual({ t: 0, d: 100, v: 'm' });
    expect(list[list.length - 1].v).toBe('m');
    // pre 100 + a 100 + i 200 + pause 300 + っ 50 + ん 150 + ka 150 + post 200 ms
    expect(list[list.length - 1].t + list[list.length - 1].d).toBe(1250);
  });
  it('one shape per mora; the pause, っ and ん are closed and merge into one closed stretch', () => {
    expect(list.map((x) => x.v)).toEqual(['m', 'a', 'i', 'm', 'a', 'm']);
    expect(list[3]).toEqual({ t: 400, d: 500, v: 'm' });
  });
  it('the consonant of a mora is spoken with its vowel (one shape, the lengths added)', () => {
    const ka = list.find((x) => x.v === 'a' && x.d === 150);
    expect(ka).toBeDefined(); // consonant 0.05 + vowel 0.10 (not two shapes)
    expect(ka!.t).toBe(900);
  });
  it('starts are contiguous (no gaps, no overlaps)', () => {
    for (let i = 1; i < list.length; i++) expect(list[i].t).toBe(list[i - 1].t + list[i - 1].d);
  });
  it('an empty or broken query gives no timeline', () => {
    expect(visemesOfQuery(null)).toEqual([]);
    expect(visemesOfQuery({ accent_phrases: [{ moras: [{ vowel: 'a', vowel_length: -1 }] }] })).toEqual([]);
  });
});

describe('the phone reads the timeline at the playback speed', () => {
  const tl: Viseme[] = [{ t: 0, d: 100, v: 'm' }, { t: 100, d: 200, v: 'a' }, { t: 300, d: 100, v: 'i' }];
  it('at speed 1 the moment is the timeline position', () => {
    expect(visemeAt(tl, 50, 1)).toBe('m');
    expect(visemeAt(tl, 150, 1)).toBe('a');
    expect(visemeAt(tl, 350, 1)).toBe('i');
    expect(visemeAt(tl, 400, 1)).toBeNull(); // after the last shape
  });
  it('a faster clip (speed 1.25) is shorter on the phone: the same shape comes sooner in playback time', () => {
    // at playback 80 ms the source time is 100 ms → the first 'a'
    expect(visemeAt(tl, 80, 1.25)).toBe('a');
    expect(visemeAt(tl, 79, 1.25)).toBe('m');
  });
  it('a slower clip (speed 0.8) keeps each shape longer in playback time', () => {
    expect(visemeAt(tl, 124, 0.8)).toBe('m'); // source 99.2 ms
    expect(visemeAt(tl, 126, 0.8)).toBe('a'); // source 100.8 ms
  });
  it('the index of the shape is what picks the overlay take', () => {
    expect(visemeIndexAt(tl, 150, 1)).toBe(1);
    expect(visemeIndexAt(tl, 5000, 1)).toBe(-1);
    expect(visemeIndexAt(tl, 150, 0)).toBe(-1); // no speed: nothing to play
  });
});

describe('X-TTS-Visemes header codec', () => {
  it('round-trips and skips unreadable parts', () => {
    const list: Viseme[] = [{ t: 0, d: 100, v: 'm' }, { t: 100, d: 250, v: 'o' }];
    expect(encodeVisemes(list)).toBe('0:100:m,100:250:o');
    expect(decodeVisemes(encodeVisemes(list))).toEqual(list);
    expect(decodeVisemes('0:100:m,bad,5:0:a,7:9:z,20:30:e')).toEqual([{ t: 0, d: 100, v: 'm' }, { t: 20, d: 30, v: 'e' }]);
    expect(decodeVisemes(null)).toEqual([]);
  });
});
