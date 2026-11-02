// The whole-reply fixes (server/replyFix.ts): her reply JSON gets the readings of its Japanese, a Japanese 小提醒 is wrapped
// in <ja> (kept, not dropped), and a cut reply is read as far as it goes. Nothing here calls Claude.
import { describe, expect, it, vi } from 'vitest';
import { fixReplyJson, isChineseTip, wrapJapanese } from '../../../server/replyFix.ts';
import { canonicalReplyJson } from '../replyJson';

/** a reply in the canonical JSON form, as the server stores it */
const reply = (segments: { lang: 'ja' | 'zh'; text: string; gloss: string }[], tip: string, tone?: 'happy') =>
  canonicalReplyJson({ segments, tip, tone });

describe('wrapJapanese', () => {
  it('wraps the kana run with its kanji and keeps the Chinese outside', () => {
    expect(wrapJapanese('要說 学校に行きましたね，去哪裡要用「に」。')).toBe('要說 <ja>学校に行きましたね</ja>，去哪裡要用「<ja>に</ja>」。');
  });
  it('leaves text that is already inside <ja> alone', () => {
    expect(wrapJapanese('要說 <ja>学校[がっこう]に行[い]きました</ja>，去哪裡。')).toBe('要說 <ja>学校[がっこう]に行[い]きました</ja>，去哪裡。');
  });
  it('a tip that is Japanese only is wrapped as a whole, and stays Japanese', () => {
    expect(wrapJapanese('行きましょう。')).toBe('<ja>行きましょう。</ja>');
  });
  it('plain Chinese is unchanged', () => {
    expect(wrapJapanese('要用「」表示地點。')).toBe('要用「」表示地點。');
  });
});

describe('fixReplyJson: the reply as it is shown and stored', () => {
  it('a reply whose readings are complete and that has no tip comes back unchanged', async () => {
    const raw = reply([{ lang: 'ja', text: 'そうなんだ！楽[たの]しかった？', gloss: '這樣啊！好玩嗎？' }], '', 'happy');
    const out = await fixReplyJson(raw);
    expect(out).toEqual({ json: raw, tipRewrite: false });
  });

  it('the kanji of a segment get their readings (学校に行きました)', async () => {
    const out = await fixReplyJson(reply([{ lang: 'ja', text: '学校に行きました', gloss: '去了學校' }], '', 'happy'));
    expect(JSON.parse(out.json)).toEqual({
      segments: [{ lang: 'ja', text: '学校[がっこう]に行[い]きました', gloss: '去了學校' }],
      tip: '',
      tone: 'happy',
    });
  });

  it('the key order and the spacing are the canonical ones', async () => {
    const out = await fixReplyJson('{ "tone": "happy", "tip": "", "segments": [ {"gloss":"好","text":"はい","lang":"ja"} ] }');
    expect(out.json).toBe('{"segments":[{"lang":"ja","text":"はい","gloss":"好"}],"tip":"","tone":"happy"}');
  });

  it('a Chinese 小提醒 with Japanese in it: the Japanese is wrapped and read, the Chinese stays, no rewrite', async () => {
    const log = vi.fn();
    const out = await fixReplyJson(reply([{ lang: 'ja', text: 'そうなんだ！', gloss: '這樣啊！' }], '要說 学校に行きました，去哪裡要用「に」喔。', 'happy'), { log });
    const j = JSON.parse(out.json) as { tip: string };
    expect(j.tip).toBe('要說 <ja>学校[がっこう]に行[い]きました</ja>，去哪裡要用「<ja>に</ja>」喔。');
    expect(out.tipRewrite).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('wrapped'));
  });

  it('a 小提醒 written in Japanese is kept (wrapped, not dropped) and is marked for the background rewrite', async () => {
    const out = await fixReplyJson(reply([{ lang: 'ja', text: 'そうなんだ！', gloss: '這樣啊！' }], '学校に行きました、「に」が大事です。', 'happy'));
    const j = JSON.parse(out.json) as { tip: string };
    expect(j.tip).toBe('<ja>学校[がっこう]に行[い]きました、</ja>「<ja>に</ja>」<ja>が大事[だいじ]です。</ja>');
    expect(out.tipRewrite).toBe(true);
  });

  it('readings are filled in the tip too (inside its <ja>)', async () => {
    const out = await fixReplyJson(reply([{ lang: 'ja', text: '行きましょう', gloss: '走吧' }], '要說 <ja>学校に行きました</ja>。', 'happy'));
    const j = JSON.parse(out.json) as { segments: { text: string }[]; tip: string };
    expect(j.segments[0].text).toBe('行[い]きましょう');
    expect(j.tip).toBe('要說 <ja>学校[がっこう]に行[い]きました</ja>。');
  });

  it('a reply with no Japanese at all (chat mode, plain Chinese) keeps its Chinese text', async () => {
    const raw = reply([{ lang: 'zh', text: '好呀', gloss: '' }], '', 'happy');
    expect((await fixReplyJson(raw)).json).toBe(raw);
  });

  it('the tip level is kept with its tip; an invalid level is left out, and no tip means no level', async () => {
    const tip = '要說 <ja>学校[がっこう]に行[い]きました</ja>。';
    const ok = await fixReplyJson(`{"segments":[],"tip":"${tip}","tipLevel":"N5","tone":"happy"}`);
    expect(JSON.parse(ok.json)).toEqual({ segments: [], tip, tipLevel: 'N5', tone: 'happy' });
    const bad = await fixReplyJson(`{"segments":[],"tip":"${tip}","tipLevel":"N9"}`);
    expect(JSON.parse(bad.json)).toEqual({ segments: [], tip });
    const none = await fixReplyJson('{"segments":[],"tip":"","tipLevel":"N5"}');
    expect(none.json).toBe('{"segments":[],"tip":""}');
  });

  it('an invalid tone is left out, the rest is kept', async () => {
    const out = await fixReplyJson('{"segments":[{"lang":"ja","text":"はい","gloss":"好"}],"tip":"","tone":"explode"}');
    expect(out.json).toBe('{"segments":[{"lang":"ja","text":"はい","gloss":"好"}],"tip":""}');
  });

  it('an empty reply comes back as an empty reply (the client then reports that there is no reply)', async () => {
    const log = vi.fn();
    const out = await fixReplyJson('', { log });
    expect(out).toEqual({ json: '{"segments":[],"tip":""}', tipRewrite: false });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('no readable JSON'));
  });
});

describe('fixReplyJson: a cut reply (the output limit) is read as far as it goes', () => {
  it('keeps the complete segments and what reads of the cut one, writing valid JSON back', async () => {
    const log = vi.fn();
    const cut = '{"segments":[{"lang":"ja","text":"学校に行きました","gloss":"去了學校"},{"lang":"ja","text":"楽しか';
    const out = await fixReplyJson(cut, { log });
    const j = JSON.parse(out.json) as { segments: { text: string }[]; tip: string };
    expect(j.segments.map((s) => s.text)).toEqual(['学校[がっこう]に行[い]きました', '楽[たの]しか']);
    expect(j.tip).toBe('');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('cut'));
  });

  it('a reply cut inside the tip keeps the segments and the tip so far', async () => {
    const cut = '{"segments":[{"lang":"ja","text":"はい","gloss":"好"}],"tip":"要說 ';
    const j = JSON.parse((await fixReplyJson(cut)).json) as { segments: unknown[]; tip: string };
    expect(j.segments).toHaveLength(1);
    expect(j.tip).toBe('要說');
  });
});

describe('needsTipRewrite', () => {
  it('a Chinese explanation quoting Japanese in 「」 is not rewritten', async () => {
    const { needsTipRewrite } = await import('../../../server/replyFix');
    expect(needsTipRewrite('你說「私は台湾人です」很好，自然又清楚。另外「ゲームに行って」要改成「ゲームの世界に行って」比較自然。')).toBe(false);
    expect(needsTipRewrite('你剛才的句子「朝ご飯はいつも朝ご飯のが食べます店手」有點亂掉，可以說 <ja>朝[あさ]ごはん</ja>。')).toBe(false);
  });
  it('a tip written in Japanese is rewritten', async () => {
    const { needsTipRewrite } = await import('../../../server/replyFix');
    expect(needsTipRewrite('「数が好き」の「数」だけだと意味があいまいです。「数字」か「数学」と言うと伝わります。')).toBe(true);
  });
  it('a Chinese tip with its Japanese already in <ja> is left alone', async () => {
    const { needsTipRewrite } = await import('../../../server/replyFix');
    expect(needsTipRewrite('要說 <ja>学校[がっこう]に行[い]きました</ja>，去哪裡要用「に」喔。')).toBe(false);
  });
  it('isChineseTip is unchanged for a wrapped Chinese tip', () => {
    expect(isChineseTip(wrapJapanese('注意這句要說 学校に行きました，去哪裡要用に才對。'))).toBe(true);
  });
});
