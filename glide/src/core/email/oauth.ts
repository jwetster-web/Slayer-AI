// OAuth 2.0 for Gmail and Microsoft 365/Outlook using the installed-app
// flow: Authorization Code + PKCE with a loopback redirect. Tokens are used
// for IMAP XOAUTH2, so every provider shares the same read-only sync engine.
// Users register their own OAuth client (see docs/EMAIL_SETUP.md); no client
// credentials ship with the app.

import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';

export type OAuthProvider = 'gmail' | 'outlook';

export interface OAuthClientConfig {
  clientId: string;
  /** Google desktop clients have a (non-confidential) secret; Microsoft public clients do not. */
  clientSecret?: string;
  tenant?: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  email?: string;
  scope?: string;
}

const PROVIDERS = {
  gmail: {
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'https://mail.google.com/ openid email',
    extra: { access_type: 'offline', prompt: 'consent' } as Record<string, string>,
  },
  outlook: {
    auth: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token',
    scope: 'https://outlook.office.com/IMAP.AccessAsUser.All offline_access openid email',
    extra: { prompt: 'select_account' } as Record<string, string>,
  },
};

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function pkcePair() {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthUrl(provider: OAuthProvider, cfg: OAuthClientConfig, redirectUri: string, state: string, challenge: string, loginHint?: string): string {
  const p = PROVIDERS[provider];
  const u = new URL(p.auth.replace('{tenant}', cfg.tenant || 'common'));
  const params: Record<string, string> = {
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: p.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...p.extra,
  };
  if (loginHint) params.login_hint = loginHint;
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

function emailFromIdToken(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
    return (payload.email ?? payload.preferred_username ?? payload.upn)?.toLowerCase();
  } catch {
    return undefined;
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

async function tokenRequest(provider: OAuthProvider, cfg: OAuthClientConfig, body: Record<string, string>, fetcher: FetchLike): Promise<OAuthTokens> {
  const p = PROVIDERS[provider];
  const form = new URLSearchParams({ client_id: cfg.clientId, ...body });
  if (cfg.clientSecret) form.set('client_secret', cfg.clientSecret);
  const res = await fetcher(p.token.replace('{tenant}', cfg.tenant || 'common'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error(`OAuth token error: ${j.error ?? res.status}${j.error_description ? ` — ${String(j.error_description).slice(0, 160)}` : ''}`);
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: Date.now() + (Number(j.expires_in ?? 3600) - 60) * 1000,
    email: emailFromIdToken(j.id_token),
    scope: j.scope,
  };
}

export function exchangeCode(provider: OAuthProvider, cfg: OAuthClientConfig, code: string, verifier: string, redirectUri: string, fetcher: FetchLike = fetch as unknown as FetchLike) {
  return tokenRequest(provider, cfg, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri }, fetcher);
}

export async function refreshTokens(provider: OAuthProvider, cfg: OAuthClientConfig, tokens: OAuthTokens, fetcher: FetchLike = fetch as unknown as FetchLike): Promise<OAuthTokens> {
  if (tokens.expiresAt > Date.now() + 30000) return tokens;
  if (!tokens.refreshToken) throw new Error('OAuth session expired — reconnect the account (invalid_grant)');
  const next = await tokenRequest(provider, cfg, { grant_type: 'refresh_token', refresh_token: tokens.refreshToken }, fetcher);
  return { ...next, refreshToken: next.refreshToken ?? tokens.refreshToken, email: next.email ?? tokens.email };
}

/**
 * Runs the interactive loopback flow: opens the system browser and waits for
 * the redirect on 127.0.0.1. Resolves with tokens or rejects on error/timeout.
 */
export async function runLoopbackFlow(provider: OAuthProvider, cfg: OAuthClientConfig, openBrowser: (url: string) => Promise<void> | void, opts: { timeoutMs?: number; loginHint?: string; fetcher?: FetchLike } = {}): Promise<OAuthTokens> {
  const { verifier, challenge } = pkcePair();
  const state = b64url(randomBytes(16));
  let server: Server | undefined;
  try {
    const code = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      let redirectUri = '';
      server = createServer((req, res) => {
        const u = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (u.pathname !== '/callback') {
          res.writeHead(404).end();
          return;
        }
        const err = u.searchParams.get('error');
        const ok = !err && u.searchParams.get('state') === state && u.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<html><body style="font-family:system-ui;background:#070912;color:#e6e9f5;display:grid;place-items:center;height:100vh"><div><h2>${ok ? 'GLIDE is connected' : 'Connection failed'}</h2><p>You can close this tab and return to GLIDE.</p></div></body></html>`);
        if (ok) resolve({ code: u.searchParams.get('code')!, redirectUri });
        else reject(new Error(err ? `OAuth error: ${err}` : 'OAuth state mismatch'));
      });
      server.listen(0, '127.0.0.1', () => {
        const addr = server!.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        redirectUri = `http://127.0.0.1:${port}/callback`;
        Promise.resolve(openBrowser(buildAuthUrl(provider, cfg, redirectUri, state, challenge, opts.loginHint))).catch(reject);
      });
      setTimeout(() => reject(new Error('OAuth sign-in timed out')), opts.timeoutMs ?? 5 * 60 * 1000);
    });
    return await exchangeCode(provider, cfg, code.code, verifier, code.redirectUri, opts.fetcher);
  } finally {
    server?.close();
  }
}
