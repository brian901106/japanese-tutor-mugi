// The "trusted for settings" rule: which requests may change the keys, the daily budget, or sign in to ChatGPT.
// A request is trusted when its connection is a loopback socket (the request comes from this PC, or from the Tailscale Serve
// proxy on this PC, which connects from 127.0.0.1) AND its Host names this PC (localhost, 127.0.0.1, [::1] or ::1) or a name
// in server.allowedHosts (the Tailscale Serve name, MUGI_ALLOWED_HOSTS). The Host header alone never makes a request trusted:
// a device on the LAN (MUGI_LAN=1) connects from its own address, so it is refused here whatever Host it sends. A Host that
// is an IP address is refused unless it is a loopback address. The API guard (apiGuard.ts) still applies on top of this; this
// rule is only about who may change a setting.
import { isIP } from 'node:net';
import { hostAllowed, hostNameOf, isLoopbackSocket, type GuardHeaders, type GuardOptions, type SocketLike } from './apiGuard.ts';

export const SETTINGS_REFUSED_MESSAGE = '這個網址不能修改設定：請在電腦上或透過 Tailscale 網址操作。';

const LOOPBACK_IPS = new Set(['127.0.0.1', '[::1]', '::1']);

/** the first Host header value, or null */
function hostOf(headers: GuardHeaders): string | null {
  const v = headers.host;
  const h = Array.isArray(v) ? v[0] : v;
  return typeof h === 'string' ? h : null;
}

/**
 * true when a request may change settings (see the header comment). Pure: no I/O. `req` carries the socket and the headers.
 * `opts` is the guard's own options (apiGuard.ts guardOptionsFrom): its allowedHosts is the list of names; `lan` is ignored here,
 * because MUGI_LAN never makes an IP address or a LAN connection trusted.
 */
export function trustedForSettings(req: SocketLike & { headers: GuardHeaders }, opts: GuardOptions = {}): boolean {
  if (!isLoopbackSocket(req)) return false;
  const host = hostOf(req.headers);
  if (host === null) return false;
  const name = hostNameOf(host);
  if (name === null) return false;
  const bare = name.startsWith('[') && name.endsWith(']') ? name.slice(1, -1) : name;
  if (isIP(bare) !== 0) return LOOPBACK_IPS.has(name);
  return hostAllowed(name, { allowedHosts: opts.allowedHosts });
}
