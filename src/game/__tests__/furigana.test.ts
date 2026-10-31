import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { parseRuby, stripRuby } from '../furigana';
import { speakableText } from '../tts';
import { sameJa, normalizeJa } from '../tipsBook';

describe('furigana helpers', () => {
  it('splits a kanji run and its reading from the plain text around it', () => {
    expect(parseRuby('学校[がっこう]に行[い]きました')).toEqual([
      { base: '学校', ruby: 'がっこう' },
      { text: 'に' },
      { base: '行', ruby: 'い' },
      { text: 'きました' },
    ]);
  });

  it('keeps kana-only text and 々 runs, and empty text is empty', () => {
    expect(parseRuby('そうなんだ')).toEqual([{ text: 'そうなんだ' }]);
    expect(parseRuby('人々[ひとびと]')).toEqual([{ base: '人々', ruby: 'ひとびと' }]);
    expect(parseRuby('')).toEqual([]);
  });

  it('stripRuby removes the readings only', () => {
    expect(stripRuby('学校[がっこう]に行[い]きました。')).toBe('学校に行きました。');
    expect(stripRuby('そうなんだ')).toBe('そうなんだ');
  });

  it('normalizeJa strips readings first, so 学校[がっこう] equals 学校', () => {
    expect(normalizeJa('学校[がっこう]')).toBe(normalizeJa('学校'));
    expect(sameJa('学校[がっこう]に行[い]きました', '学校に行きました')).toBe(true);
  });
});

describe('TTS never reads the readings', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('drops the [かな] before the brackets are removed', () => {
    expect(speakableText('学校[がっこう]に行[い]きました。')).toBe('学校に行きました。');
  });

  it('drops a reading still being streamed at the end', () => {
    expect(speakableText('学校[がっこ')).toBe('学校');
  });
});
