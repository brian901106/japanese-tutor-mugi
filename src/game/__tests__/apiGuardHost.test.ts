import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkApiRequest, guardApi, guardOptionsFrom, hostAllowed, hostNameOf } from '../../../server/apiGuard.ts';

const json = { 'content-type': 'application/json' };
// every request here comes over a loopback socket (this PC); a LAN socket is tested in host-origin-guard.test.ts
const LOOP = { socket: { remoteAddress: '127.0.0.1' } };

describe('Host header: host name without the port', () => {
  it('strips the port from names, bracketed IPv6 and bare IPv6', () => {
    expect(hostNameOf('localhost:3004')).toBe('localhost');
    expect(hostNameOf('LocalHost')).toBe('localhost');
    expect(hostNameOf('[::1]:3004')).toBe('[::1]');
    expect(hostNameOf('[::1]')).toBe('[::1]');
    expect(hostNameOf('::1')).toBe('::1');
    expect(hostNameOf('192.168.1.5:3004')).toBe('192.168.1.5');
  });

  it('is null for a value that is not a host', () => {
    expect(hostNameOf('')).toBeNull();
    expect(hostNameOf('   ')).toBeNull();
    expect(hostNameOf(':3004')).toBeNull();
    expect(hostNameOf('localhost:http')).toBeNull();
    expect(hostNameOf('[::1')).toBeNull();
    expect(hostNameOf('localhost:3004:3004')).toBeNull();
  });
});

describe('Host allowlist: which names may reach the API', () => {
  it('always accepts localhost, 127.0.0.1 and the IPv6 loopback', () => {
    expect(hostAllowed('localhost')).toBe(true);
    expect(hostAllowed('127.0.0.1')).toBe(true);
    expect(hostAllowed('[::1]')).toBe(true);
    expect(hostAllowed('::1')).toBe(true);
  });

  it('refuses a foreign name and a name that only looks like localhost', () => {
    expect(hostAllowed('rebind.example')).toBe(false);
    expect(hostAllowed('localhost.evil.example')).toBe(false);
    expect(hostAllowed('evil-localhost')).toBe(false);
    expect(hostAllowed('foo.localhost')).toBe(false);
  });

  it('accepts a name listed exactly, and a leading dot covers subdomains (the Tailscale name of the PC)', () => {
    const opts = { allowedHosts: ['.example.ts.net', 'mypc.local'] };
    expect(hostAllowed('pc.example.ts.net', opts)).toBe(true);
    expect(hostAllowed('deep.pc.example.ts.net', opts)).toBe(true);
    expect(hostAllowed('example.ts.net', opts)).toBe(true);
    expect(hostAllowed('mypc.local', opts)).toBe(true);
    expect(hostAllowed('other.local', opts)).toBe(false);
  });

  it('a suffix match is on whole labels: a look-alike or a name that ends in the suffix from outside is refused', () => {
    const opts = { allowedHosts: ['.example.ts.net'] };
    expect(hostAllowed('evilexample.ts.net', opts)).toBe(false);
    expect(hostAllowed('pc.example.ts.net.evil.example', opts)).toBe(false);
    expect(hostAllowed('pc.example.ts.net', { allowedHosts: ['example.ts.net'] })).toBe(false); // no dot: exact name only
  });

  it('an IP address is refused unless MUGI_LAN is on (lan)', () => {
    expect(hostAllowed('192.168.1.5')).toBe(false);
    expect(hostAllowed('[fe80::1]')).toBe(false);
    expect(hostAllowed('192.168.1.5', { lan: false })).toBe(false);
    expect(hostAllowed('192.168.1.5', { lan: true })).toBe(true);
    expect(hostAllowed('[fe80::1]', { lan: true })).toBe(true);
    expect(hostAllowed('fe80::1', { lan: true })).toBe(true);
    expect(hostAllowed('rebind.example', { lan: true })).toBe(false);
  });
});

describe('checkApiRequest with the Host rule', () => {
  it('refuses a request whose Host is foreign, even with no Origin and a GET (the DNS-rebinding case)', () => {
    expect(checkApiRequest({ ...LOOP, method: 'GET', headers: { host: 'rebind.example:3110' } })).toMatchObject({ ok: false, status: 403 });
    expect(checkApiRequest({ ...LOOP, method: 'POST', headers: { host: 'rebind.example:3110', ...json } })).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses a request with no Host header', () => {
    expect(checkApiRequest({ ...LOOP, method: 'GET', headers: {} })).toMatchObject({ ok: false, status: 403 });
  });

  it('accepts the Tailscale name only when it is in the allowlist', () => {
    const req = { ...LOOP, method: 'POST', headers: { host: 'pc.example.ts.net', origin: 'https://pc.example.ts.net', ...json } };
    expect(checkApiRequest(req)).toMatchObject({ ok: false, status: 403 });
    expect(checkApiRequest(req, { allowedHosts: ['.example.ts.net'] })).toEqual({ ok: true });
  });

  it('refuses an IP Host when MUGI_LAN is off, and lets it through when on', () => {
    const req = { ...LOOP, method: 'GET', headers: { host: '192.168.1.5:3004' } };
    expect(checkApiRequest(req)).toMatchObject({ ok: false, status: 403 });
    expect(checkApiRequest(req, { lan: false })).toMatchObject({ ok: false, status: 403 });
    // a LAN IP Host is let through by the Host rule, and then needs the pairing code (X-Mugi-Pair) as well
    expect(checkApiRequest(req, { lan: true, pairToken: 'a'.repeat(32) })).toMatchObject({ ok: false, status: 403, code: 'pair_required' });
    expect(checkApiRequest({ ...LOOP, method: 'GET', headers: { host: '192.168.1.5:3004', 'x-mugi-pair': 'a'.repeat(32) } }, { lan: true, pairToken: 'a'.repeat(32) })).toEqual({ ok: true });
  });

  it('the Origin rule compares with the Host as sent (an IP Host under MUGI_LAN still needs a matching Origin)', () => {
    const pair = { 'x-mugi-pair': 'tok123' };
    const opts = { lan: true, pairToken: 'tok123' };
    const req = { ...LOOP, method: 'GET', headers: { host: '192.168.1.5:3004', origin: 'http://192.168.1.9:3004', ...pair } };
    expect(checkApiRequest(req, opts)).toMatchObject({ ok: false, status: 403 });
    expect(checkApiRequest({ ...LOOP, method: 'GET', headers: { host: '192.168.1.5:3004', origin: 'http://192.168.1.5:3004', ...pair } }, opts)).toEqual({ ok: true });
  });

  it('keeps the old rules: cross-site is still refused and a POST still needs application/json', () => {
    expect(checkApiRequest({ ...LOOP, method: 'GET', headers: { host: 'localhost:3004', 'sec-fetch-site': 'cross-site' } })).toMatchObject({ ok: false, status: 403 });
    expect(checkApiRequest({ ...LOOP, method: 'POST', headers: { host: 'localhost:3004', 'content-type': 'text/plain' } })).toMatchObject({ ok: false, status: 415 });
  });
});

describe('guardOptionsFrom: reads the Vite server config and MUGI_LAN', () => {
  const saved = process.env.MUGI_LAN;
  afterEach(() => {
    if (saved === undefined) delete process.env.MUGI_LAN;
    else process.env.MUGI_LAN = saved;
    vi.restoreAllMocks();
  });

  it('copies server.allowedHosts; `true` (Vite allows all) adds no names', () => {
    delete process.env.MUGI_LAN;
    const list = guardOptionsFrom({ config: { server: { allowedHosts: ['.example.ts.net'] } } } as never);
    expect(list.allowedHosts).toEqual(['.example.ts.net']);
    expect(list.lan).toBe(false);
    const all = guardOptionsFrom({ config: { server: { allowedHosts: true } } } as never);
    expect(all.allowedHosts).toEqual([]);
  });

  it('lan is true only for MUGI_LAN=1 in the process environment', () => {
    process.env.MUGI_LAN = '1';
    expect(guardOptionsFrom({ config: { server: { allowedHosts: [] } } } as never).lan).toBe(true);
    process.env.MUGI_LAN = '0';
    expect(guardOptionsFrom({ config: { server: { allowedHosts: [] } } } as never).lan).toBe(false);
  });
});

describe('guardApi passes the options to the check', () => {
  it('a route guarded with the allowlist answers a Tailscale name, and refuses it without', () => {
    const handler = vi.fn();
    const writeHead = vi.fn();
    const end = vi.fn();
    const res = { writeHead, end } as unknown as ServerResponse;
    const req = { ...LOOP, method: 'GET', headers: { host: 'pc.example.ts.net' } } as unknown as IncomingMessage;

    guardApi(handler)(req, res);
    expect(handler).not.toHaveBeenCalled();
    expect(writeHead).toHaveBeenCalledWith(403, expect.anything());

    guardApi(handler, { allowedHosts: ['.example.ts.net'] })(req, res);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
