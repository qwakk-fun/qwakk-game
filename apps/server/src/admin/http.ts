/**
 * Everything under /admin, as one Node handler (mounted before the client
 * files in index.ts).
 *
 *   panel off (secrets missing)  every /admin path: the same plain 404 as any unknown path
 *   GET  /admin                  logged in: the admin app's shell; else the login page (no script)
 *   POST /admin/login            form: password + 6 digit code; sets the session cookie
 *   POST /admin/logout           ends the session
 *   GET  /admin/assets/*         the admin app's files, logged in only (404 otherwise)
 *   GET|POST /admin/api/*        JSON API (api.ts), logged in only (401 otherwise)
 *
 * Every POST must come from this server's own page: an Origin header with the
 * request's own host (https in production) and, when the browser sends it,
 * Sec-Fetch-Site: same-origin. Never another origin, not even one in
 * ALLOWED_ORIGINS (a page on qwakk.fun is same-site, so the SameSite cookie
 * alone would not stop it). API POSTs must be JSON. Logins are rate limited,
 * locked out after repeated failures (lockout.ts) and checked in constant
 * time; the API is rate limited per address. The password, codes and cookies
 * are never logged.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { clientIp } from '../meta/ip.ts';
import { RateLimiter } from '../meta/rateLimit.ts';
import { ipKey } from '../meta/ip.ts';
import { handleApi, type ApiContext } from './api.ts';
import { AdminAssets } from './assets.ts';
import type { AdminConfig } from './config.ts';
import { LoginLockout } from './lockout.ts';
import { LOGIN_CSP, loginPage, notBuiltPage } from './pages.ts';
import { verifyPassword } from './password.ts';
import { AdminSessions, clearCookie, readCookie, sessionCookie, type AdminSession } from './sessions.ts';
import type { AdminStore } from './store.ts';
import { TotpGuard } from './totp.ts';

export interface AdminDeps {
  config: AdminConfig;
  store: AdminStore;
  trustProxyHops: number;
  overview(): Promise<unknown>;
  clearLeaderboardCache(): void;
  /** Tests: a session table with other lifetimes. */
  sessions?: AdminSessions;
}

type Next = (err?: unknown) => void;
export type AdminHandler = ((req: IncomingMessage, res: ServerResponse, next?: Next) => void) & { sessions?: AdminSessions };

const MAX_JSON_BYTES = 16 * 1024;
const MAX_FORM_BYTES = 4 * 1024;
/** CSP for the admin app: its own files only. */
const APP_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

/** Per-address limits: pages and files, login posts, API calls. */
export const ADMIN_LIMITS = {
  page: { capacity: 60, refillPerSec: 2 },
  login: { capacity: 10, refillPerSec: 1 / 60 },
  api: { capacity: 120, refillPerSec: 5 },
} as const;

/** The same answer as any unknown path (staticClient.ts), so a disabled panel looks like no panel. */
function notFound(res: ServerResponse): void {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end('not found\n');
}

function secure(res: ServerResponse, csp: string): void {
  // Colyseus' own request listener allows every origin; no admin answer may carry those headers.
  for (const h of ['Access-Control-Allow-Origin', 'Access-Control-Allow-Credentials', 'Access-Control-Allow-Methods', 'Access-Control-Allow-Headers', 'Access-Control-Max-Age']) res.removeHeader(h);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  // no-referrer makes Chromium send Origin: null on the login form POST.
  // Keep same-origin form authentication working while hiding cross-origin referrers.
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Security-Policy', csp);
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

function sendHtml(res: ServerResponse, status: number, html: string | Buffer): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
}

function redirect(res: ServerResponse, to: string, cookie?: string): void {
  res.statusCode = 303;
  res.setHeader('Location', to);
  if (cookie) res.setHeader('Set-Cookie', cookie);
  res.end();
}

class BodyError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(String(status));
    this.status = status;
  }
}

async function readBody(req: IncomingMessage, max: number): Promise<string> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > max) throw new BodyError(413);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > max) throw new BodyError(413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Is this POST from our own page? Origin must name the request's host (https
 * in production); Sec-Fetch-Site, when sent, must be same-origin.
 */
export function sameOrigin(req: IncomingMessage, production: boolean): boolean {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (typeof origin !== 'string' || !host) return false;
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin') return false;
  try {
    const u = new URL(origin);
    if (u.host !== host) return false;
    return production ? u.protocol === 'https:' : u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function createAdminHandler(deps: AdminDeps | null): AdminHandler {
  if (!deps) {
    const off: AdminHandler = (_req, res) => notFound(res);
    return off;
  }
  const { config, store } = deps;
  const sessions = deps.sessions ?? new AdminSessions();
  const lockout = new LoginLockout();
  const totp = new TotpGuard(config.totpSecret);
  const assets = new AdminAssets(config.uiDir);
  const limits = { page: new RateLimiter(ADMIN_LIMITS.page), login: new RateLimiter(ADMIN_LIMITS.login), api: new RateLimiter(ADMIN_LIMITS.api) };

  const sessionOf = (req: IncomingMessage): AdminSession | null => sessions.verify(readCookie(req.headers.cookie));

  async function login(req: IncomingMessage, res: ServerResponse, ip: string): Promise<void> {
    const key = ipKey(ip);
    if (!limits.login.take(key) || lockout.retryAfterMs(ip) > 0) {
      console.warn('[admin] login refused: locked out or rate limited');
      return redirect(res, '/admin?e=locked');
    }
    const type = String(req.headers['content-type'] ?? '').toLowerCase();
    if (!type.startsWith('application/x-www-form-urlencoded')) return redirect(res, '/admin?e=bad');
    const form = new URLSearchParams(await readBody(req, MAX_FORM_BYTES));
    const password = form.get('password') ?? '';
    const code = (form.get('code') ?? '').replace(/\s/g, '');
    // The password first (always a full scrypt run), then the code: a code is
    // used up only when the password matched, so a wrong password never burns it.
    const passOk = await verifyPassword(password, config.passwordHash);
    const ok = passOk && totp.use(code);
    if (!ok) {
      lockout.failure(ip);
      console.warn('[admin] login failed');
      return redirect(res, '/admin?e=bad');
    }
    lockout.success(ip);
    const { session, cookie } = sessions.create();
    console.log(`[admin] login ok (${session.actor})`);
    await store.audit(session.actor, 'login', '', null, null);
    redirect(res, '/admin', sessionCookie(cookie, sessions.ttlMs));
  }

  async function api(req: IncomingMessage, res: ServerResponse, route: string, url: URL, session: AdminSession, ip: string): Promise<void> {
    const key = ipKey(ip);
    if (!limits.api.take(key)) return sendJson(res, 429, { error: 'rate_limited' }, { 'Retry-After': String(limits.api.retryAfter(key)) });
    let body: unknown = null;
    if (req.method === 'POST') {
      if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return sendJson(res, 415, { error: 'json_only' });
      try {
        body = JSON.parse((await readBody(req, MAX_JSON_BYTES)) || 'null');
      } catch (err) {
        return sendJson(res, err instanceof BodyError ? err.status : 400, { error: 'bad_request' });
      }
    }
    const ctx: ApiContext = { session, store, overview: deps!.overview, clearLeaderboardCache: deps!.clearLeaderboardCache };
    const r = await handleApi(req.method ?? 'GET', route, url.searchParams, body, ctx);
    sendJson(res, r.status, r.body);
  }

  const handler: AdminHandler = (req, res, next) => {
    const url = new URL((req as { originalUrl?: string }).originalUrl ?? req.url ?? '/', 'http://local');
    const path = url.pathname;
    if (path !== '/admin' && !path.startsWith('/admin/')) {
      if (next) next();
      else notFound(res);
      return;
    }
    const sub = path.slice('/admin'.length) || '/';
    const ip = clientIp(req.socket.remoteAddress, req.headers['x-forwarded-for'], deps.trustProxyHops);
    const method = req.method ?? 'GET';
    const run = async (): Promise<void> => {
      if (method === 'POST') {
        secure(res, LOGIN_CSP);
        if (!sameOrigin(req, config.production)) return sendJson(res, 403, { error: 'origin_not_allowed' });
        if (sub === '/login') return login(req, res, ip);
        const session = sessionOf(req);
        if (sub === '/logout') {
          if (session) {
            sessions.revoke(session.id);
            await store.audit(session.actor, 'logout', '', null, null);
          }
          return redirect(res, '/admin', clearCookie());
        }
        if (!sub.startsWith('/api/')) return notFound(res);
        if (!session) return sendJson(res, 401, { error: 'unauthorized' });
        return api(req, res, sub.slice('/api/'.length), url, session, ip);
      }
      if (method !== 'GET' && method !== 'HEAD') return notFound(res);
      if (sub.startsWith('/api/')) {
        secure(res, APP_CSP);
        const session = sessionOf(req);
        if (!session) return sendJson(res, 401, { error: 'unauthorized' });
        return api(req, res, sub.slice('/api/'.length), url, session, ip);
      }
      const key = ipKey(ip);
      if (!limits.page.take(key)) {
        res.statusCode = 429;
        res.setHeader('Retry-After', String(limits.page.retryAfter(key)));
        return void res.end();
      }
      const session = sessionOf(req);
      if (sub === '/' || sub === '/index.html') {
        if (!session) {
          secure(res, LOGIN_CSP);
          const e = url.searchParams.get('e');
          return sendHtml(res, 200, loginPage(e === 'bad' || e === 'locked' ? e : null));
        }
        const shell = assets.shell();
        if (!shell) {
          secure(res, LOGIN_CSP);
          return sendHtml(res, 200, notBuiltPage());
        }
        secure(res, APP_CSP);
        return sendHtml(res, 200, shell.body);
      }
      const file = session ? assets.asset(sub) : null;
      if (!file) return notFound(res);
      secure(res, APP_CSP);
      res.statusCode = 200;
      res.setHeader('Content-Type', file.type);
      res.setHeader('Content-Length', String(file.body.length));
      res.end(method === 'HEAD' ? undefined : file.body);
    };
    run().catch((err: unknown) => {
      if (err instanceof BodyError) return sendJson(res, err.status, { error: 'bad_request' });
      console.error('[admin] request failed:', err instanceof Error ? err.message : err);
      if (!res.headersSent) sendJson(res, 500, { error: 'server_error' });
    });
  };
  handler.sessions = sessions;
  return handler;
}
