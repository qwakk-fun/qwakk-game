/**
 * Meta layer settings from the environment (identity, leaderboard, limits).
 *
 *   DATABASE_URL     PostgreSQL URL. Unset: no leaderboard, recordMatch is a no-op.
 *   SESSION_SECRET   HMAC key for session and device tokens, at least 32 characters.
 *                    Required when NODE_ENV=production (the server refuses to start
 *                    without it). Rotating it resets every guest identity.
 *   TURNSTILE_SECRET Cloudflare Turnstile secret. Unset: new guests are not challenged (dev).
 *   TRUST_PROXY      Number of trusted reverse proxies in front of the server (CapRover: 1).
 *                    Unset or 0: the socket address is the client IP and X-Forwarded-For is ignored.
 *   ALLOWED_ORIGINS  Comma-separated browser origins allowed to use /api, matchmaking and
 *                    WebSocket upgrades, for example https://qwakk.fun. Unset: same origin
 *                    only in production (with a loud startup warning), any origin in dev.
 */
export interface MetaConfig {
  production: boolean;
  databaseUrl: string | null;
  sessionSecret: string;
  turnstileSecret: string | null;
  trustProxyHops: number;
  allowedOrigins: string[] | null;
}

export const DEV_SESSION_SECRET = 'qwakk-dev-only-session-secret-never-use-in-production';
export const MIN_SECRET_LENGTH = 32;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MetaConfig {
  const production = env.NODE_ENV === 'production';
  const secret = env.SESSION_SECRET?.trim() ?? '';
  if (secret && secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  if (!secret && production) {
    throw new Error('SESSION_SECRET is required when NODE_ENV=production (see deploy/server/.env.example)');
  }
  const hops = Number(env.TRUST_PROXY ?? 0);
  const origins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return {
    production,
    databaseUrl: env.DATABASE_URL?.trim() || null,
    sessionSecret: secret || DEV_SESSION_SECRET,
    turnstileSecret: env.TURNSTILE_SECRET?.trim() || null,
    trustProxyHops: Number.isInteger(hops) && hops > 0 ? Math.min(hops, 5) : 0,
    allowedOrigins: origins.length > 0 ? origins : null,
  };
}
