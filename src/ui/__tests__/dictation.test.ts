import { describe, expect, it } from 'vitest';
import { joinDictation } from '../dictation';

describe('joinDictation', () => {
  it('CJK / Japanese text is joined without a space', () => {
    expect(joinDictation('', '你好')).toBe('你好');
    expect(joinDictation('你好', '嗎')).toBe('你好嗎');
    expect(joinDictation('こんにちは', 'ありがとう')).toBe('こんにちはありがとう');
    expect(joinDictation('abc', '你好')).toBe('abc你好');
  });
  it('a single space goes between two Latin words or digits', () => {
    expect(joinDictation('hello', 'world')).toBe('hello world');
    expect(joinDictation('hello', '2 cats')).toBe('hello 2 cats');
    expect(joinDictation('it is 2', 'more')).toBe('it is 2 more');
  });
  it('no double spaces: existing trailing space and surrounding space of the new text are handled', () => {
    expect(joinDictation('hello ', 'world')).toBe('hello world');
    expect(joinDictation('hello', '  world  ')).toBe('hello world');
    expect(joinDictation('你好 ', ' 嗎 ')).toBe('你好 嗎');
  });
  it('empty new text leaves the base as it is; an empty base takes the new text', () => {
    expect(joinDictation('你好', '')).toBe('你好');
    expect(joinDictation('你好', '   ')).toBe('你好');
    expect(joinDictation('', '')).toBe('');
    expect(joinDictation('', ' hi ')).toBe('hi');
  });
});
