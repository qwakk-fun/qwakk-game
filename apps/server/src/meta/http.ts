/**
 * HTTP routes of the meta layer, as a plain Node handler (mounted on the
 * Colyseus Express app in index.ts, or on a bare http.Server in tests).
 *
 *   GET  /health            200 when the process answers (no database hit)
 *   POST /api/session       { name, deviceToken?, turnstileToken? } -> session
 *   GET  /api/leaderboard   ?season=&sort=&mode=  top 100, cached 30 s
 *   GET  /api/me            ?season=&mode=  with Authorization: Bearer <session>
 *   GET  /api/status        menu banner, maintenance and the live rules (public)
 *   /api/auth/*, /api/account/*  accounts (accounts/http.ts)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ACCOUNT_PATHS, accountRoute } from './accounts/http.ts';
import { clientIp } from './ip.ts';
import type { ApiResult, MetaService } from './service.ts';

export const MAX_BODY_BYTES = 4096;

type Next = (err?: unknown) => void;

function send(res: ServerResponse, r: ApiResult): void {
  if (res.headersSent) return;
  const body = JSON.stringify(r.body);
  res.statusCode = r.status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!r.headers?.['Cache-Control']) res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(r.headers ?? {})) res.setHeader(k, v);
  res.end(body);
}

class BodyError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(String(status));
    this.status = status;
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const type = String(req.headers['content-type'] ?? '');
  if (!type.toLowerCase().startsWith('application/json')) throw new BodyError(415);
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > MAX_BODY_BYTES) throw new BodyError(413);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new BodyError(413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BodyError(400);
  }
}

/** Sets the CORS headers for an allowed origin; false when the origin is refused. */
function cors(meta: MetaService, req: IncomingMessage, res: ServerResponse): boolean {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  // Colyseus' own request listener runs first and allows every origin; replace its headers.
  for (const h of ['Access-Control-Allow-Origin', 'Access-Control-Allow-Credentials', 'Access-Control-Allow-Methods', 'Access-Control-Allow-Headers', 'Access-Control-Max-Age']) res.removeHeader(h);
  res.setHeader('Vary', 'Origin');
  if (!meta.originAllowed(origin, req.headers.host)) return false;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  return true;
}

export function createMetaHandler(meta: MetaService) {
  return function metaHandler(req: IncomingMessage, res: ServerResponse, next?: Next): void {
    // Express strips the mount path from req.url; originalUrl keeps it.
    const url = new URL((req as { originalUrl?: string }).originalUrl ?? req.url ?? '/', 'http://local');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path !== '/health' && path !== '/api' && !path.startsWith('/api/')) {
      if (next) next();
      else send(res, { status: 404, body: { error: 'not_found' } });
      return;
    }
    if (!cors(meta, req, res)) return send(res, { status: 403, body: { error: 'origin_not_allowed' } });
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    const ip = clientIp(req.socket.remoteAddress, req.headers['x-forwarded-for'], meta.config.trustProxyHops);
    const route = `${req.method} ${path}`;
    const handle = async (): Promise<ApiResult> => {
      switch (route) {
        case 'GET /health':
        case 'HEAD /health':
          return { status: 200, body: { ok: true, db: meta.dbState } };
        case 'POST /api/session':
          return meta.createSession(await readJson(req), ip);
        case 'GET /api/leaderboard':
          return meta.leaderboard(url.searchParams, ip);
        case 'GET /api/me':
          return meta.me(req.headers.authorization, url.searchParams, ip);
        case 'GET /api/status':
          return meta.status(ip);
        default: {
          const r = await accountRoute(meta.accounts, route, url.searchParams, req.headers.authorization, ip, () => readJson(req));
          if (r) return r;
          const known = path === '/health' || ['/api/session', '/api/leaderboard', '/api/me', '/api/status', ...ACCOUNT_PATHS].includes(path);
          return { status: known ? 405 : 404, body: { error: 'not_found' } };
        }
      }
    };
    handle().then(
      (r) => send(res, r),
      (err: unknown) => {
        if (err instanceof BodyError) return send(res, { status: err.status, body: { error: 'bad_request' } });
        console.error('[meta] request failed:', err instanceof Error ? err.message : err);
        send(res, { status: 500, body: { error: 'server_error' } });
      },
    );
  };
}
