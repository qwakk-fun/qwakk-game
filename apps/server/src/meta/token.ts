/**
 * Server-signed tokens (HMAC-SHA256, no JWT library).
 *
 * Device token: `d1.<id>.<sig>`. `id` is 32 hex characters (a UUID without
 * dashes) and IS the player id. The browser keeps it in localStorage and trades
 * it for a session; only the server can mint one, so it cannot be forged and a
 * valid one skips the Turnstile check (Turnstile guards guest creation).
 *
 * Session token: `s1.<payload>.<sig>`, payload = base64url JSON
 * `{ p: playerId, n: name, t: tag, i: issuedAt, e: expiresAt }` (seconds).
 * Short-lived; the client refreshes it from the device token.
 *
 * Each kind signs under its own prefix, so one can never pass as the other.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_TTL_S = 24 * 3600;
const MAX_TOKEN_LENGTH = 1024;

export interface SessionClaims {
  playerId: string;
  name: string;
  tag: string;
  issuedAt: number;
  expiresAt: number;
}

function sign(secret: string, kind: string, body: string): string {
  return createHmac('sha256', secret).update(`qwakk:${kind}:${body}`).digest('base64url');
}

function sameSig(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** 32 hex chars to the canonical UUID form stored in the database. */
export function hexToUuid(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function isUuid(s: unknown): s is string {
  return typeof s === 'string' && UUID_RE.test(s);
}

/** A fresh random player id (UUID v4 bits) and its device token. */
export function mintDeviceToken(secret: string): { token: string; playerId: string } {
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return { token: `d1.${hex}.${sign(secret, 'device', hex)}`, playerId: hexToUuid(hex) };
}

/** The player id a device token stands for, or null if it is not one we signed. */
export function verifyDeviceToken(secret: string, token: unknown): string | null {
  if (typeof token !== 'string' || token.length > 128) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'd1') return null;
  const hex = parts[1]!;
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return sameSig(parts[2]!, sign(secret, 'device', hex)) ? hexToUuid(hex) : null;
}

export function signSession(secret: string, claims: { playerId: string; name: string; tag: string }, nowMs = Date.now(), ttlS = SESSION_TTL_S): { token: string; expiresAt: number } {
  const i = Math.floor(nowMs / 1000);
  const e = i + ttlS;
  const body = Buffer.from(JSON.stringify({ p: claims.playerId, n: claims.name, t: claims.tag, i, e })).toString('base64url');
  return { token: `s1.${body}.${sign(secret, 'session', body)}`, expiresAt: e * 1000 };
}

/** Claims of a valid, unexpired session token, or null. Never throws. */
export function verifySessionToken(secret: string, token: unknown, nowMs = Date.now()): SessionClaims | null {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 's1') return null;
  const [, body, sig] = parts as [string, string, string];
  if (!sameSig(sig, sign(secret, 'session', body))) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.p !== 'string' || typeof c.n !== 'string' || typeof c.t !== 'string') return null;
  if (typeof c.i !== 'number' || typeof c.e !== 'number') return null;
  if (c.e * 1000 <= nowMs) return null;
  return { playerId: c.p, name: c.n, tag: c.t, issuedAt: c.i * 1000, expiresAt: c.e * 1000 };
}

/** Random 4-digit discriminator, 1000 to 9999. */
export function randomTag(): number {
  return 1000 + (randomBytes(2).readUInt16BE(0) % 9000);
}
