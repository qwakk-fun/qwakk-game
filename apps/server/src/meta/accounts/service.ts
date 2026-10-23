/**
 * The account API's rules: sign-in by email code, sign-up, account sessions,
 * ducks (characters), the news opt-in and account deletion. Every answer that
 * could tell whether an address has an account reads the same either way:
 * sending a code always says "sent", and only someone who typed the right
 * code learns whether the address is new (sign-up) or not (signed in).
 *
 * Limits (memory only, never stored): codes per IP and per address, code
 * checks per IP, account calls per IP; Turnstile guards "send code" when it is
 * configured. Loopback is exempt from the per-IP limits outside production
 * (like the other meta limits); the per-address limit always applies.
 */
import { createHash } from 'node:crypto';
import type { Sql } from 'postgres';
import { CHARACTER_SLOTS, normalizeEmail, type CharacterSession, type SignedIn, type VerifyResult } from '@qwakk/shared/accounts';
import { isCharacterId } from '@qwakk/shared/characters';
import type { MetaConfig } from '../config.ts';
import { checkName } from '../names.ts';
import { ipKey } from '../ip.ts';
import { RateLimiter, type BucketOptions } from '../rateLimit.ts';
import { isUuid, signSession, verifyDeviceToken } from '../token.ts';
import { verifyTurnstile, type FetchLike } from '../turnstile.ts';
import { isBanned } from '../../ops/bans.ts';
import { isIpBlocked } from '../../ops/ipBlocks.ts';
import { parties } from '../../party/registry.ts';
import { checkCode, codeKey, isCodeShape, issueCode, type CodePurpose } from './codes.ts';
import { DevMailSink, type Mailer } from './mail.ts';
import { codeMail, deletedMail, mailLang } from './mailText.ts';
import { revokeGuestSessions, revokeSessions } from './revoked.ts';
import * as store from './store.ts';
import { ACCOUNT_SESSION_MS, bearer, signAccountSession, signSignupTicket, verifyAccountSession, verifySignupTicket } from './tokens.ts';

export interface ApiResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/**
 * Codes: a burst of 5 per IP, then one a minute; 3 per address, then one
 * every 2 minutes. Code checks: 10 per IP, then one every 6 s (each code also
 * allows only 5 tries). Account calls: 60 per IP, then 2 a second.
 */
export const ACCOUNT_LIMITS = {
  codeIp: { capacity: 5, refillPerSec: 1 / 60 },
  codeEmail: { capacity: 3, refillPerSec: 1 / 120 },
  verifyIp: { capacity: 10, refillPerSec: 1 / 6 },
  account: { capacity: 60, refillPerSec: 2 },
} as const satisfies Record<string, BucketOptions>;

/**
 * Wrong codes per address: at most this many in a rolling window, then the
 * address gets no new code (and no check) until the window ends. Caps
 * guessing at 15 tries a day per address, however many IPs try. A wrong try
 * counts only when a code exists (an expired or missing code does not).
 */
export const VERIFY_FAILS = { max: 15, windowMs: 24 * 3600 * 1000 } as const;

/** A session with less than this left is renewed (sliding expiry) on GET /api/account. */
const RENEW_BELOW_MS = ACCOUNT_SESSION_MS / 2;

export interface AccountDeps {
  config: MetaConfig;
  /** The database when it is up, else null. */
  db(): Sql | null;
  mailer: Mailer | null;
  fetch?: FetchLike;
  /** Loopback is exempt from per-IP limits outside production. */
  loopbackExempt(ip: string): boolean;
}

interface Auth {
  accountId: string;
  sessionId: string;
  expiresAt: number;
}

/**
 * The ban rule for accounts: while any duck of an account is banned (admin
 * panel), the account is frozen for duck changes. It cannot hatch, claim or
 * delete a duck, and it cannot delete itself, so a ban cannot be shed by
 * replacing the duck or the account. Answer: 403 `account_banned`.
 */
async function hasBannedDuck(db: Sql, accountId: string): Promise<boolean> {
  return (await store.listCharacters(db, accountId)).some((d) => isBanned(d.id));
}

const fail = (status: number, error: string, extra: Record<string, unknown> = {}, headers?: Record<string, string>): ApiResult => ({ status, body: { error, ...extra }, ...(headers ? { headers } : {}) });
const ok = (body: unknown): ApiResult => ({ status: 200, body });
const obj = (b: unknown): Record<string, unknown> => (b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {});

export class AccountService {
  readonly limits = {
    codeIp: new RateLimiter(ACCOUNT_LIMITS.codeIp),
    codeEmail: new RateLimiter(ACCOUNT_LIMITS.codeEmail),
    verifyIp: new RateLimiter(ACCOUNT_LIMITS.verifyIp),
    account: new RateLimiter(ACCOUNT_LIMITS.account),
  };
  private readonly deps: AccountDeps;
  private readonly key: Buffer;
  /** Wrong code tries per address (hashed key), memory only. */
  private readonly fails = new Map<string, { n: number; since: number }>();

  constructor(deps: AccountDeps) {
    this.deps = deps;
    this.key = codeKey(deps.config.sessionSecret);
  }

  private get secret(): string {
    return this.deps.config.sessionSecret;
  }

  /** Per-IP limit: false with a 429 to send, or null to go on. */
  private limited(kind: 'codeIp' | 'verifyIp' | 'account', ip: string): ApiResult | null {
    if (isIpBlocked(ip)) return fail(429, 'rate_limited', {}, { 'Retry-After': '600' });
    if (this.deps.loopbackExempt(ip)) return null;
    const key = ipKey(ip);
    if (this.limits[kind].take(key)) return null;
    return fail(429, 'rate_limited', {}, { 'Retry-After': String(this.limits[kind].retryAfter(key)) });
  }

  /** The per-address bucket key: a hash, so the limiter's memory holds no address. */
  private emailKey(email: string): string {
    return createHash('sha256').update(`qwakk:email-limit:${email}`).digest('base64url').slice(0, 22);
  }

  /** Has this address used up its wrong tries for the window? */
  private failsBlocked(email: string, now = Date.now()): boolean {
    const f = this.fails.get(this.emailKey(email));
    if (!f) return false;
    if (now - f.since > VERIFY_FAILS.windowMs) {
      this.fails.delete(this.emailKey(email));
      return false;
    }
    return f.n >= VERIFY_FAILS.max;
  }

  private countFail(email: string, now = Date.now()): void {
    const k = this.emailKey(email);
    const f = this.fails.get(k);
    if (!f || now - f.since > VERIFY_FAILS.windowMs) {
      if (this.fails.size > 50_000) for (const [key, v] of this.fails) if (now - v.since > VERIFY_FAILS.windowMs) this.fails.delete(key);
      this.fails.set(k, { n: 1, since: now });
    } else f.n += 1;
  }

  /** Check a typed code, counting wrong tries per address; over the cap reads like a locked code. */
  private async check(db: Sql, email: string, purpose: CodePurpose, code: string): Promise<Awaited<ReturnType<typeof checkCode>>> {
    if (this.failsBlocked(email)) return { ok: false, reason: 'code_locked' };
    const r = await checkCode(db, this.key, email, purpose, code);
    if (!r.ok && r.reason !== 'code_expired') this.countFail(email);
    if (!r.ok && r.reason === 'code_wrong' && this.failsBlocked(email)) {
      await db`delete from login_codes where email = ${email}`;
      return { ok: false, reason: 'code_locked' };
    }
    return r;
  }

  private async sendCode(db: Sql, email: string, purpose: CodePurpose, lang: unknown): Promise<ApiResult> {
    // Out of wrong tries for today: the same answer as the per-address limit.
    if (this.failsBlocked(email)) return fail(429, 'code_rate_limited', {}, { 'Retry-After': '3600' });
    const k = this.emailKey(email);
    if (!this.limits.codeEmail.take(k)) return fail(429, 'code_rate_limited', {}, { 'Retry-After': String(this.limits.codeEmail.retryAfter(k)) });
    const mailer = this.deps.mailer;
    if (!mailer) return fail(503, 'email_failed');
    const code = await issueCode(db, this.key, email, purpose);
    try {
      await mailer.send({ to: email, ...codeMail(code, mailLang(lang), purpose), code, purpose });
    } catch {
      return fail(503, 'email_failed');
    }
    return ok({ ok: true });
  }

  // ---- sign-in ------------------------------------------------------------

  /** POST /api/auth/code { email, lang?, turnstileToken? }: always "sent" for a valid address. */
  async requestCode(body: unknown, ip: string): Promise<ApiResult> {
    const limit = this.limited('codeIp', ip);
    if (limit) return limit;
    const b = obj(body);
    const email = normalizeEmail(b.email);
    if (!email) return fail(400, 'email_invalid');
    const turnstile = this.deps.config.turnstileSecret;
    if (turnstile && !(await verifyTurnstile(turnstile, b.turnstileToken, ip, this.deps.fetch))) return fail(403, 'turnstile_failed');
    const db = this.deps.db();
    if (!db) return fail(503, 'unavailable');
    return this.sendCode(db, email, 'login', b.lang);
  }

  /** POST /api/auth/verify { email, code }: signed in, or a sign-up ticket for a new address. */
  async verify(body: unknown, ip: string): Promise<ApiResult> {
    const limit = this.limited('verifyIp', ip);
    if (limit) return limit;
    const b = obj(body);
    const email = normalizeEmail(b.email);
    if (!email) return fail(400, 'email_invalid');
    if (!isCodeShape(b.code)) return fail(400, 'code_format');
    const db = this.deps.db();
    if (!db) return fail(503, 'unavailable');
    const check = await this.check(db, email, 'login', b.code);
    if (!check.ok) return fail(400, check.reason, check.reason === 'code_wrong' ? { left: check.left } : {});
    const accountId = await store.accountIdByEmail(db, email);
    if (accountId) {
      const s = await this.signIn(db, accountId);
      if (!s) return fail(503, 'unavailable');
      return ok({ status: 'signed_in', ...s } satisfies VerifyResult);
    }
    const t = signSignupTicket(this.secret, email);
    return ok({ status: 'signup', signupToken: t.token, expiresAt: t.expiresAt } satisfies VerifyResult);
  }

  /**
   * POST /api/auth/signup { signupToken, consent: true, marketing?, guestDeviceToken?, guestLook? }.
   * Creates the account (or signs in, if the address got one meanwhile) and
   * brings the guest duck of this device along when a slot is free.
   */
  async signup(body: unknown, ip: string): Promise<ApiResult> {
    const limit = this.limited('account', ip);
    if (limit) return limit;
    const b = obj(body);
    const email = verifySignupTicket(this.secret, b.signupToken);
    if (!email) return fail(401, 'signup_expired');
    if (b.consent !== true) return fail(400, 'consent_required');
    if (b.marketing !== undefined && typeof b.marketing !== 'boolean') return fail(400, 'bad_request');
    const db = this.deps.db();
    if (!db) return fail(503, 'unavailable');
    let accountId = await store.accountIdByEmail(db, email);
    if (!accountId) {
      try {
        accountId = await store.createAccount(db, email, b.marketing === true);
      } catch (err) {
        // The same ticket twice at once: the other request made it.
        const e = err as { code?: string };
        if (e?.code !== '23505') throw err;
        accountId = await store.accountIdByEmail(db, email);
        if (!accountId) throw err;
      }
    }
    const claimed = await this.claimFor(db, accountId, b.guestDeviceToken, b.guestLook);
    const s = await this.signIn(db, accountId);
    if (!s) return fail(503, 'unavailable');
    return ok({ ...s, account: claimed.ok ? (await store.loadAccount(db, accountId)) ?? s.account : s.account, claimed: claimed.ok ? claimed.character : null } satisfies SignedIn);
  }

  private async signIn(db: Sql, accountId: string): Promise<SignedIn | null> {
    const session = await store.createSession(db, accountId);
    await store.touchLogin(db, accountId, 'email');
    const account = await store.loadAccount(db, accountId);
    if (!account) return null;
    return { accountToken: signAccountSession(this.secret, session.id, accountId, session.expiresAt), expiresAt: session.expiresAt, account };
  }

  /** Move the guest behind `deviceToken` into the account (it keeps its name, tag and stats). */
  private async claimFor(db: Sql, accountId: string, deviceToken: unknown, look: unknown): Promise<store.ClaimResult | { ok: false; reason: 'banned' }> {
    const playerId = verifyDeviceToken(this.secret, deviceToken);
    if (!playerId) return { ok: false, reason: 'no_guest' };
    if (isBanned(playerId)) return { ok: false, reason: 'banned' };
    const r = await store.claimGuest(db, accountId, playerId, isCharacterId(look) ? look : 0);
    // Its guest sessions stop working: from now on it plays through the account.
    if (r.ok) revokeGuestSessions(playerId);
    return r;
  }

  // ---- account session ----------------------------------------------------

  /** The account behind `Authorization: Bearer <account session>`, or a 401. */
  private async auth(authorization: string | undefined, db: Sql): Promise<Auth | ApiResult> {
    const c = verifyAccountSession(this.secret, bearer(authorization));
    if (!c) return fail(401, 'session_expired');
    const row = await store.useSession(db, c.sessionId, c.accountId);
    if (!row) return fail(401, 'session_expired');
    return { accountId: c.accountId, sessionId: c.sessionId, expiresAt: row.expiresAt };
  }

  /** Limits, the database and the session in one step; then `run`. */
  private async withAuth(authorization: string | undefined, ip: string, run: (db: Sql, a: Auth) => Promise<ApiResult>): Promise<ApiResult> {
    const limit = this.limited('account', ip);
    if (limit) return limit;
    const db = this.deps.db();
    if (!db) return fail(503, 'unavailable');
    const a = await this.auth(authorization, db);
    if ('status' in a) return a;
    return run(db, a);
  }

  /** GET /api/account: the account and its ducks (and a renewed token when the session is half used). */
  account(authorization: string | undefined, ip: string): Promise<ApiResult> {
    return this.withAuth(authorization, ip, async (db, a) => {
      const account = await store.loadAccount(db, a.accountId);
      if (!account) return fail(401, 'session_expired');
      if (a.expiresAt - Date.now() < RENEW_BELOW_MS) {
        const expiresAt = await store.extendSession(db, a.sessionId);
        return ok({ account, accountToken: signAccountSession(this.secret, a.sessionId, a.accountId, expiresAt), expiresAt });
      }
      return ok({ account });
    });
  }

  /** POST /api/auth/logout: this device's session ends. */
  logout(authorization: string | undefined, ip: string): Promise<ApiResult> {
    return this.withAuth(authorization, ip, async (db, a) => {
      await store.deleteSession(db, a.sessionId);
      return ok({ ok: true });
    });
  }

  /** POST /api/account/marketing { optIn } */
  marketing(authorization: string | undefined, body: unknown, ip: string): Promise<ApiResult> {
    return this.withAuth(authorization, ip, async (db, a) => {
      const optIn = obj(body).optIn;
      if (typeof optIn !== 'boolean') return fail(400, 'bad_request');
      await store.setMarketing(db, a.accountId, optIn);
      return ok({ marketing: optIn });
    });
  }

  /** POST /api/account/legal { accept: true }: the current terms version (after an update). */
  legal(authorization: string | undefined, body: unknown, ip: string): Promise<ApiResult> {
    return this.withAuth(authorization, ip, async (db, a) => {
      if (obj(body).accept !== true) return fail(400, 'consent_required');
      await store.acceptLegal(db, a.accountId);
      return ok({ account: await store.loadAccount(db, a.accountId) });
    });
  }

  // ---- ducks --------------------------------------------------------------

  /** POST /api/account/characters { name, look, slot? } */
  createCharacter(authorization: string | undefined, body: unknown, ip: string): Promise<ApiResult> {
    return this.withAuth(authorization, ip, async (db, a) => {
      const b = obj(body);
      const name = checkName(b.name);
      if (!name.ok) return fail(400, `name_${name.reason}`);
      if (!isCharacterId(b.look)) return fail(400, 'bad_request');
      const slot = b.slot === undefined || b.slot === null ? null : typeof b.slot === 'number' && Number.isInteger(b.slot) && b.slot >= 0 && b.slot < CHARACTER_SLOTS ? b.slot : NaN;
      if (Number.isNaN(slot)) return fail(400, 'bad_request');
      // A banned duck's owner cannot hatch a fresh one to get around the ban.
      if (await hasBannedDuck(db, a.accountId)) return fail(403, 'account_banned');
      const r = await store.createCharacter(db, a.accountId, name.name, b.look, slot);
      if (!r.ok) return fail(409, r.reason);
      return ok({ character: r.character });
    });
  }

  /** POST /api/account/characters/delete { id, confirm }: `confirm` must be the duck's name, exactly. */
  deleteCharacter(authorization: string | undefined, body: unknown, ip: string): Promise<ApiResult> {
    return this.withAuth(authorization, ip, async (db, a) => {
      const b = obj(body);
      if (!isUuid(b.id)) return fail(400, 'bad_request');
      const duck = await store.characterOf(db, a.accountId, b.id);
      if (!duck) return fail(404, 'not_found');
      if (b.confirm !== duck.name) return fail(400, 'confirm_mismatch');
      if (await hasBannedDuck(db, a.accountId)) return fail(403, 'account_banned');
      if (parties.isPlaying(duck.id)) return fail(409, 'in_match');
      if (!(await store.deleteCharacter(db, a.accountId, duck.id))) return fail(404, 'not_found');
      revokeSessions(duck.id);
      return ok({ ok: true });
    });
  }

  /** POST /api/account/characters/claim { deviceToken, look? }: bring this device's guest duck in. */
  claim(authorization: string | undefined, body: unknown, ip: string): Promise<ApiResult> {
    return this.withAuth(authorization, ip, async (db, a) => {
      const b = obj(body);
      if (await hasBannedDuck(db, a.accountId)) return fail(403, 'account_banned');
      const r = await this.claimFor(db, a.accountId, b.deviceToken, b.look);
      if (!r.ok) return r.reason === 'banned' ? fail(403, 'account_banned') : fail(r.reason === 'slots_full' ? 409 : 404, r.reason);
      return ok({ character: r.character });
    });
  }

  /** POST /api/account/play { id }: a 24-hour game session for one duck (the rooms use it like a guest's). */
  play(authorization: string | undefined, body: unknown, ip: string): Promise<ApiResult> {
    return this.withAuth(authorization, ip, async (db, a) => {
      const id = obj(body).id;
      if (!isUuid(id)) return fail(400, 'bad_request');
      const duck = await store.characterOf(db, a.accountId, id);
      if (!duck) return fail(404, 'not_found');
      if (isBanned(duck.id)) return fail(403, 'account_banned');
      await store.setLastCharacter(db, a.accountId, duck.id);
      const s = signSession(this.secret, { playerId: duck.id, name: duck.name, tag: duck.tag, account: true, look: duck.look });
      return ok({ token: s.token, expiresAt: s.expiresAt, playerId: duck.id, name: duck.name, tag: duck.tag, look: duck.look } satisfies CharacterSession);
    });
  }

  // ---- account deletion ---------------------------------------------------

  /** POST /api/account/delete/code { lang? }: a confirmation code to the account's address. */
  deleteCode(authorization: string | undefined, body: unknown, ip: string): Promise<ApiResult> {
    return this.withAuth(authorization, ip, async (db, a) => {
      const account = await store.loadAccount(db, a.accountId);
      if (!account?.email) return fail(401, 'session_expired');
      if (account.characters.some((d) => isBanned(d.id))) return fail(403, 'account_banned');
      return this.sendCode(db, account.email, 'delete', obj(body).lang);
    });
  }

  /** POST /api/account/delete { code, lang? }: the account, its logins, sessions and ducks are deleted. */
  deleteAccount(authorization: string | undefined, body: unknown, ip: string): Promise<ApiResult> {
    return this.withAuth(authorization, ip, async (db, a) => {
      const b = obj(body);
      if (!isCodeShape(b.code)) return fail(400, 'code_format');
      const account = await store.loadAccount(db, a.accountId);
      if (!account?.email) return fail(401, 'session_expired');
      if (account.characters.some((d) => isBanned(d.id))) return fail(403, 'account_banned');
      if (account.characters.some((d) => parties.isPlaying(d.id))) return fail(409, 'in_match');
      const check = await this.check(db, account.email, 'delete', b.code);
      if (!check.ok) return fail(400, check.reason, check.reason === 'code_wrong' ? { left: check.left } : {});
      const ids = await store.deleteAccount(db, a.accountId, account.email);
      for (const id of ids) revokeSessions(id);
      // Best effort: the account is gone either way.
      this.deps.mailer?.send({ to: account.email, ...deletedMail(mailLang(b.lang)), purpose: 'deleted' }).catch(() => {});
      return ok({ ok: true });
    });
  }

  // ---- tests --------------------------------------------------------------

  /** GET /api/test/mail?email=: the dev sink's last code to that address (test hooks only, never production). */
  testMail(params: URLSearchParams): ApiResult {
    const sink = this.deps.mailer;
    if (!this.deps.config.testHooks || this.deps.config.production || !(sink instanceof DevMailSink)) return fail(404, 'not_found');
    const email = normalizeEmail(params.get('email'));
    const last = email ? sink.lastTo(email) : null;
    return last ? ok(last) : fail(404, 'not_found');
  }
}
