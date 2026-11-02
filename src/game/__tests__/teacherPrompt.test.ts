import { describe, expect, it } from 'vitest';
import { reminderPrompt, systemPrompt } from '../../../server/prompts.ts';

// the volatile rules (tip details, readings, self-check) live in the reminder, which rides on the newest user message;
// the system prompt is the stable part and must not carry them.
describe('teacher reminder: the 小提醒 is Chinese, Japanese only inside <ja>', () => {
  const r = reminderPrompt();
  it('says plainly that the tip is Traditional Chinese, with Japanese only inside <ja>', () => {
    expect(r).toContain('tip 必須用繁體中文寫');
    expect(r).toContain('<ja> 以外不可以出現任何假名');
  });
  it('ends with the self-check list (tip is Chinese, readings, no kana outside <ja>)', () => {
    expect(r).toContain('寫完之前逐項檢查');
    expect(r.indexOf('寫完之前逐項檢查')).toBeGreaterThan(r.indexOf('開頭不要加「小提醒」'));
  });
  it('the system prompt carries none of the volatile tip rules or the self-check', () => {
    const p = systemPrompt('Mugi');
    expect(p).not.toContain('寫完之前逐項檢查');
    expect(p).not.toContain('必須用繁體中文寫');
    expect(p).not.toContain('開頭不要加');
    expect(p).not.toContain('半形方括號');
  });
});

describe('teacher reminder: readings and no 小提醒 label', () => {
  const r = reminderPrompt();
  it('asks for hiragana readings in half-width brackets right after the kanji', () => {
    expect(r).toContain('学校[がっこう]に行[い]きました');
    expect(r).toContain('半形方括號');
  });
  it('the tip example and rule carry no 小提醒： label', () => {
    expect(r).not.toContain('小提醒：');
    expect(r).toContain('開頭不要加「小提醒」');
  });
});

// the reply is a JSON object (Structured Outputs): the prompts describe its fields and carry no tag vocabulary
describe('teacher prompts describe the JSON reply, with no tags to write', () => {
  it('the system prompt names the three fields and says lang is ja, gloss is the Chinese meaning', () => {
    const p = systemPrompt('Mugi');
    for (const word of ['segments', 'tip', 'tipLevel', 'tone', 'lang', 'gloss']) expect(p).toContain(word);
    expect(p).toContain('"ja"');
  });
  it('the system prompt says what tipLevel is: the JLPT level of the tip, 級外 for the rest, \'\' with no tip', () => {
    const p = systemPrompt('Mugi');
    expect(p).toContain('tipLevel：tip 裡教的日文');
    expect(p).toContain('只能是 N5、N4、N3、N2、N1 或 級外');
    expect(p).toContain('四個欄位');
  });
  it('the system prompt asks for no <meta> or <tip> tags in the reply (the tip keeps its <ja> inside the string)', () => {
    const p = systemPrompt('Mugi');
    expect(p).not.toContain('<meta>');
    expect(p).not.toContain('<tip>…</tip>');
  });
  it('the reminder shows one reply as JSON, with a tip whose Japanese is in <ja>', () => {
    const r = reminderPrompt();
    const example = /\{"segments":.*"tone":"happy"\}/.exec(r)?.[0] ?? '';
    expect(example).not.toBe('');
    const parsed = JSON.parse(example) as { segments: { lang: string; text: string; gloss: string }[]; tip: string; tipLevel: string; tone: string };
    expect(parsed.segments[0].lang).toBe('ja');
    expect(parsed.tip).toContain('<ja>');
    expect(parsed.tone).toBe('happy');
    expect(parsed.tipLevel).toBe('N5');
  });
});
