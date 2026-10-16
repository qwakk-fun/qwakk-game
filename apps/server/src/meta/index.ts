/**
 * Meta layer contract for the game rooms: guest identity, per-IP join limits
 * and match recording. Settings come from the environment (see config.ts).
 *
 *   verifySession(token)  identity behind a session token, or null
 *   allowJoin(ip)         per-IP join rate limit (token bucket, in memory)
 *   allowCreateRoom(ip)   per-IP limit on new game rooms (matchmaking.ts)
 *   allowLobby(ip)        per-IP limit on lobby (room list) connections
 *   (guardJoinIps also caps open WebSockets per IP, CONNECTIONS_PER_IP)
 *   recordMatch(result)   write a finished match; no-op without DATABASE_URL, never throws
 *   joinIp(context)       the client IP from a Colyseus AuthContext (TRUST_PROXY aware)
 *
 * The server entry calls `startMeta()` once, mounts `metaHttpHandler`, passes
 * `checkUpgradeOrigin` / `applyMatchmakingCors` to Colyseus and installs
 * `guardJoinIps` on its HTTP server (joinIp depends on it).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { installClientIpGuard, normalizeIp } from './ip.ts';
import { createMetaHandler } from './http.ts';
import { MetaService } from './service.ts';

export type { MatchResult } from './matches.ts';
export type { Identity } from './service.ts';
export { MetaService } from './service.ts';

let instance: MetaService | null = null;

/** The process-wide meta service, created from process.env on first use. */
export function meta(): MetaService {
  instance ??= new MetaService();
  return instance;
}

export async function verifySession(token: string | undefined): Promise<{ playerId: string; name: string; tag: string } | null> {
  return meta().verifySession(token);
}

export async function recordMatch(result: import('./matches.ts').MatchResult): Promise<void> {
  try {
    await meta().recordMatch(result);
  } catch (err) {
    console.error('[meta] recordMatch failed:', err instanceof Error ? err.message : err);
  }
}

export function allowJoin(ip: string): boolean {
  return meta().allowJoin(ip);
}

export function allowCreateRoom(ip: string): boolean {
  return meta().allowCreateRoom(ip);
}

export function allowLobby(ip: string): boolean {
  return meta().allowLobby(ip);
}

/**
 * Client IP for `allowJoin` from a Colyseus 0.18 AuthContext (onAuth's third
 * argument). Colyseus takes `context.ip` from client-controlled headers, so
 * `guardJoinIps` rewrites them on every upgrade request first: then this is
 * the socket address, or with TRUST_PROXY the entry our proxy appended to
 * X-Forwarded-For.
 */
export function joinIp(context: { ip?: string | undefined } | undefined): string {
  return normalizeIp(context?.ip ?? 'unknown');
}

/**
 * Rewrite the client IP headers of WebSocket upgrades and HTTP requests
 * (matchmaking) before Colyseus reads them (see ip.ts), and refuse upgrades
 * over the per-IP open connection cap (429).
 */
export function guardJoinIps(server: HttpServer): void {
  const m = meta();
  installClientIpGuard(server, m.config.trustProxyHops, (ip, socket) => m.admitSocket(ip, socket));
}

/** Connect and migrate the database (never throws; retries in the background). */
export function startMeta(): Promise<void> {
  return meta().start();
}

export function stopMeta(): Promise<void> {
  return instance ? instance.stop() : Promise.resolve();
}

/** Node/Express handler for /health and /api/*; calls next() for anything else. */
export function metaHttpHandler(req: IncomingMessage, res: ServerResponse, next?: (err?: unknown) => void): void {
  handler ??= createMetaHandler(meta());
  handler(req, res, next);
}
let handler: ReturnType<typeof createMetaHandler> | null = null;

/**
 * Colyseus `beforeUpgrade`: the same origin policy as /api (service.originAllowed).
 * ALLOWED_ORIGINS when set; unset in production means same origin only; dev
 * allows any. Clients without an Origin header (bots, benchmarks) are not
 * browsers and pass.
 */
export function checkUpgradeOrigin(request: Request): Response | void {
  const origin = request.headers.get('origin') ?? undefined;
  if (!meta().originAllowed(origin, request.headers.get('host') ?? undefined)) return new Response('origin not allowed', { status: 403 });
}

/**
 * Colyseus' matchmaking CORS (default: echo any origin) follows the same
 * policy. A refused origin gets an origin it does not match, which the
 * browser rejects. Dev without ALLOWED_ORIGINS keeps the Colyseus default.
 */
export function applyMatchmakingCors(controller: { getCorsHeaders: (headers: Headers) => Record<string, string> }): void {
  const m = meta();
  if (!m.config.allowedOrigins && !m.config.production) return;
  if (!m.config.allowedOrigins) {
    console.warn(
      '[meta] ALLOWED_ORIGINS is not set in production: matchmaking, WebSocket upgrades and /api accept only the ' +
        "server's own origin. That is right when this server also serves the client (play.qwakk.fun); a client served " +
        'from another host (qwakk.fun/game) cannot join. Set ALLOWED_ORIGINS to name the origins explicitly.',
    );
  }
  controller.getCorsHeaders = (headers: Headers): Record<string, string> => {
    const origin = headers.get('origin') ?? undefined;
    const host = headers.get('host') ?? undefined;
    if (m.originAllowed(origin, host)) return origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };
    return { 'Access-Control-Allow-Origin': m.config.allowedOrigins?.[0] ?? `https://${host ?? 'invalid'}`, Vary: 'Origin' };
  };
}
