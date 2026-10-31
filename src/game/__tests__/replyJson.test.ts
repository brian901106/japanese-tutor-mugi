// The shared reply JSON helpers (game/replyJson.ts): the reader for a cut JSON text, the field reader, the canonical form,
// and the history helpers (merge, fit). Pure: nothing here calls Claude or the network.
import { describe, expect, it } from 'vitest';
import {
  canonicalReplyJson, displayOf, fitReplyJson, isReplyJson, mergeReplyJson, parsePartialJson, readReplyValue, repairJson, scanJson, toSegments,
} from '../replyJson';

describe('scanJson: where the segments array stands', () => {
  it('the array is open until its ] comes, and a ] inside a string or a nested array does not count', () => {
    expect(scanJson('{"segments":[{"lang":"ja","text":"]"').arrayClosed).toBe(false);
    expect(scanJson('{"segments":[{"lang":"ja","text":"a"}]').arrayClosed).toBe(true);
    expect(scanJson('{"segments":[{"text":"x\\"]"}],"tip":""}').arrayClosed).toBe(true);
    expect(scanJson('{"tip":"]"}').arrayClosed).toBe(false);
  });
});

describe('parsePartialJson: a JSON text cut anywhere', () => {
  it('a complete text reads as it is', () => {
    expect(parsePartialJson('{"tip":"","segments":[]}')).toEqual({ tip: '', segments: [] });
  });
  it('a cut inside a string: the string is closed, its text so far is kept', () => {
    expect(parsePartialJson('{"segments":[{"lang":"ja","text":"学校に')).toEqual({ segments: [{ lang: 'ja', text: '学校に' }] });
  });
  it('a cut after a colon: the value is null', () => {
    expect(parsePartialJson('{"segments":[{"lang":"ja","text":"a","gloss":')).toEqual({ segments: [{ lang: 'ja', text: 'a', gloss: null }] });
  });
  it('a trailing comma is dropped and the open containers are closed', () => {
    expect(parsePartialJson('{"segments":[{"lang":"ja","text":"a"},')).toEqual({ segments: [{ lang: 'ja', text: 'a' }] });
  });
  it('a dangling backslash inside a string is dropped', () => {
    expect(repairJson('{"text":"a\\')).toBe('{"text":"a"}');
    expect(parsePartialJson('{"text":"a\\')).toEqual({ text: 'a' });
  });
  it('a key cut before its value cannot be repaired: nothing reads (the caller keeps what it had)', () => {
    expect(parsePartialJson('{"segments":[{"lang":"ja","te')).toBeUndefined();
  });
  it('an empty text or plain text reads as nothing', () => {
    expect(parsePartialJson('')).toBeUndefined();
    expect(parsePartialJson('   ')).toBeUndefined();
    expect(parsePartialJson('好呀')).toBeUndefined();
  });
});

describe('readReplyValue: the fields, each checked', () => {
  it('a wrong type is dropped to its empty value', () => {
    expect(readReplyValue({ segments: 'x', tip: 3, tone: 'explode' })).toEqual({ segments: [], tip: '', tone: undefined });
    expect(readReplyValue(null)).toEqual({ segments: [], tip: '', tone: undefined });
  });
  it('a segment with an unknown lang keeps its text but has no lang (it is not voiced, not stored)', () => {
    const f = readReplyValue({ segments: [{ lang: 'en', text: 'hi' }, { lang: 'ja', text: 'はい', gloss: '好' }] });
    expect(f.segments).toEqual([{ lang: undefined, text: 'hi', gloss: '' }, { lang: 'ja', text: 'はい', gloss: '好' }]);
    expect(toSegments(f)).toEqual([{ lang: 'ja', text: 'はい', gloss: '好' }]);
  });
  it('a valid tone is kept', () => {
    expect(readReplyValue({ segments: [], tip: '', tone: 'sad' }).tone).toBe('sad');
  });
});

describe('displayOf: the text shown', () => {
  it('a Japanese segment shows its gloss in full-width brackets after it, when the gloss is there', () => {
    expect(displayOf([{ lang: 'ja', text: 'はい', gloss: '好' }, { lang: 'ja', text: 'いいえ', gloss: '' }])).toBe('はい（好）いいえ');
  });
  it('a Chinese segment shows its text only', () => {
    expect(displayOf([{ lang: 'zh', text: '好呀', gloss: '不該顯示' }])).toBe('好呀');
  });
});

describe('canonicalReplyJson: the one stored form', () => {
  it('fixed key order, no spaces, the tone left out when there is none', () => {
    expect(canonicalReplyJson({ segments: [{ lang: 'ja', text: 'はい', gloss: '好' }], tip: '', tone: 'happy' }))
      .toBe('{"segments":[{"lang":"ja","text":"はい","gloss":"好"}],"tip":"","tone":"happy"}');
    expect(canonicalReplyJson({ segments: [], tip: 'x' })).toBe('{"segments":[],"tip":"x"}');
  });
  it('is stable: canonicalising the canonical form gives the same text', () => {
    const once = canonicalReplyJson({ segments: [{ lang: 'ja', text: '学校', gloss: '學校' }], tip: '要說 <ja>学校</ja>', tone: 'explain' });
    expect(canonicalReplyJson(JSON.parse(once))).toBe(once);
  });
  it('isReplyJson is true for it, false for plain text, a tag form and JSON without segments', () => {
    expect(isReplyJson('{"segments":[],"tip":""}')).toBe(true);
    expect(isReplyJson('好呀')).toBe(false);
    expect(isReplyJson('<ja>はい</ja>（好）')).toBe(false);
    expect(isReplyJson('{"tip":""}')).toBe(false);
    expect(isReplyJson('{nope')).toBe(false);
  });
});

describe('mergeReplyJson: two replies in a row, one reply', () => {
  it('the segments in order, no tip, the later tone', () => {
    const a = '{"segments":[{"lang":"ja","text":"はい","gloss":"好"}],"tip":"x","tone":"happy"}';
    const b = '{"segments":[{"lang":"ja","text":"いいえ","gloss":"不"}],"tip":"","tone":"sad"}';
    expect(mergeReplyJson(a, b)).toBe('{"segments":[{"lang":"ja","text":"はい","gloss":"好"},{"lang":"ja","text":"いいえ","gloss":"不"}],"tip":"","tone":"sad"}');
  });
  it('the earlier tone stays when the later reply has none', () => {
    const a = '{"segments":[],"tip":"","tone":"agree"}';
    const b = '{"segments":[],"tip":""}';
    expect(JSON.parse(mergeReplyJson(a, b)).tone).toBe('agree');
  });
});

describe('fitReplyJson: a stored reply cut to a length', () => {
  it('within the limit it comes back as it is', () => {
    const t = '{"segments":[{"lang":"ja","text":"はい","gloss":"好"}],"tip":"","tone":"happy"}';
    expect(fitReplyJson(t, 1000)).toBe(t);
  });
  it('over the limit the oldest segments go first, and the result is still valid JSON', () => {
    const t = canonicalReplyJson({
      segments: ['一', '二', '三', '四'].map((s) => ({ lang: 'ja' as const, text: s.repeat(40), gloss: '' })),
      tip: '',
      tone: 'happy',
    });
    const out = fitReplyJson(t, 200);
    expect(out.length).toBeLessThanOrEqual(200);
    const j = JSON.parse(out) as { segments: { text: string }[] };
    expect(j.segments.length).toBeGreaterThan(0);
    expect(j.segments[j.segments.length - 1].text).toBe('四'.repeat(40));
  });
});
