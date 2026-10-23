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
 *
 * Account sign-in codes go out by email (accounts/mail.ts):
 *   SMTP_HOST        SMTP server, for example smtp.hostinger.com. Unset: no email is sent;
 *                    in dev and tests a local mail sink prints the code to the server console,
 *                    in production sign-in by email answers 503 (with a startup warning).
 *   SMTP_PORT        465 (implicit TLS, the default) or 587 (STARTTLS).
 *   SMTP_USER        SMTP login (noreply@qwakk.fun).
 *   SMTP_PASS        SMTP password. Secret: server environment only.
 *   MAIL_FROM        From header (default "Qwakk <noreply@qwakk.fun>").
 *   QWAKK_TEST_HOOKS=1 tests only, refused in production: the dev mail sink's last codes
 *                    are readable at GET /api/test/mail (the e2e signs up with them).
 */
export interface MetaConfig {
  production: boolean;
  databaseUrl: string | null;
  sessionSecret: string;
  turnstileSecret: string | null;
  trustProxyHops: number;
  allowedOrigins: string[] | null;
  /** SMTP settings, or null: the dev mail sink outside production, no email in production. */
  smtp: SmtpConfig | null;
  mailFrom: string;
  /** Test hooks (QWAKK_TEST_HOOKS=1, never in production). */
  testHooks: boolean;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
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
  const smtpHost = env.SMTP_HOST?.trim() ?? '';
  const smtpPort = Number(env.SMTP_PORT?.trim() || 465);
  if (smtpHost && (!Number.isInteger(smtpPort) || smtpPort <= 0 || smtpPort > 65535)) throw new Error('SMTP_PORT must be a port number (465 or 587)');
  const smtp: SmtpConfig | null = smtpHost ? { host: smtpHost, port: smtpPort, user: env.SMTP_USER?.trim() ?? '', pass: env.SMTP_PASS ?? '' } : null;
  return {
    production,
    databaseUrl: env.DATABASE_URL?.trim() || null,
    sessionSecret: secret || DEV_SESSION_SECRET,
    turnstileSecret: env.TURNSTILE_SECRET?.trim() || null,
    trustProxyHops: Number.isInteger(hops) && hops > 0 ? Math.min(hops, 5) : 0,
    allowedOrigins: origins.length > 0 ? origins : null,
    smtp,
    mailFrom: env.MAIL_FROM?.trim() || 'Qwakk <noreply@qwakk.fun>',
    testHooks: env.QWAKK_TEST_HOOKS === '1' && !production,
  };
}
