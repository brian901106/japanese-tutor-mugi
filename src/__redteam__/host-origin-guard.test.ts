// Red-team: Host / Origin / Sec-Fetch-Site / Content-Type rules (server/apiGuard.ts), the settings trust rule
// (server/settingsAccess.ts) and the local-only rule of the OAuth routes (server/openai/routes.ts). Pure functions, no I/O.
// A test named "[發現]" asserts the weakness as it is today (it passes while the weakness is present).
import { describe, expect, it } from 'vitest';
import { checkApiRequest, hostNameOf, isLoopbackSocket } from '../../server/apiGuard.ts';
import { trustedForSettings } from '../../server/settingsAccess.ts';
import { isLocalRequest, localPort } from '../../server/openai/routes.ts';

// every request here comes over a loopback socket (this PC, or the Tailscale Serve proxy on it); the socket cases are at the end
const LOOP = { socket: { remoteAddress: '127.0.0.1' } };
const post = (headers: Record<string, string>) => ({ ...LOOP, method: 'POST', headers: { 'content-type': 'application/json', ...headers } });
const trusted = (headers: Record<string, string>, opts?: { allowedHosts?: string[]; lan?: boolean }) => trustedForSettings({ ...LOOP, headers }, opts);
const lp = (headers: Record<string, string>) => localPort({ ...LOOP, headers });
const isLocal = (headers: Record<string, string>) => isLocalRequest({ ...LOOP, headers });

describe('Host 規則：DNS rebinding、IP、奇怪的 Host 一律拒絕', () => {
  it.each([
    'evil.com',
    '127.0.0.1.evil.com',
    'localhost.evil.com',
    'evil.com@127.0.0.1:3110',
    '192.168.1.10:3110',
    '0.0.0.0:3110',
    '[fe80::1]:3110',
    'localhost.:3110',
    'localhost:3110 evil.com',
    'localhost:abc',
    '',
  ])('拒絕 Host %j', (host) => {
    expect(checkApiRequest({ ...LOOP, method: 'GET', headers: { host } }).ok).toBe(false);
  });

  it('拒絕沒有 Host 標頭（403）', () => {
    expect(checkApiRequest({ ...LOOP, method: 'GET', headers: {} })).toMatchObject({ ok: false, status: 403 });
  });

  it.each(['localhost:3110', 'LOCALHOST:3110', '127.0.0.1:3110', '[::1]:3110', '::1'])('接受 Host %s', (host) => {
    expect(checkApiRequest({ ...LOOP, method: 'GET', headers: { host } })).toEqual({ ok: true });
  });

  it('X-Forwarded-Host 不被信任：Host 合法時仍通過，偽造的 X-Forwarded-Host 不會被採用', () => {
    expect(checkApiRequest({ ...LOOP, method: 'GET', headers: { host: 'localhost:3110', 'x-forwarded-host': 'evil.com' } })).toEqual({ ok: true });
    expect(checkApiRequest({ ...LOOP, method: 'GET', headers: { host: 'evil.com', 'x-forwarded-host': 'localhost:3110' } }).ok).toBe(false);
  });

  it('[已修] 連接埠必須是 1 到 65535 的數字：99999、0 與非數字的連接埠都拒絕', () => {
    expect(checkApiRequest({ ...LOOP, method: 'GET', headers: { host: '127.0.0.1:99999' } }).ok).toBe(false);
    expect(checkApiRequest({ ...LOOP, method: 'GET', headers: { host: '127.0.0.1:0' } }).ok).toBe(false);
    expect(checkApiRequest({ ...LOOP, method: 'GET', headers: { host: 'localhost:' } }).ok).toBe(false);
    expect(checkApiRequest({ ...LOOP, method: 'GET', headers: { host: '127.0.0.1:65535' } })).toEqual({ ok: true });
    expect(hostNameOf('127.0.0.1:99999')).toBe('127.0.0.1');
  });
});

describe('Origin 與 Sec-Fetch-Site', () => {
  it('同源 Origin 通過；Origin 的 host 與 Host 不同（null、不同連接埠、不同名稱）就拒絕', () => {
    expect(checkApiRequest(post({ host: 'localhost:3110', origin: 'http://localhost:3110' }))).toEqual({ ok: true });
    expect(checkApiRequest(post({ host: 'localhost:3110', origin: 'null' })).ok).toBe(false);
    expect(checkApiRequest(post({ host: 'localhost:3110', origin: 'http://localhost:5173' })).ok).toBe(false);
    expect(checkApiRequest(post({ host: 'localhost:3110', origin: 'http://127.0.0.1:3110' })).ok).toBe(false);
    expect(checkApiRequest(post({ host: 'localhost:3110', origin: 'https://localhost:3110.evil.com' })).ok).toBe(false);
  });

  it('Sec-Fetch-Site: cross-site 一律拒絕（GET 與 POST）', () => {
    expect(checkApiRequest({ ...LOOP, method: 'GET', headers: { host: 'localhost:3110', 'sec-fetch-site': 'cross-site' } }).ok).toBe(false);
    expect(checkApiRequest(post({ host: 'localhost:3110', 'sec-fetch-site': 'cross-site' })).ok).toBe(false);
  });

  it('[已修] Sec-Fetch-Site: same-site 拒絕（只接受 same-origin 或 none，或沒有這個標頭）', () => {
    expect(checkApiRequest(post({ host: 'localhost:3110', 'sec-fetch-site': 'same-site' })).ok).toBe(false);
    expect(checkApiRequest(post({ host: 'localhost:3110', 'sec-fetch-site': 'same-origin' })).ok).toBe(true);
    expect(checkApiRequest(post({ host: 'localhost:3110', 'sec-fetch-site': 'none' })).ok).toBe(true);
  });

  it('[已修] Origin 的通訊協定必須是 http 或 https：https://localhost:3110 通過（Tailscale Serve），ftp 拒絕', () => {
    expect(checkApiRequest(post({ host: 'localhost:3110', origin: 'https://localhost:3110' })).ok).toBe(true);
    expect(checkApiRequest(post({ host: 'localhost:3110', origin: 'ftp://localhost:3110' })).ok).toBe(false);
  });

  it('[已修] 沒有 Origin 與 Sec-Fetch-Site 的 POST 仍要 application/json；json-seq 拒絕（415），charset 參數可以', () => {
    expect(checkApiRequest({ ...LOOP, method: 'POST', headers: { host: 'localhost:3110', 'content-type': 'application/json' } })).toEqual({ ok: true });
    expect(checkApiRequest({ ...LOOP, method: 'POST', headers: { host: 'localhost:3110', 'content-type': 'application/json; charset=utf-8' } })).toEqual({ ok: true });
    expect(checkApiRequest({ ...LOOP, method: 'POST', headers: { host: 'localhost:3110', 'content-type': 'application/json-seq' } })).toMatchObject({ status: 415 });
  });
});

describe('Content-Type：CSRF 用的表單與 text/plain 一律 415', () => {
  it.each([
    'text/plain',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
    'text/plain;charset=UTF-8',
  ])('POST 的 Content-Type %s → 415', (ct) => {
    expect(checkApiRequest(post({ host: 'localhost:3110', 'content-type': ct }))).toMatchObject({ ok: false, status: 415 });
  });

  it('PUT/DELETE 也檢查；GET 不檢查', () => {
    expect(checkApiRequest({ ...LOOP, method: 'DELETE', headers: { host: 'localhost:3110' } })).toMatchObject({ status: 415 });
    expect(checkApiRequest({ ...LOOP, method: 'GET', headers: { host: 'localhost:3110', 'content-type': 'text/plain' } })).toEqual({ ok: true });
  });
});

describe('MUGI_LAN=1 時的區網存取（guard 層）', () => {
  it('[已修·高（MUGI_LAN=1）] 區網 IP 當 Host 的 POST /api/chat 沒有配對碼就被拒絕（pair_required）；帶正確的 X-Mugi-Pair 才通過', () => {
    // a LAN client (curl, a script, a phone app) sends no browser headers: the pairing code is what stops it
    const r = checkApiRequest(post({ host: '192.168.1.50:3110' }), { lan: true, pairToken: 'k'.repeat(32) });
    expect(r).toMatchObject({ ok: false, status: 403, code: 'pair_required' });
    const ok = checkApiRequest(post({ host: '192.168.1.50:3110', 'x-mugi-pair': 'k'.repeat(32) }), { lan: true, pairToken: 'k'.repeat(32) });
    expect(ok).toEqual({ ok: true });
    const wrong = checkApiRequest(post({ host: '192.168.1.50:3110', 'x-mugi-pair': 'x'.repeat(32) }), { lan: true, pairToken: 'k'.repeat(32) });
    expect(wrong).toMatchObject({ ok: false, status: 403 });
  });

  it('同一個請求在 MUGI_LAN 關閉（預設）時被拒絕', () => {
    expect(checkApiRequest(post({ host: '192.168.1.50:3110' }), { lan: false }).ok).toBe(false);
  });
});

describe('設定的信任規則（trustedForSettings）', () => {
  it('本機名稱與回送位址可以改設定', () => {
    expect(trusted({ host: 'localhost:3110' })).toBe(true);
    expect(trusted({ host: '127.0.0.1:3110' })).toBe(true);
    expect(trusted({ host: '[::1]:3110' })).toBe(true);
  });

  it('IP 位址（非回送）不能改設定，即使 MUGI_LAN（lan:true）開著', () => {
    expect(trusted({ host: '192.168.1.10:3110' }, { lan: true })).toBe(false);
    expect(trusted({ host: '[fe80::1]:3110' }, { lan: true })).toBe(false);
  });

  it('偽造的 Host 或沒有 Host 不能改設定；Tailscale 標頭不會改變信任', () => {
    expect(trusted({ host: 'evil.com' })).toBe(false);
    expect(trusted({ host: '127.0.0.1.evil.com' })).toBe(false);
    expect(trusted({})).toBe(false);
    expect(trusted({ host: 'evil.com', 'tailscale-user-login': 'me@x' })).toBe(false);
  });

  it('allowedHosts 的 ".ts.net" 只涵蓋該網域的子網域，不涵蓋 ts.net.attacker.com', () => {
    const opts = { allowedHosts: ['.ts.net'] };
    expect(trusted({ host: 'my-pc.tailnet.ts.net' }, opts)).toBe(true);
    expect(trusted({ host: 'ts.net.attacker.com' }, opts)).toBe(false);
    expect(trusted({ host: 'evilts.net' }, opts)).toBe(false);
  });
});

describe('OAuth 路由的本機規則（localPort / isLocalRequest）', () => {
  it('只有 127.0.0.1:<port> 與 localhost:<port> 算本機；代理標頭一出現就不是本機', () => {
    expect(lp({ host: '127.0.0.1:3110' })).toBe(3110);
    expect(lp({ host: 'localhost:3110' })).toBe(3110);
    expect(lp({ host: '127.0.0.1.evil.com:3110' })).toBeNull();
    expect(lp({ host: '[::1]:3110' })).toBeNull();
    expect(lp({ host: '127.0.0.1:3110', 'x-forwarded-for': '1.2.3.4' })).toBeNull();
    expect(lp({ host: '127.0.0.1:3110', 'tailscale-user-login': 'a@b' })).toBeNull();
    expect(lp({ host: '127.0.0.1:3110', 'x-forwarded-host': 'evil.com' })).toBeNull();
    expect(isLocal({ host: 'evil.com' })).toBe(false);
  });
});

// The socket decides "local" and "trusted" (the Host header alone never does). A LAN device reaches the server from its own
// address, so it has a non-loopback socket: whatever Host it sends (127.0.0.1 included), it is not local and not trusted.
describe('[已修·高] 連線位址（socket）決定本機與信任，Host 不能偽造', () => {
  const LAN = { socket: { remoteAddress: '192.168.1.50' } };
  const lanPost = (headers: Record<string, string>) => ({ ...LAN, method: 'POST', headers: { 'content-type': 'application/json', ...headers } });
  const PAIR = 'p'.repeat(32);
  const lanOpts = { lan: true, pairToken: PAIR };

  it('非回送連線 + Host 127.0.0.1 沒有配對碼 → pair_required；有正確配對碼才進得去（仍不是本機）', () => {
    expect(checkApiRequest({ ...LAN, method: 'GET', headers: { host: '127.0.0.1:3110' } }, lanOpts)).toMatchObject({ ok: false, code: 'pair_required' });
    expect(checkApiRequest(lanPost({ host: '127.0.0.1:3110' }), lanOpts)).toMatchObject({ ok: false, code: 'pair_required' });
    expect(checkApiRequest(lanPost({ host: '127.0.0.1:3110', 'x-mugi-pair': PAIR }), lanOpts)).toEqual({ ok: true });
  });

  it('非回送連線即使有配對碼，也不能改金鑰、預算，不能登入或登出 ChatGPT（localPort / isLocalRequest 為否）', () => {
    expect(localPort({ ...LAN, headers: { host: '127.0.0.1:3110' } })).toBeNull();
    expect(isLocalRequest({ ...LAN, headers: { host: '127.0.0.1:3110' } })).toBe(false);
    expect(trustedForSettings({ ...LAN, headers: { host: '127.0.0.1:3110' } }, lanOpts)).toBe(false);
    expect(trustedForSettings({ ...LAN, headers: { host: 'mypc.tailnet.ts.net:3110' } }, { allowedHosts: ['mypc.tailnet.ts.net'], lan: true })).toBe(false);
  });

  it('沒有 socket（無法判斷來源）不算回送：不是本機，也不受信任', () => {
    expect(trustedForSettings({ headers: { host: '127.0.0.1:3110' } })).toBe(false);
    expect(localPort({ headers: { host: '127.0.0.1:3110' } })).toBeNull();
  });

  it('回送連線 + Tailscale 名稱 + 代理標頭：受信任，但不是本機（看狀態不會露出 e-mail，也不能登入）', () => {
    const tsReq = { ...LOOP, headers: { host: 'mypc.tailnet.ts.net:3110', 'tailscale-user-login': 'me@x' } };
    expect(trustedForSettings(tsReq, { allowedHosts: ['mypc.tailnet.ts.net'] })).toBe(true);
    expect(localPort(tsReq)).toBeNull();
    expect(isLocalRequest(tsReq)).toBe(false);
  });

  it('回送連線 + 127.0.0.1 Host、沒有代理標頭：本機也受信任', () => {
    const local = { ...LOOP, headers: { host: '127.0.0.1:3110' } };
    expect(localPort(local)).toBe(3110);
    expect(isLocalRequest(local)).toBe(true);
    expect(trustedForSettings(local)).toBe(true);
  });

  it('::ffff:127.0.0.1 與 ::1 的連線也算回送', () => {
    expect(isLoopbackSocket({ socket: { remoteAddress: '::ffff:127.0.0.1' } })).toBe(true);
    expect(isLoopbackSocket({ socket: { remoteAddress: '::1' } })).toBe(true);
    expect(isLoopbackSocket({ socket: { remoteAddress: '::ffff:192.168.1.50' } })).toBe(false);
  });
});
