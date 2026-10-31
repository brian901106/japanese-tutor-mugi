// OpenAI's official OAuth (the ChatGPT sign-in of this app; no API key): PKCE, the discovery document of https://auth.openai.com,
// the authorization URL, the code exchange, refresh, the id_token check (jose) and revocation. The first sign-in registers
// the app as a dynamic client (client_id `dynamic_agent_client`); the callback names the real client_id, which is then kept.
// Ported from the author's own MIT project (see NOTICE.md); the endpoints and scopes are OpenAI's.
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export const ISSUER = 'https://auth.openai.com';
export const RESOURCE = 'https://api.openai.com/v1';
export const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
/** the scope that lets the app use the ChatGPT plan (without it the account is signed in but cannot be used) */
export const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
/** the client id of a first sign-in, before the server has a registered one */
export const DYNAMIC_CLIENT = 'dynamic_agent_client';
/** the name OpenAI shows on the consent page */
export const AGENT_NAME = 'Mugi Tutor Local';
/** a sign-in must come back within this long */
export const TRANSACTION_TTL_MS = 600_000;

export type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** One sign-in in progress: the PKCE verifier and the state and nonce that the callback must echo. */
export type Transaction = {
  clientId: string | undefined;
  redirectUri: string;
  verifier: string;
  state: string;
  nonce: string;
  challenge: string;
  expiresAt: number;
};

export type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  scope?: string;
  [key: string]: unknown;
};

/** The account fields the authorization URL and the revocation use (the stored account, see credentials.ts). */
export type AccountRef = {
  client_id: string;
  refresh_token?: string;
  id_token?: string;
  email?: string;
};

export type Identity = { sub: string; email?: string; name?: string; nonce?: string; [key: string]: unknown };

export type JwksSource = Parameters<typeof jwtVerify>[1];

/** a URL-safe random string of 32 bytes */
export const random = (): string => randomBytes(32).toString('base64url');

/** a new sign-in: the verifier is 64 random bytes; the challenge is its S256 hash (PKCE) */
export function createTransaction(clientId: string | undefined, redirectUri: string, now = Date.now()): Transaction {
  const verifier = randomBytes(64).toString('base64url');
  return {
    clientId,
    redirectUri,
    verifier,
    state: random(),
    nonce: random(),
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    expiresAt: now + TRANSACTION_TTL_MS,
  };
}

/** Checks the id_token: issuer, audience (the client), required claims, and the nonce of this sign-in. Throws a Chinese message. */
export async function verifyIdentity(token: string, clientId: string, nonce: string, jwks: JwksSource): Promise<Identity> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: ISSUER, audience: clientId, requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5,
  });
  if (!payload.sub || payload.nonce !== nonce) throw new Error('登入身分驗證失敗，請重新登入。');
  return payload as Identity;
}

export type OAuthError = Error & { code?: string };

/**
 * The OAuth client. `keys`: the key set that checks the id_token (tests pass a local one); by default the set OpenAI publishes
 * (jwks_uri of the discovery document).
 */
export function createOAuth(fetcher: Fetcher = fetch, opts: { keys?: JwksSource } = {}) {
  let discoveryPromise: Promise<Record<string, string>> | null = null;
  let jwks: JwksSource | null = opts.keys ?? null;

  async function discovery(): Promise<Record<string, string>> {
    if (!discoveryPromise) {
      discoveryPromise = (async () => {
        const response = await fetcher(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error('無法讀取 OpenAI 登入設定。');
        const config = (await response.json()) as Record<string, string>;
        if (config.issuer !== ISSUER) throw new Error('OpenAI 登入設定的 issuer 不符。');
        for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
          if (new URL(config[key]).origin !== ISSUER) throw new Error('OpenAI 登入端點不符。');
        }
        return config;
      })().catch((error: unknown) => {
        discoveryPromise = null;
        throw error;
      });
    }
    return discoveryPromise;
  }

  async function token(fields: Record<string, string>): Promise<TokenResponse> {
    const config = await discovery();
    const response = await fetcher(config.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: unknown };
      const error = new Error(`OpenAI 登入失敗（HTTP ${response.status}）；請重新授權。`) as OAuthError;
      error.code = typeof body.error === 'string' ? body.error : undefined;
      throw error;
    }
    return (await response.json()) as TokenResponse;
  }

  return {
    /** the URL the browser opens: the consent page with this sign-in's state, PKCE challenge and nonce */
    async authorization(transaction: Transaction, hostId: string, account?: AccountRef | null): Promise<string> {
      const config = await discovery();
      const url = new URL(config.authorization_endpoint);
      url.search = new URLSearchParams({
        client_id: transaction.clientId || DYNAMIC_CLIENT,
        redirect_uri: transaction.redirectUri,
        response_type: 'code',
        scope: SCOPES,
        resource: RESOURCE,
        ext_agent_host_id: hostId,
        state: transaction.state,
        nonce: transaction.nonce,
        code_challenge_method: 'S256',
        code_challenge: transaction.challenge,
        ...(account
          ? {
            ...(account.id_token ? { id_token_hint: account.id_token } : {}),
            ...(account.email ? { login_hint: account.email } : {}),
          }
          : { agent_name_hint: AGENT_NAME }),
      }).toString();
      return url.toString();
    },
    exchange: (code: string, clientId: string, transaction: Transaction) => token({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: transaction.redirectUri,
      code_verifier: transaction.verifier,
      resource: RESOURCE,
    }),
    refresh: (account: AccountRef & { refresh_token: string }) => token({
      grant_type: 'refresh_token',
      client_id: account.client_id,
      refresh_token: account.refresh_token,
      resource: RESOURCE,
    }),
    async verify(idToken: string, clientId: string, nonce: string): Promise<Identity> {
      const config = await discovery();
      jwks ||= createRemoteJWKSet(new URL(config.jwks_uri));
      return verifyIdentity(idToken, clientId, nonce, jwks);
    },
    /** best effort: true when OpenAI confirmed the revocation (or there was nothing to revoke) */
    async revoke(account: AccountRef): Promise<boolean> {
      if (!account.refresh_token) return true;
      const config = await discovery();
      if (!config.revocation_endpoint || new URL(config.revocation_endpoint).origin !== ISSUER) return false;
      const response = await fetcher(config.revocation_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: account.refresh_token, token_type_hint: 'refresh_token', client_id: account.client_id }),
        signal: AbortSignal.timeout(15000),
      });
      return response.status === 200;
    },
  };
}

export type OAuth = ReturnType<typeof createOAuth>;
