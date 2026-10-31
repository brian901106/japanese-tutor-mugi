import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { rubyNodes } from '../Furigana';

const html = (s: string) => renderToStaticMarkup(<>{rubyNodes(s)}</>);

describe('rubyNodes', () => {
  it('turns X[y] into ruby with the reading in rt', () => {
    expect(html('学校[がっこう]に行[い]きました')).toBe(
      '<ruby>学校<rt>がっこう</rt></ruby>に<ruby>行<rt>い</rt></ruby>きました',
    );
  });

  it('shows plain text unchanged', () => {
    expect(html('そうなんだ！')).toBe('そうなんだ！');
  });

  it('hides a reading that is still streaming (no raw [ shown)', () => {
    expect(html('学校[がっこ')).toBe('学校');
    expect(html('学校[')).toBe('学校');
  });
});
