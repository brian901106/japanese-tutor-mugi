// How many sentences a daily budget buys, for the settings line 「約 Haiku 5.5 n 句／Opus 5.5 m 句（估算）」.
// The two constants are the average cost of one sentence of this app, measured from its usage at the prices in the table in
// server/usage.ts (CLAUDE_PRICES). They are estimates: the Anthropic Console is the real bill. Change them only here.
/** USD per sentence on Haiku 5.5 */
export const HAIKU_USD_PER_SENTENCE = 0.000341;
/** USD per sentence on Opus 5.5 */
export const OPUS_USD_PER_SENTENCE = 0.0137;

/** the whole sentences a budget buys on each model (0 for a budget of 0) */
export function sentenceCounts(usd: number): { haiku: number; opus: number } {
  return { haiku: Math.round(usd / HAIKU_USD_PER_SENTENCE), opus: Math.round(usd / OPUS_USD_PER_SENTENCE) };
}

const grouped = new Intl.NumberFormat('en-US');

/** the settings line for a budget; 0 means no cap (server/usage.ts: 0 = no cap), so there is nothing to count */
export function budgetLine(usd: number): string {
  if (!(usd > 0)) return '0 = 不設上限，沒有句數估算';
  const { haiku, opus } = sentenceCounts(usd);
  return `約 Haiku 5.5 ${grouped.format(haiku)} 句／Opus 5.5 ${grouped.format(opus)} 句（估算）`;
}
