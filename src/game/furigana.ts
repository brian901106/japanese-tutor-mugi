// 漢字の読み仮名: her Japanese may write a reading in half-width brackets right after the kanji it belongs to,
// `学校[がっこう]に行[い]きました`. The reading belongs to the run of kanji (Han, 々, 〆, ヶ) immediately before the `[`.
// Shown as <ruby> (ui/Furigana.tsx); never spoken and never compared (stripRuby). Pure: no DOM, no storage.

/** one reading: `base` (the kanji run) and its `ruby` (the kana); or plain text */
export type RubySeg = { text: string } | { base: string; ruby: string };

/** a complete `[...]` reading (no nested brackets) */
const READING = /\[[^[\]]*\]/g;
/** kanji run + its reading */
const RUBY = /([\p{Script=Han}々〆ヶ]+)\[([^[\]]*)\]/gu;

/** the text without any readings: what is compared, judged and spoken */
export const stripRuby = (s: string): string => s.replace(READING, '');

/** the text split into plain parts and kanji+reading parts (for display) */
export function parseRuby(s: string): RubySeg[] {
  const out: RubySeg[] = [];
  let last = 0;
  for (const m of s.matchAll(RUBY)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: s.slice(last, at) });
    out.push({ base: m[1], ruby: m[2] });
    last = at + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}
