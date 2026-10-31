// @vitest-environment jsdom
// The pairing code on /api calls (game/apiFetch.ts): sent when stored, asked for on a pair_required refusal, never on other paths.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, onPairNeeded, pairCode, setPairCode, PAIR_HEADER } from '../apiFetch';

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(status: number, body: unknown = {}) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('apiFetch', () => {
  it('sends the stored pairing code in X-Mugi-Pair on every /api call', async () => {
    setPairCode('abc123');
    expect(pairCode()).toBe('abc123');
    const fetchMock = stubFetch(200, { ok: true });
    await apiFetch('/api/chat/status', { method: 'GET' });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)[PAIR_HEADER]).toBe('abc123');
  });

  it('sends no header when no code is stored (the request is unchanged)', async () => {
    const fetchMock = stubFetch(200, { ok: true });
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
    await apiFetch('/api/usage', init);
    expect(fetchMock.mock.calls[0][1]).toBe(init);
  });

  it('a pair_required refusal asks for the code (the banner listener runs), and other refusals do not', async () => {
    const listener = vi.fn();
    const off = onPairNeeded(listener);
    stubFetch(403, { error: 'pair_required', message: '區網連線需要配對碼' });
    await apiFetch('/api/settings/keys');
    expect(listener).toHaveBeenCalledTimes(1);
    stubFetch(403, { error: 'forbidden', message: '不接受其他網站發出的請求' });
    await apiFetch('/api/settings/keys');
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it('forgetting the code removes it from storage', () => {
    setPairCode('x1');
    setPairCode('');
    expect(pairCode()).toBe('');
  });
});
