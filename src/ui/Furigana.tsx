// 漢字の読み仮名 for display: `学校[がっこう]` becomes <ruby>学校<rt>がっこう</rt></ruby>; a `[` still being streamed is
// hidden (never shown raw). Pure text helpers live in game/furigana.ts.
import type { ReactNode } from 'react';
import { parseRuby } from '../game/furigana';

export function rubyNodes(text: string): ReactNode[] {
  // a trailing `[...` that is still being streamed is dropped; complete readings are kept for parseRuby
  const open = /\[[^[\]]*$/.exec(text);
  const shown = open ? text.slice(0, open.index) : text;
  return parseRuby(shown).map((seg, i) => ('base' in seg ? <ruby key={`r${i}`}>{seg.base}<rt>{seg.ruby}</rt></ruby> : seg.text));
}
