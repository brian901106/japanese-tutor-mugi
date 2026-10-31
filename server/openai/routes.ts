// The ChatGPT sign-in routes of the dev server (mounted by claudeChat.ts, before Vite's own middlewares):
//   GET  /api/openai/status  → { signedIn, planEnabled, email?, models }   (email only for a local request)
//   POST /api/openai/login   → { url }     the consent page to open (redirect back to this PC's 127.0.0.1). Local only.
//   POST /api/openai/logout  → { ok, warning? }   local only
//   GET  /auth/callback      → 303 /?chatgpt=ok, or a small page with the error. local only.
// Local only: the connection is a loopback socket (the request comes from this PC, not from a LAN device: the socket's address
// decides it, the Host header does not), the Host is 127.0.0.1:<port> or localhost:<port>, and no proxy header is present
// (Tailscale Serve and other proxies add tailscale-user-login, x-forwarded-for, x-forwarded-host or x-forwarded-proto). A phone
// (Tailscale) may read the status and the model list, but it cannot sign in or out. The OAuth callback is a top-level navigation
// from auth.openai.com, so it is not held to the same-site rule; it is protected by the single-use state, PKCE and the local-only
// rule. No response ever carries a token, a client id or the refresh material.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ChatGptService } from './service.ts';
import { browserHeadersRefusal, hasProxyHeader, isLoopbackSocket, type SocketLike } from '../apiGuard.ts';

export const LOCAL_ONLY_MESSAGE = 'ChatGPT 登入只能在電腦上的 127.0.0.1 網址操作。';
const LOCAL_HOST = /^(127\.0\.0\.1|localhost):(\d{1,5})$/i;
const GENERIC_LOGIN_ERROR = '登入驗證失敗，請重新登入。';

/** the request fields the local rule reads: its socket and its headers */
type LocalReq = SocketLike & { headers: IncomingMessage['headers'] };

/** the port of a local request (loopback socket, 127.0.0.1:<port> or localhost:<port> Host, no proxy header); null when the request is not local */
export function localPort(req: LocalReq): number | null {
  if (!isLoopbackSocket(req)) return null;
  const host = req.headers.host;
  if (typeof host !== 'string') return null;
  if (hasProxyHeader(req.headers)) return null;
  const m = LOCAL_HOST.exec(host.trim());
  if (!m) return null;
  const port = Number(m[2]);
  return port >= 1 && port <= 65535 ? port : null;
}

/** true for a request that comes straight from this PC (see the header comment) */
export function isLocalRequest(req: LocalReq): boolean {
  return localPort(req) !== null;
}

/** the redirect URI of a sign-in started from this PC: 127.0.0.1 on the same port */
export function redirectUriFor(port: number): string {
  return `http://127.0.0.1:${port}/auth/callback`;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** an error message that may be shown: our own Chinese messages; anything else (a network error, a library message) is replaced */
function shownMessage(e: unknown, fallback: string): string {
  const message = e instanceof Error ? e.message : '';
  return /[一-鿿]/.test(message) ? message : fallback;
}

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

function page(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>ChatGPT 登入</title></head><body style="font-family:sans-serif;padding:16px;line-height:1.6">`
    + `<p>${escapeHtml(message)}</p><p><a href="/">回到首頁</a></p></body></html>`);
}

/** the query parameters the callback reads */
export const CALLBACK_PARAMS = ['state', 'code', 'client_id', 'error'] as const;

/** the callback's query from a URL's search parameters */
export function callbackQuery(params: URLSearchParams): Record<string, string | undefined> {
  const query: Record<string, string | undefined> = {};
  for (const key of CALLBACK_PARAMS) query[key] = params.get(key) ?? undefined;
  return query;
}

/**
 * The completion that the callback runs: the single-use state, the PKCE exchange, the id_token check and the save
 * (ChatGptService.finishLogin). Throws a Chinese message; the caller shows its own page.
 */
export async function completeSignIn(service: ChatGptService, query: Record<string, string | undefined>): Promise<void> {
  await service.finishLogin(query);
}

/** The /api/openai routes (already through the API guard). Returns false when the path is not one of them. */
export async function handleOpenAiApi(req: IncomingMessage, res: ServerResponse, service: ChatGptService): Promise<boolean> {
  // defence in depth: the API guard checked the browser headers already; these routes are checked again here
  const browser = browserHeadersRefusal(req.headers);
  if (browser && !browser.ok) {
    json(res, browser.status, { error: 'forbidden', message: browser.message });
    return true;
  }
  const path = (req.url ?? '/').split('?')[0].replace(/\/+$/, '');
  const local = localPort(req);
  if (req.method === 'GET' && path === '/status') {
    json(res, 200, await service.status(local !== null));
    return true;
  }
  if (req.method === 'POST' && path === '/login') {
    if (local === null) {
      json(res, 403, { error: 'forbidden', message: LOCAL_ONLY_MESSAGE });
      return true;
    }
    try {
      const url = await service.beginLogin(redirectUriFor(local));
      json(res, 200, { url });
    } catch (e) {
      json(res, 502, { error: 'upstream', message: shownMessage(e, '無法開啟 ChatGPT 登入頁，請稍後再試。') });
    }
    return true;
  }
  if (req.method === 'POST' && path === '/logout') {
    if (local === null) {
      json(res, 403, { error: 'forbidden', message: LOCAL_ONLY_MESSAGE });
      return true;
    }
    try {
      json(res, 200, await service.logout());
    } catch {
      json(res, 500, { error: 'server', message: '登出失敗，請稍後再試。' });
    }
    return true;
  }
  return false;
}

/** GET /auth/callback: OpenAI sends the browser back here. */
export async function handleAuthCallback(req: IncomingMessage, res: ServerResponse, service: ChatGptService): Promise<void> {
  if (localPort(req) === null) return page(res, 403, LOCAL_ONLY_MESSAGE);
  const query = callbackQuery(new URL(req.url ?? '/', 'http://127.0.0.1').searchParams);
  try {
    await completeSignIn(service, query);
  } catch (e) {
    return page(res, 400, shownMessage(e, GENERIC_LOGIN_ERROR));
  }
  res.writeHead(303, { Location: '/?chatgpt=ok', 'Cache-Control': 'no-store' });
  res.end();
}
