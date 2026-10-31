import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addTip, loadTips, resetTipsCacheForTest, stripTipLabel } from '../tipsBook';

describe('stripTipLabel', () => {
  it('drops a leading 小提醒 / 提醒 / Tip label with either colon', () => {
    expect(stripTipLabel('小提醒：要說 学校。')).toBe('要說 学校。');
    expect(stripTipLabel('  小提醒:要說 学校。')).toBe('要說 学校。');
    expect(stripTipLabel('提醒：注意助詞')).toBe('注意助詞');
    expect(stripTipLabel('Tip： use に')).toBe('use に');
  });

  it('leaves the text alone when there is no leading label', () => {
    expect(stripTipLabel('要說 学校。')).toBe('要說 学校。');
    expect(stripTipLabel('這句的小提醒：不是開頭')).toBe('這句的小提醒：不是開頭');
  });
});

describe('addTip stores the text without the label', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
    });
    resetTipsCacheForTest();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('saves the tip with its label removed', () => {
    addTip({ text: '小提醒：要說 学校。', targets: ['学校'], role: 'Mugi' });
    expect(loadTips()[0].text).toBe('要說 学校。');
  });
});
