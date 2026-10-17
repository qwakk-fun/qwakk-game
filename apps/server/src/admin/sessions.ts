/**
 * Admin sessions: a signed cookie that names a session held in server memory.
 *
 *   cookie value  v1.<session id>.<expires, unix s>.<HMAC-SHA256>
 *
 * The HMAC key is random per process, and the session must also be in the
 * in-memory table: logging out (or a restart) ends it for good, and a stolen
 * cookie dies with its session. Sessions last at most `ttlMs` (12 h) and end
 * after `idleMs` (2 h) without a request. The cookie is HttpOnly, Secure,
 * SameSite=Strict, `__Host-` prefixed (no Domain, Path=/), so no other page,
 * subdomain or script can read or plant it.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = '__Host-qwakk_admin';
export const SESSION_TTL_MS = 12 * 3600_000;
export const SESSION_IDLE_MS = 2 * 3600_000;
const MAX_SESSIONS = 20;

export interface AdminSession {
  id: string;
  /** Short label for the audit log ("admin@1a2b"): a hash prefix, never the session id itself. */
  actor: string;
  createdAt: number;
  expiresAt: number;
  lastSeen: number;
}

export class AdminSessions {
  private readonly key = randomBytes(32);
  private readonly table = new Map<string, AdminSession>();
  readonly ttlMs: number;
  readonly idleMs: number;

  constructor(ttlMs = SESSION_TTL_MS, idleMs = SESSION_IDLE_MS) {
    this.ttlMs = ttlMs;
    this.idleMs = idleMs;
  }

  private sign(body: string): string {
    return createHmac('sha256', this.key).update(`qwakk-admin:${body}`).digest('base64url');
  }

  /** A new session and its cookie value. The oldest session goes when the table is full. */
  create(now = Date.now()): { session: AdminSession; cookie: string } {
    this.prune(now);
    if (this.table.size >= MAX_SESSIONS) {
      const oldest = [...this.table.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
      if (oldest) this.table.delete(oldest.id);
    }
    const id = randomBytes(24).toString('base64url');
    const actor = `admin@${createHash('sha256').update(id).digest('hex').slice(0, 4)}`;
    const session: AdminSession = { id, actor, createdAt: now, expiresAt: now + this.ttlMs, lastSeen: now };
    this.table.set(id, session);
    const body = `v1.${id}.${Math.floor(session.expiresAt / 1000)}`;
    return { session, cookie: `${body}.${this.sign(body)}` };
  }

  /** The live session behind a cookie value, or null (bad signature, unknown, expired or idle). Touches it. */
  verify(value: string | undefined, now = Date.now()): AdminSession | null {
    if (!value || value.length > 200) return null;
    const parts = value.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') return null;
    const body = parts.slice(0, 3).join('.');
    const sig = Buffer.from(parts[3]!);
    const want = Buffer.from(this.sign(body));
    if (sig.length !== want.length || !timingSafeEqual(sig, want)) return null;
    const exp = Number(parts[2]) * 1000;
    if (!Number.isFinite(exp) || exp <= now) return null;
    const s = this.table.get(parts[1]!);
    if (!s || s.expiresAt <= now || now - s.lastSeen > this.idleMs) {
      if (s) this.table.delete(s.id);
      return null;
    }
    s.lastSeen = now;
    return s;
  }

  revoke(id: string): void {
    this.table.delete(id);
  }

  get size(): number {
    return this.table.size;
  }

  private prune(now: number): void {
    for (const [id, s] of this.table) if (s.expiresAt <= now || now - s.lastSeen > this.idleMs) this.table.delete(id);
  }
}

/** Set-Cookie for a new session. */
export function sessionCookie(value: string, maxAgeMs: number): string {
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}; HttpOnly; Secure; SameSite=Strict`;
}

/** Set-Cookie that deletes the session cookie. */
export function clearCookie(): string {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

/** The admin cookie's value from a Cookie header. */
export function readCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === COOKIE_NAME) return part.slice(i + 1).trim();
  }
  return undefined;
}
