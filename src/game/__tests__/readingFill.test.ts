// Server-side reading filler (server/readings.ts) with the real kuromoji dictionary: sentences in the teacher's style.
import { describe, expect, it } from 'vitest';
import { alignReading, fillReadings } from '../../../server/readings.ts';

const fill = (inner: string) => fillReadings(`<ja>${inner}</ja>`).then((s) => s.slice('<ja>'.length, -'</ja>'.length));

describe('alignReading (kana runs must line up with the reading)', () => {
  it('okurigana belongs outside the brackets', () => {
    expect(alignReading('行き', 'イキ')).toEqual(['い']);
    expect(alignReading('食べ物', 'タベモノ')).toEqual(['た', 'もの']);
    expect(alignReading('学校', 'ガッコウ')).toEqual(['がっこう']);
  });
  it('gives null when the kana do not match the reading', () => {
    expect(alignReading('行き', 'カエリ')).toBeNull();
  });
});

describe('fillReadings: missing readings are added', () => {
  it('adds readings to kanji words and keeps the okurigana outside', async () => {
    expect(await fill('学校に行きました')).toBe('学校[がっこう]に行[い]きました');
  });
  it('plain kana-only text is untouched', async () => {
    expect(await fill('そうなんだ！')).toBe('そうなんだ！');
  });
  it('several sentences', async () => {
    expect(await fill('日本語を勉強します')).toBe('日本語[にほんご]を勉強[べんきょう]します');
    expect(await fill('今日は雨ですね')).toBe('今日[きょう]は雨[あめ]ですね');
    expect(await fill('見てください')).toBe('見[み]てください');
    expect(await fill('東京に住んでいます')).toBe('東京[とうきょう]に住[す]んでいます');
  });
  it('kanji run at the very end of the segment', async () => {
    expect(await fill('学校')).toBe('学校[がっこう]');
    expect(await fill('ご飯を食べ物')).toBe('ご飯[はん]を食[た]べ物[もの]');
  });
  it('numbers get no reading, the kanji after them does', async () => {
    expect(await fill('9時に起きます')).toBe('9時[じ]に起[お]きます');
  });
  it('a 々 repeat, and a compound the analyser would split (一人 is read as one word)', async () => {
    expect(await fill('人々が集まる')).toBe('人々[ひとびと]が集[あつ]まる');
    expect(await fill('一人で行く')).toBe('一人[ひとり]で行[い]く');
  });
  it('a verb with a kana tail: the kanji keeps its own reading', async () => {
    expect(await fill('生まれました')).toBe('生[う]まれました');
  });
});

describe('fillReadings: existing readings are never altered', () => {
  it('a correct reading stays, the unannotated part gets its own', async () => {
    expect(await fill('学校[がっこう]に行きました')).toBe('学校[がっこう]に行[い]きました');
  });
  it('an existing reading is kept even where the analyser would say otherwise', async () => {
    expect(await fill('学校[がくこう]に行きました')).toBe('学校[がくこう]に行[い]きました');
  });
  it('is idempotent: a second pass changes nothing', async () => {
    const once = await fill('学校に行きました');
    expect(await fill(once)).toBe(once);
  });
  it('text outside <ja> is not touched', async () => {
    expect(await fillReadings('學校（がっこう）<ja>学校に</ja>行く')).toBe('學校（がっこう）<ja>学校[がっこう]に</ja>行く');
  });
});
