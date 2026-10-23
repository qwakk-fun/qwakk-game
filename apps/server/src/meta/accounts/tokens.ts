/**
 * Account tokens, signed like the guest tokens (HMAC-SHA256 under
 * SESSION_SECRET with their own kind prefix, so none passes as another):
 *
 *   Account session `a1.<payload>.<sig>`, payload `{ s: sessionId, a: accountId, e: expiresAt }`.
 *     Long-lived (ACCOUNT_SESSION_DAYS) and sliding: GET /api/account hands
 *     out a fresh one when less than half is left. Revocable: it names an
 *     `account_sessions` row, and logout or account deletion deletes the row,
 *     so the signature alone never signs anyone in.
 *   Sign-up ticket `u1.<payload>.<sig>`, payload `{ m: email, e }`: proof that
 *     the holder typed the right code for an address without an account, good
 *     for SIGNUP_TICKET_MS, traded for a new account at POST /api/auth/signup.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isUuid } from '../token.ts';

export const ACCOUNT_SESSION_DAYS = 30;
export const ACCOUNT_SESSION_MS = ACCOUNT_SESSION_DAYS * 24 * 3600 * 1000;
export const SIGNUP_TICKET_MS = 15 * 60 * 1000;
const MAX_LENGTH = 1024;

function sign(secret: string, kind: string, body: string): string {
  return createHmac('sha256', secret).update(`qwakk:${kind}:${body}`).digest('base64url');
}

function sameSig(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function pack(secret: string, prefix: string, kind: string, payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${prefix}.${body}.${sign(secret, kind, body)}`;
}

function unpack(secret: string, prefix: string, kind: string, token: unknown): Record<string, unknown> | null {
  if (typeof token !== 'string' || token.length > MAX_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== prefix) return null;
  const [, body, sig] = parts as [string, string, string];
  if (!sameSig(sig, sign(secret, kind, body))) return null;
  try {
    const raw: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface AccountSessionClaims {
  sessionId: string;
  accountId: string;
  expiresAt: number;
}

export function signAccountSession(secret: string, sessionId: string, accountId: string, expiresAt: number): string {
  return pack(secret, 'a1', 'account', { s: sessionId, a: accountId, e: Math.floor(expiresAt / 1000) });
}

/** Claims of a well-signed, unexpired account session token (the row is checked by the caller). */
export function verifyAccountSession(secret: string, token: unknown, nowMs = Date.now()): AccountSessionClaims | null {
  const c = unpack(secret, 'a1', 'account', token);
  if (!c || !isUuid(c.s) || !isUuid(c.a) || typeof c.e !== 'number' || c.e * 1000 <= nowMs) return null;
  return { sessionId: c.s, accountId: c.a, expiresAt: c.e * 1000 };
}

export function signSignupTicket(secret: string, email: string, nowMs = Date.now()): { token: string; expiresAt: number } {
  const expiresAt = nowMs + SIGNUP_TICKET_MS;
  return { token: pack(secret, 'u1', 'signup', { m: email, e: Math.floor(expiresAt / 1000) }), expiresAt };
}

/** The address a valid, unexpired sign-up ticket was made for, or null. */
export function verifySignupTicket(secret: string, token: unknown, nowMs = Date.now()): string | null {
  const c = unpack(secret, 'u1', 'signup', token);
  if (!c || typeof c.m !== 'string' || typeof c.e !== 'number' || c.e * 1000 <= nowMs) return null;
  return c.m;
}

/** The bearer token of an Authorization header. */
export function bearer(authorization: string | undefined): string | undefined {
  return /^Bearer\s+(\S+)$/i.exec(authorization ?? '')?.[1];
}
