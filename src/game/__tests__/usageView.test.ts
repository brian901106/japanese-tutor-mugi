import { afterEach, describe, expect, it, vi } from 'vitest';
import { barPct, claudeTotalUsd, fetchUsage, fmtInt, fmtMonth, fmtPct, fmtTwd, fmtUsd, monthList, monthOf, type MonthUsage, type UsageData } from '../usageView';

afterEach(() => vi.unstubAllGlobals());

describe('usage formatting', () => {
  it('shows a share of an allowance to one decimal, tiny non-zero shares as <0.1%', () => {
    expect(fmtPct(12_345, 4_000_000)).toBe('0.3%');
    expect(fmtPct(1, 4_000_000)).toBe('<0.1%');
    expect(fmtPct(0, 4_000_000)).toBe('0.0%');
    expect(fmtPct(5, 0)).toBe('');
  });

  it('clamps the bar between 0 and 100', () => {
    expect(barPct(50, 200)).toBe(25);
    expect(barPct(900, 200)).toBe(100);
    expect(barPct(0, 0)).toBe(0);
  });

  it('formats integers with separators and money with a 估算 TWD conversion', () => {
    expect(fmtInt(12_345)).toBe('12,345');
    expect(fmtUsd(1.5)).toBe('US$1.50');
    expect(fmtUsd(0.0123)).toBe('US$0.0123');
    expect(fmtTwd(1)).toBe('NT$32');
    expect(fmtMonth('2026-10')).toBe('2026年10月');
  });
});

describe('month helpers', () => {
  const m = (cost: number): MonthUsage => ({
    tts: { google: {}, azure: {} },
    claude: { 'claude-opus-5-5': { requests: 1, errors: 0, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, costUsd: cost, unpriced: 0 } },
  });
  const d: UsageData = {
    months: { '2026-08': m(1), '2026-10': m(2.5), '2026-09': m(0) },
    current: '2026-10',
    freeTier: { google: {}, azure: {} },
  };

  it('lists months newest first', () => {
    expect(monthList(d)).toEqual(['2026-10', '2026-09', '2026-08']);
  });

  it('returns an empty month for a key with no record, and sums Claude cost', () => {
    expect(monthOf(d, '2025-01')).toEqual({ tts: { google: {}, azure: {} }, claude: {} });
    expect(claudeTotalUsd(d.months['2026-10'])).toBeCloseTo(2.5, 10);
  });
});

describe('fetchUsage', () => {
  it('returns the data for a 200 with the usage shape', async () => {
    const body = { months: { '2026-10': { tts: { google: {}, azure: {} }, claude: {} } }, current: '2026-10', freeTier: { google: {}, azure: {} } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    const r = await fetchUsage();
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.data.current).toBe('2026-10');
  });

  it('treats a 404 (an old dev server without the route) as missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    expect((await fetchUsage()).kind).toBe('missing');
  });

  it('treats an HTML fallback (Vite serving index.html) as missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html>', { status: 200 })));
    expect((await fetchUsage()).kind).toBe('missing');
  });

  it('treats a network failure as an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect((await fetchUsage()).kind).toBe('error');
  });
});
