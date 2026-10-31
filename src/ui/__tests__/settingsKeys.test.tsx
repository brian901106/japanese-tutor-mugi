// @vitest-environment jsdom
// Settings › 金鑰 and 每日預算上限 (SettingsSections): the key boxes (password type, last four only), saving and clearing through
// /api/settings/keys, the read-only key status a phone sees (no boxes away from 127.0.0.1), and the budget line's numbers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AiServiceSection, BudgetSection, CloudKeysSection, KeyField, keyStatusText } from '../SettingsSections';
import type { ChatGptStatus } from '../../game/openaiStatus';
import { budgetLine, sentenceCounts } from '../../game/budgetEstimate';

function render(node: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

/** a fetch stub: keyed by "METHOD /path" (or the path alone for a GET); every call is recorded */
function mockFetch(routes: Record<string, (body: unknown) => { status?: number; json: unknown }>) {
  const fn = vi.fn(async (input: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const handler = routes[`${method} ${input}`] ?? routes[input];
    if (!handler) return new Response('{}', { status: 404 });
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const out = handler(body);
    return new Response(JSON.stringify(out.json), { status: out.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const KEYS_OK = {
  status: {
    anthropicKey: { set: true, last4: 'ab12' },
    anthropicWorkspace: { set: false },
    googleKey: { set: false },
    azureKey: { set: false },
    azureRegion: { set: false },
  },
};

/** sets a text box the way a user does (React listens for the input event) */
function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

const button = (host: HTMLElement, label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;

const SIGNED_OUT: ChatGptStatus = { signedIn: false, planEnabled: false, models: [] };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('key boxes', () => {
  it('a key box is a password field with autocomplete off, and its status shows the last four characters only', () => {
    const r = render(<KeyField label="Claude 金鑰" field="anthropicKey" status={{ set: true, last4: 'ab12' }} onSaved={() => {}} />);
    const input = r.host.querySelector('input[aria-label="Claude 金鑰"]') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.autocomplete).toBe('off');
    expect(input.value).toBe('');
    expect(r.host.textContent).toContain('已設定（末四碼 ab12）');
    r.unmount();
  });

  it('the status text: 未設定, 讀取中…, a region in full, and 已設定 for a value of four characters or fewer', () => {
    expect(keyStatusText({ set: false })).toBe('未設定');
    expect(keyStatusText(null)).toBe('讀取中…');
    expect(keyStatusText({ set: true, value: 'eastasia' })).toBe('已設定（eastasia）');
    expect(keyStatusText({ set: true })).toBe('已設定');
  });

  it('儲存 sends the typed value to /api/settings/keys, clears the box, and hands the new status up; the full key is not shown back', async () => {
    const fetchMock = mockFetch({ 'POST /api/settings/keys': () => ({ json: { status: { ...KEYS_OK.status, googleKey: { set: true, last4: 'zz99' } } } }) });
    const onSaved = vi.fn();
    const r = render(<KeyField label="Google 語音金鑰" field="googleKey" status={{ set: false }} onSaved={onSaved} />);
    const input = r.host.querySelector('input[aria-label="Google 語音金鑰"]') as HTMLInputElement;
    act(() => typeInto(input, '  goog-key-zz99  '));
    act(() => button(r.host, '儲存').click());
    await flush();
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/settings/keys');
    expect(call).toBeDefined();
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ googleKey: 'goog-key-zz99' });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ googleKey: { set: true, last4: 'zz99' } }));
    expect(input.value).toBe('');
    expect(r.host.textContent).not.toContain('goog-key-zz99');
    r.unmount();
  });

  it('清除 sends null for the key; a refused save shows the server’s message', async () => {
    const fetchMock = mockFetch({
      'POST /api/settings/keys': (body) => (body && (body as Record<string, unknown>).googleKey === null
        ? { json: { status: KEYS_OK.status } }
        : { status: 403, json: { error: 'forbidden', message: '這個網址不能修改設定：請在電腦上或透過 Tailscale 網址操作。' } }),
    });
    const r = render(<KeyField label="Azure 語音金鑰" field="azureKey" status={{ set: true, last4: 'ab12' }} onSaved={() => {}} />);
    act(() => button(r.host, '清除').click());
    await flush();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ azureKey: null });
    r.unmount();

    const refused = render(<KeyField label="Azure 語音金鑰" field="azureKey" status={{ set: false }} onSaved={() => {}} />);
    act(() => typeInto(refused.host.querySelector('input') as HTMLInputElement, 'azure-key-1'));
    act(() => button(refused.host, '儲存').click());
    await flush();
    expect(refused.host.querySelector('[role="alert"]')?.textContent).toBe('這個網址不能修改設定：請在電腦上或透過 Tailscale 網址操作。');
    refused.unmount();
  });

  it('the 金鑰 section lists Google, Azure and the Azure region (a text box), with the note that only the last four show', async () => {
    mockFetch({ 'GET /api/settings/keys': () => ({ json: KEYS_OK }) });
    const r = render(<CloudKeysSection />);
    expect(r.host.querySelector('h3')?.textContent).toBe('金鑰');
    expect((r.host.querySelector('input[aria-label="Google 語音金鑰"]') as HTMLInputElement).type).toBe('password');
    expect((r.host.querySelector('input[aria-label="Azure 語音金鑰"]') as HTMLInputElement).type).toBe('password');
    expect((r.host.querySelector('input[aria-label="Azure 區域"]') as HTMLInputElement).type).toBe('text');
    expect(r.host.textContent).toContain('金鑰會寫進電腦上的 .env.local，畫面只顯示末四碼。');
    await flush();
    r.unmount();
  });

  it('the Claude row has the key box and the optional workspace id', async () => {
    mockFetch({ 'GET /api/settings/keys': () => ({ json: KEYS_OK }) });
    const r = render(<AiServiceSection providers={['anthropic']} openaiModel="" claudeOk chatgpt={SIGNED_OUT} onChange={() => {}} onRefresh={() => {}} localPc />);
    await flush();
    expect((r.host.querySelector('input[aria-label="Claude 金鑰"]') as HTMLInputElement).type).toBe('password');
    expect(r.host.querySelector('input[aria-label="工作區 ID（選填）"]')).not.toBeNull();
    expect(r.host.textContent).toContain('已設定（末四碼 ab12）');
    r.unmount();
  });
});

describe('from a phone: the keys are a status line only', () => {
  it('KeyField away from the PC: the status line, with no box and no 儲存／清除 buttons', () => {
    const r = render(<KeyField label="Azure 語音金鑰" field="azureKey" status={{ set: true, last4: 'ab12' }} onSaved={() => {}} localPc={false} />);
    expect(r.host.textContent).toContain('Azure 語音金鑰');
    expect(r.host.textContent).toContain('已設定（末四碼 ab12）');
    expect(r.host.querySelector('input')).toBeNull();
    expect(r.host.querySelector('button')).toBeNull();
    r.unmount();
  });

  it('the 金鑰 section away from the PC: no password boxes, and the note says the keys are set on the PC', async () => {
    mockFetch({ 'GET /api/settings/keys': () => ({ json: KEYS_OK }) });
    const r = render(<CloudKeysSection localPc={false} />);
    await flush();
    expect(r.host.querySelector('input[aria-label="Google 語音金鑰"]')).toBeNull();
    expect(r.host.querySelector('input[aria-label="Azure 語音金鑰"]')).toBeNull();
    expect(r.host.querySelector('input[aria-label="Azure 區域"]')).toBeNull();
    expect(r.host.querySelector('button')).toBeNull();
    expect(r.host.textContent).toContain('未設定');
    expect(r.host.textContent).toContain('金鑰只能在電腦上設定');
    r.unmount();
  });

  it('the Claude row away from the PC: the key status only, and the workspace id is not a box either', async () => {
    mockFetch({ 'GET /api/settings/keys': () => ({ json: KEYS_OK }) });
    const r = render(<AiServiceSection providers={['anthropic']} openaiModel="" claudeOk chatgpt={SIGNED_OUT} onChange={() => {}} onRefresh={() => {}} localPc={false} />);
    await flush();
    expect(r.host.querySelector('input[aria-label="Claude 金鑰"]')).toBeNull();
    expect(r.host.querySelector('input[aria-label="工作區 ID（選填）"]')).toBeNull();
    expect(r.host.textContent).toContain('已設定（末四碼 ab12）');
    r.unmount();
  });
});

describe('每日預算上限', () => {
  it('shows today’s spending and the sentence counts for the saved budget (2 dollars: 5,865 on Haiku, 146 on Opus)', async () => {
    mockFetch({ 'GET /api/settings/budget': () => ({ json: { usd: 2, spentTodayUsd: 0.31 } }) });
    const r = render(<BudgetSection />);
    await flush();
    expect(r.host.querySelector('input[aria-label="每日預算（美元）"]')).not.toBeNull();
    expect((r.host.querySelector('input[aria-label="每日預算（美元）"]') as HTMLInputElement).value).toBe('2');
    expect(r.host.textContent).toContain('今天已用約 $0.31');
    expect(r.host.textContent).toContain('約 Haiku 5.5 5,865 句／Opus 5.5 146 句（估算）');
    r.unmount();
  });

  it('the line follows the typed amount; 0 says there is no cap; an out-of-range amount disables 儲存', async () => {
    mockFetch({ 'GET /api/settings/budget': () => ({ json: { usd: 2, spentTodayUsd: 0 } }) });
    const r = render(<BudgetSection />);
    await flush();
    const input = r.host.querySelector('input[aria-label="每日預算（美元）"]') as HTMLInputElement;
    act(() => typeInto(input, '1.5'));
    expect(r.host.textContent).toContain(budgetLine(1.5));
    expect(r.host.textContent).toContain('約 Haiku 5.5 4,399 句／Opus 5.5 109 句（估算）');
    act(() => typeInto(input, '0'));
    expect(r.host.textContent).toContain('0 = 不設上限');
    expect(button(r.host, '儲存').disabled).toBe(false);
    act(() => typeInto(input, '101'));
    expect(r.host.textContent).toContain('請輸入 0 到 100 之間、最多兩位小數的金額');
    expect(button(r.host, '儲存').disabled).toBe(true);
    act(() => typeInto(input, '1.234'));
    expect(button(r.host, '儲存').disabled).toBe(true);
    r.unmount();
  });

  it('儲存 sends the budget and shows the stored value on success', async () => {
    const fetchMock = mockFetch({
      'GET /api/settings/budget': () => ({ json: { usd: 2, spentTodayUsd: 0 } }),
      'POST /api/settings/budget': () => ({ json: { usd: 0.25, spentTodayUsd: 0 } }),
    });
    const r = render(<BudgetSection />);
    await flush();
    act(() => typeInto(r.host.querySelector('input[aria-label="每日預算（美元）"]') as HTMLInputElement, '0.25'));
    act(() => button(r.host, '儲存').click());
    await flush();
    expect(JSON.parse(String(fetchMock.mock.calls.find((c) => c[0] === '/api/settings/budget' && c[1]?.method === 'POST')?.[1]?.body))).toEqual({ usd: 0.25 });
    expect(r.host.textContent).toContain('已儲存');
    r.unmount();
  });
});

describe('the sentence counts', () => {
  it('divides the budget by the two measured costs and rounds to whole sentences', () => {
    expect(sentenceCounts(2)).toEqual({ haiku: 5865, opus: 146 });
    expect(sentenceCounts(0.25)).toEqual({ haiku: 733, opus: 18 });
  });
});
