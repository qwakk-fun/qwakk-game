/**
 * Accounts on a real PostgreSQL (skipped when the local test database is not
 * running): sign-in codes (hashing, expiry, tries, one active code, limits,
 * no account enumeration, Turnstile), sign-up with consent, account sessions
 * (verify, renew, logout), ducks (create, slot limit, name rules, play,
 * delete), claiming a guest, a new device, account deletion, the HTTP routes
 * and migration 003 on a database that already holds guests and admin data.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHARACTER_SLOTS, LEGAL_VERSION, MARKETING_TEXT_VERSION, normalizeEmail, type AccountView, type CharacterSession, type CharacterView, type SignedIn } from '@qwakk/shared/accounts';
import { checkCode, codeKey, issueCode } from '../../src/meta/accounts/codes.ts';
import { DevMailSink } from '../../src/meta/accounts/mail.ts';
import { clearRevoked } from '../../src/meta/accounts/revoked.ts';
import { DELETED_NAME } from '../../src/meta/accounts/store.ts';
import { VERIFY_FAILS } from '../../src/meta/accounts/service.ts';
import { dropBan, putBan } from '../../src/ops/bans.ts';
import { createMetaHandler } from '../../src/meta/http.ts';
import { migrate, readMigrations } from '../../src/meta/migrate.ts';
import { MetaService } from '../../src/meta/service.ts';
import type { FetchLike } from '../../src/meta/turnstile.ts';
import { dbReachable, freshDatabase } from './testDb.ts';

const reachable = await dbReachable();
const SECRET = 'accounts-test-secret-accounts-test-1234';

let ipN = 0;
/** A fresh public-looking address per call, so the per-IP limits stay out of the way unless a test wants them. */
const ip = (): string => `10.20.${Math.floor(++ipN / 250)}.${ipN % 250}`;

describe.skipIf(!reachable)('accounts (PostgreSQL)', () => {
  let db: { url: string; drop: () => Promise<void> };
  let meta: MetaService;
  let sink: DevMailSink;
  let sql: Sql;
  let http: Server;
  let base = '';

  beforeAll(async () => {
    db = await freshDatabase('accounts');
    sink = new DevMailSink({ quiet: true });
    meta = new MetaService({ env: { DATABASE_URL: db.url, SESSION_SECRET: SECRET, QWAKK_TEST_HOOKS: '1' }, mailer: sink });
    await meta.start();
    sql = meta.sql!;
    http = createServer(createMetaHandler(meta));
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    http?.close();
    await meta?.stop();
    await db?.drop();
    clearRevoked();
  });

  const A = () => meta.accounts;
  const bearer = (t: string) => `Bearer ${t}`;
  const lastCode = (email: string): string => sink.lastTo(normalizeEmail(email)!)!.code!;

  async function codeFor(email: string): Promise<string> {
    const r = await A().requestCode({ email }, ip());
    expect(r).toEqual({ status: 200, body: { ok: true } });
    return lastCode(email);
  }

  async function signUp(email: string, extra: Record<string, unknown> = {}): Promise<SignedIn> {
    const code = await codeFor(email);
    const v = await A().verify({ email, code }, ip());
    expect(v.status).toBe(200);
    const ticket = v.body as { status: string; signupToken: string };
    expect(ticket.status).toBe('signup');
    const s = await A().signup({ signupToken: ticket.signupToken, consent: true, ...extra }, ip());
    expect(s.status).toBe(200);
    return s.body as SignedIn;
  }

  async function signIn(email: string): Promise<SignedIn> {
    const v = await A().verify({ email, code: await codeFor(email) }, ip());
    expect((v.body as { status: string }).status).toBe('signed_in');
    return v.body as SignedIn;
  }

  async function duck(token: string, name: string, look = 0): Promise<CharacterView> {
    const r = await A().createCharacter(bearer(token), { name, look }, ip());
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return (r.body as { character: CharacterView }).character;
  }

  it('stores only a hash of the code; right code once, wrong codes count down, then lock', async () => {
    const email = 'hash@example.com';
    const code = await codeFor(email);
    const [row] = await sql<{ code_hash: string; salt: string; purpose: string }[]>`select code_hash, salt, purpose from login_codes where email = ${email}`;
    expect(row?.purpose).toBe('login');
    expect(row?.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(`${row?.code_hash}${row?.salt}`).not.toContain(code);

    const wrong = code === '000000' ? '111111' : '000000';
    expect((await A().verify({ email, code: wrong }, ip())).body).toEqual({ error: 'code_wrong', left: 4 });
    // The right code still works after a wrong try, once.
    expect((await A().verify({ email, code }, ip())).status).toBe(200);
    expect((await A().verify({ email, code }, ip())).body).toEqual({ error: 'code_expired' });

    await codeFor(email);
    for (let left = 4; left >= 1; left--) expect((await A().verify({ email, code: wrong }, ip())).body).toEqual({ error: 'code_wrong', left });
    expect((await A().verify({ email, code: wrong }, ip())).body).toEqual({ error: 'code_locked' });
    const [codes] = await sql<{ n: number }[]>`select count(*)::int as n from login_codes where email = ${email}`;
    expect(codes?.n).toBe(0);
    expect((await A().verify({ email, code: '12345' }, ip())).body).toEqual({ error: 'code_format' });
    expect((await A().verify({ email: 'nope', code: '123456' }, ip())).body).toEqual({ error: 'email_invalid' });
  });

  it('expires codes after 10 minutes and keeps one active code per address (any purpose)', async () => {
    const key = codeKey(SECRET);
    const email = 'expiry@example.com';
    const t0 = Date.now();
    const old = await issueCode(sql, key, email, 'login', t0 - 11 * 60_000);
    expect(await checkCode(sql, key, email, 'login', old, t0)).toEqual({ ok: false, reason: 'code_expired' });
    const first = await issueCode(sql, key, email, 'login', t0);
    const second = await issueCode(sql, key, email, 'login', t0);
    if (first !== second) expect((await checkCode(sql, key, email, 'login', first, t0)).ok).toBe(false);
    expect(await checkCode(sql, key, email, 'login', second, t0)).toEqual({ ok: true });
    // A deletion code never signs anyone in.
    const del = await issueCode(sql, key, email, 'delete', t0);
    expect((await checkCode(sql, key, email, 'login', del, t0)).ok).toBe(false);
  });

  it('answers "send code" the same for a known and an unknown address', async () => {
    await signUp('known@example.com');
    const known = await A().requestCode({ email: 'known@example.com' }, ip());
    const unknown = await A().requestCode({ email: 'unknown@example.com' }, ip());
    expect(known).toEqual(unknown);
    expect(known).toEqual({ status: 200, body: { ok: true } });
    // Both got a code; only the code tells the owner which way it goes.
    expect(lastCode('known@example.com')).toMatch(/^\d{6}$/);
    expect(lastCode('unknown@example.com')).toMatch(/^\d{6}$/);
  });

  it('limits codes per address and per IP, and runs Turnstile when it is configured', async () => {
    const email = 'limits@example.com';
    for (let i = 0; i < 3; i++) expect((await A().requestCode({ email }, ip())).status).toBe(200);
    // A fourth from yet another address: the per-address limit holds.
    expect((await A().requestCode({ email }, ip())).body).toEqual({ error: 'code_rate_limited' });

    const one = '10.99.0.1';
    for (let i = 0; i < 5; i++) expect((await A().requestCode({ email: `ip${i}@example.com` }, one)).status).toBe(200);
    expect((await A().requestCode({ email: 'ip9@example.com' }, one)).body).toEqual({ error: 'rate_limited' });
    // Code checks per IP.
    const two = '10.99.0.2';
    for (let i = 0; i < 10; i++) await A().verify({ email: 'x@example.com', code: '123456' }, two);
    expect((await A().verify({ email: 'x@example.com', code: '123456' }, two)).body).toEqual({ error: 'rate_limited' });

    const calls: string[] = [];
    const fetchFake: FetchLike = async (_url, init) => {
      calls.push(String(init.body.get('response')));
      return { ok: true, json: async () => ({ success: init.body.get('response') === 'good' }) };
    };
    const guarded = new MetaService({ env: { DATABASE_URL: db.url, SESSION_SECRET: SECRET, TURNSTILE_SECRET: 'ts' }, fetch: fetchFake, mailer: new DevMailSink({ quiet: true }) });
    await guarded.start();
    expect((await guarded.accounts.requestCode({ email: 'ts@example.com' }, ip())).body).toEqual({ error: 'turnstile_failed' });
    expect((await guarded.accounts.requestCode({ email: 'ts@example.com', turnstileToken: 'bad' }, ip())).body).toEqual({ error: 'turnstile_failed' });
    expect((await guarded.accounts.requestCode({ email: 'ts@example.com', turnstileToken: 'good' }, ip())).status).toBe(200);
    expect(calls).toEqual(['bad', 'good']);
    await guarded.stop();
  });

  it('signs up only with consent and stores the legal version, the age statement and the news choice', async () => {
    const email = 'Consent.Duck+news@Example.com';
    const code = await codeFor(email);
    expect(lastCode('consent.duck+news@example.com')).toBe(code);
    const v = (await A().verify({ email, code }, ip())).body as { signupToken: string };
    expect((await A().signup({ signupToken: v.signupToken }, ip())).body).toEqual({ error: 'consent_required' });
    expect((await A().signup({ signupToken: 'u1.bad.sig', consent: true }, ip())).body).toEqual({ error: 'signup_expired' });
    const s = (await A().signup({ signupToken: v.signupToken, consent: true, marketing: true }, ip())).body as SignedIn;
    expect(s.account).toMatchObject({ email: 'consent.duck+news@example.com', marketing: true, legalVersion: LEGAL_VERSION, characters: [], slots: CHARACTER_SLOTS });
    const [a] = await sql<{ legal_version: string; legal_accepted_at: Date; age_confirmed_at: Date; marketing_opt_in: boolean }[]>`
      select legal_version, legal_accepted_at, age_confirmed_at, marketing_opt_in from accounts a
      join account_logins l on l.account_id = a.id where l.subject = 'consent.duck+news@example.com'`;
    expect(a?.legal_version).toBe(LEGAL_VERSION);
    expect(a?.legal_accepted_at).toBeInstanceOf(Date);
    expect(a?.age_confirmed_at).toBeInstanceOf(Date);
    // The news choice and every change of it are logged with the wording version.
    expect((await A().marketing(bearer(s.accountToken), { optIn: false }, ip())).body).toEqual({ marketing: false });
    const log = await sql<{ opt_in: boolean; text_version: string; source: string }[]>`
      select c.opt_in, c.text_version, c.source from marketing_consents c join account_logins l on l.account_id = c.account_id
      where l.subject = 'consent.duck+news@example.com' order by c.id`;
    expect(log).toEqual([
      { opt_in: true, text_version: MARKETING_TEXT_VERSION, source: 'signup' },
      { opt_in: false, text_version: MARKETING_TEXT_VERSION, source: 'account' },
    ]);
    // News is off by default.
    const plain = await signUp('plain@example.com');
    expect(plain.account.marketing).toBe(false);
    // Stored without an IP address or user agent anywhere.
    const cols = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns where table_name in ('accounts', 'account_sessions', 'account_logins', 'login_codes', 'marketing_consents')`;
    expect(cols.map((c) => c.column_name).filter((c) => /ip|agent|ua$/i.test(c))).toEqual([]);
  });

  it('account sessions: verify, renew when half used, logout revokes, forged ones fail', async () => {
    const s = await signUp('session@example.com');
    const me = await A().account(bearer(s.accountToken), ip());
    expect(me.status).toBe(200);
    expect((me.body as { account: AccountView }).account.email).toBe('session@example.com');
    expect((me.body as { accountToken?: string }).accountToken).toBeUndefined();
    // Half used: GET /api/account hands out a renewed token for the same row.
    await sql`update account_sessions set expires_at = now() + interval '5 days'`;
    const renewed = (await A().account(bearer(s.accountToken), ip())).body as { accountToken: string; expiresAt: number };
    expect(renewed.expiresAt).toBeGreaterThan(Date.now() + 29 * 24 * 3600_000);
    expect((await A().account(bearer(renewed.accountToken), ip())).status).toBe(200);

    expect((await A().account(undefined, ip())).body).toEqual({ error: 'session_expired' });
    expect((await A().account(bearer(`${s.accountToken}x`), ip())).status).toBe(401);
    expect((await A().logout(bearer(s.accountToken), ip())).status).toBe(200);
    expect((await A().account(bearer(s.accountToken), ip())).body).toEqual({ error: 'session_expired' });
    expect((await A().account(bearer(renewed.accountToken), ip())).status).toBe(401);
  });

  it('ducks: four slots, name rules, a free #tag, play gives an account game session, delete needs the name', async () => {
    const s = await signUp('ducks@example.com');
    const t = s.accountToken;
    const a = await duck(t, 'Quacky', 1);
    expect(a).toMatchObject({ slot: 0, name: 'Quacky', look: 1, level: 1, xp: 0 });
    expect(a.tag).toMatch(/^\d{4}$/);
    expect((await A().createCharacter(bearer(t), { name: 'fuck', look: 0 }, ip())).body).toEqual({ error: 'name_blocked' });
    expect((await A().createCharacter(bearer(t), { name: 'ab', look: 0 }, ip())).body).toEqual({ error: 'name_format' });
    expect((await A().createCharacter(bearer(t), { name: 'Admin', look: 0 }, ip())).body).toEqual({ error: 'name_reserved' });
    expect((await A().createCharacter(bearer(t), { name: 'Fine', look: 99 }, ip())).body).toEqual({ error: 'bad_request' });
    expect((await A().createCharacter(bearer(t), { name: 'Fine', look: 0, slot: 0 }, ip())).body).toEqual({ error: 'slot_taken' });
    await duck(t, 'Second');
    await duck(t, 'Third');
    await duck(t, 'Fourth');
    expect((await A().createCharacter(bearer(t), { name: 'Fifth', look: 0 }, ip())).body).toEqual({ error: 'slots_full' });

    const play = (await A().play(bearer(t), { id: a.id }, ip())).body as CharacterSession;
    expect(play).toMatchObject({ playerId: a.id, name: 'Quacky', tag: a.tag, look: 1 });
    expect(meta.verifySession(play.token)).toEqual({ playerId: a.id, name: 'Quacky', tag: a.tag, account: true, look: 1 });
    // Another account cannot play or delete this duck.
    const other = await signUp('other@example.com');
    expect((await A().play(bearer(other.accountToken), { id: a.id }, ip())).status).toBe(404);
    expect((await A().deleteCharacter(bearer(other.accountToken), { id: a.id, confirm: 'Quacky' }, ip())).status).toBe(404);

    // A match row for it, then delete: the row stays with no link and no name; its session stops working.
    await meta.recordMatch({ matchId: 'acc-m1', mode: 'dm', mapId: 'greybox', startedAt: Date.now() - 60_000, endedAt: Date.now(), players: [{ playerId: a.id, name: 'Quacky', isBot: false, placement: 1, kills: 3, damage: 300, survivedMs: 60_000 }] });
    expect((await A().deleteCharacter(bearer(t), { id: a.id, confirm: 'quacky' }, ip())).body).toEqual({ error: 'confirm_mismatch' });
    expect((await A().deleteCharacter(bearer(t), { id: a.id, confirm: 'Quacky' }, ip())).body).toEqual({ ok: true });
    expect(meta.verifySession(play.token)).toBeNull();
    const [mp] = await sql<{ player_id: string | null; name: string }[]>`
      select mp.player_id, mp.name from match_players mp join matches m on m.id = mp.match_id where m.match_key = 'acc-m1'`;
    expect(mp).toEqual({ player_id: null, name: DELETED_NAME });
    const left = (await A().account(bearer(t), ip())).body as { account: AccountView };
    expect(left.account.characters.map((c) => c.name)).toEqual(['Second', 'Third', 'Fourth']);
    // The free slot takes a new duck.
    expect((await duck(t, 'Fresh')).slot).toBe(0);
  });

  it('a guest who signs up keeps its duck and stats; its device token no longer makes guest sessions', async () => {
    const g = (await meta.createSession({ name: 'GuestDuck' }, ip())).body as { token: string; deviceToken: string; playerId: string; tag: string };
    await meta.recordMatch({ matchId: 'acc-m2', mode: 'dm', mapId: 'greybox', startedAt: Date.now() - 60_000, endedAt: Date.now(), players: [{ playerId: g.playerId, name: 'GuestDuck', isBot: false, placement: 1, kills: 7, damage: 700, survivedMs: 60_000 }] });
    expect(meta.verifySession(g.token)?.account).toBe(false);

    const s = await signUp('claim@example.com', { guestDeviceToken: g.deviceToken, guestLook: 1 });
    expect(s.claimed).toMatchObject({ id: g.playerId, name: 'GuestDuck', tag: g.tag, slot: 0, look: 1 });
    expect(s.account.characters.map((c) => c.id)).toEqual([g.playerId]);
    // The old guest session is revoked, and the device token cannot rename the duck any more.
    expect(meta.verifySession(g.token)).toBeNull();
    expect((await meta.createSession({ name: 'Hijack', deviceToken: g.deviceToken }, ip())).body).toEqual({ error: 'claimed' });
    const [p] = await sql<{ name: string }[]>`select name from players where id = ${g.playerId}`;
    expect(p?.name).toBe('GuestDuck');
    // Its stats stay with it.
    const play = (await A().play(bearer(s.accountToken), { id: g.playerId }, ip())).body as CharacterSession;
    const me = (await meta.me(`Bearer ${play.token}`, new URLSearchParams(), ip())).body as { standing: { kills: number } | null };
    expect(me.standing?.kills).toBe(7);
    // A second claim of the same guest finds nothing; a bad device token neither.
    expect((await A().claim(bearer(s.accountToken), { deviceToken: g.deviceToken }, ip())).body).toEqual({ error: 'no_guest' });
    expect((await A().claim(bearer(s.accountToken), { deviceToken: 'd1.nope.sig' }, ip())).body).toEqual({ error: 'no_guest' });

    // No free slot: the guest stays a guest.
    const full = await signUp('full@example.com');
    for (const n of ['One', 'Two', 'Three', 'Four']) await duck(full.accountToken, n);
    const g2 = (await meta.createSession({ name: 'Lonely' }, ip())).body as { deviceToken: string; token: string };
    expect((await A().claim(bearer(full.accountToken), { deviceToken: g2.deviceToken }, ip())).body).toEqual({ error: 'slots_full' });
    expect(meta.verifySession(g2.token)?.account).toBe(false);
  });

  it('a new device signs in to the same account and sees its ducks', async () => {
    const s = await signUp('device@example.com');
    await duck(s.accountToken, 'AlphaDuck');
    await duck(s.accountToken, 'BetaDuck', 1);
    const again = await signIn('DEVICE@example.com');
    expect(again.accountToken).not.toBe(s.accountToken);
    expect(again.account.characters.map((c) => [c.name, c.look])).toEqual([['AlphaDuck', 0], ['BetaDuck', 1]]);
    // Both devices stay signed in.
    expect((await A().account(bearer(s.accountToken), ip())).status).toBe(200);
  });

  it('deletes the account with an emailed code: ducks, logins, sessions and codes go; the address can start over', async () => {
    const email = 'leaving@example.com';
    const s = await signUp(email, { marketing: true });
    const d = await duck(s.accountToken, 'Leaver');
    const play = (await A().play(bearer(s.accountToken), { id: d.id }, ip())).body as CharacterSession;
    // A sign-in code is not a deletion code.
    const loginCode = await codeFor(email);
    expect((await A().deleteAccount(bearer(s.accountToken), { code: loginCode }, ip())).status).toBe(400);
    expect((await A().deleteCode(bearer(s.accountToken), { lang: 'tr' }, ip())).body).toEqual({ ok: true });
    expect(sink.lastTo(email)?.purpose).toBe('delete');
    expect(sink.lastTo(email)?.subject).toBe('Qwakk hesap silme kodun');
    const code = lastCode(email);
    expect((await A().deleteAccount(bearer(s.accountToken), { code }, ip())).body).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(sink.lastTo(email)?.purpose).toBe('deleted');

    expect((await A().account(bearer(s.accountToken), ip())).status).toBe(401);
    expect(meta.verifySession(play.token)).toBeNull();
    const rows = await sql<{ t: string; n: number }[]>`
      select 'players' as t, count(*)::int as n from players where id = ${d.id}
      union all select 'logins', count(*)::int from account_logins where subject = ${email}
      union all select 'codes', count(*)::int from login_codes where email = ${email}`;
    expect(rows.map((r) => r.n)).toEqual([0, 0, 0]);
    const [orphans] = await sql<{ n: number }[]>`select count(*)::int as n from account_sessions s left join accounts a on a.id = s.account_id where a.id is null`;
    expect(orphans?.n).toBe(0);
    // The address is free again: the next code leads to a new sign-up (issued directly: this
    // address used up its per-address code budget above).
    const next = await issueCode(sql, codeKey(SECRET), email, 'login');
    const v = (await A().verify({ email, code: next }, ip())).body as { status: string };
    expect(v.status).toBe('signup');
  });

  it('caps wrong codes per address across IPs: after 15 a day, no check and no new code', async () => {
    const email = 'guessed@example.com';
    const key = codeKey(SECRET);
    let code = await issueCode(sql, key, email, 'login');
    const wrong = () => (code === '000000' ? '111111' : '000000');
    let fails = 0;
    while (fails < VERIFY_FAILS.max) {
      const r = (await A().verify({ email, code: wrong() }, ip())).body as { error: string };
      fails++;
      // Each code allows 5 tries; a fresh one (issued directly: the per-address send limit is its own test) keeps going.
      if (r.error === 'code_locked' && fails < VERIFY_FAILS.max) code = await issueCode(sql, key, email, 'login');
    }
    // Over the cap: even the right code reads as locked, and no new code goes out (the generic "wait" answer).
    code = await issueCode(sql, key, email, 'login');
    expect((await A().verify({ email, code }, ip())).body).toEqual({ error: 'code_locked' });
    expect((await A().requestCode({ email }, ip())).body).toEqual({ error: 'code_rate_limited' });
    // Another address is not affected.
    expect((await A().requestCode({ email: 'neighbour@example.com' }, ip())).status).toBe(200);
  });

  it('a banned duck freezes its account: no hatching, claiming or deleting ducks, no account deletion', async () => {
    const s = await signUp('banned.owner@example.com');
    const d = await duck(s.accountToken, 'Rascal');
    putBan({ playerId: d.id, reason: 'test', expiresAt: null, createdAt: Date.now() });
    try {
      const t = bearer(s.accountToken);
      expect((await A().deleteCharacter(t, { id: d.id, confirm: 'Rascal' }, ip())).body).toEqual({ error: 'account_banned' });
      expect((await A().createCharacter(t, { name: 'Fresh', look: 0 }, ip())).body).toEqual({ error: 'account_banned' });
      const g = (await meta.createSession({ name: 'SideDuck' }, ip())).body as { deviceToken: string };
      expect((await A().claim(t, { deviceToken: g.deviceToken }, ip())).body).toEqual({ error: 'account_banned' });
      expect((await A().deleteCode(t, {}, ip())).body).toEqual({ error: 'account_banned' });
      expect((await A().deleteAccount(t, { code: '123456' }, ip())).body).toEqual({ error: 'account_banned' });
      expect((await A().play(t, { id: d.id }, ip())).body).toEqual({ error: 'account_banned' });
    } finally {
      dropBan(d.id);
    }
    // Ban lifted: the duck can go again.
    expect((await A().deleteCharacter(bearer(s.accountToken), { id: d.id, confirm: 'Rascal' }, ip())).body).toEqual({ ok: true });
  });

  it('serves the routes over HTTP, and the test mail hook in tests only', async () => {
    const email = 'http@example.com';
    const post = (path: string, body: unknown, token?: string) =>
      fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    expect((await post('/api/auth/code', { email })).status).toBe(200);
    const mail = (await (await fetch(`${base}/api/test/mail?email=${encodeURIComponent(email)}`)).json()) as { code: string; purpose: string };
    expect(mail.purpose).toBe('login');
    const v = (await (await post('/api/auth/verify', { email, code: mail.code })).json()) as { signupToken: string };
    const s = (await (await post('/api/auth/signup', { signupToken: v.signupToken, consent: true })).json()) as SignedIn;
    const c = (await (await post('/api/account/characters', { name: 'HttpDuck', look: 0 }, s.accountToken)).json()) as { character: CharacterView };
    expect(c.character.name).toBe('HttpDuck');
    const acc = await fetch(`${base}/api/account`, { headers: { authorization: `Bearer ${s.accountToken}` } });
    expect(acc.headers.get('cache-control')).toBe('no-store');
    expect(((await acc.json()) as { account: AccountView }).account.characters).toHaveLength(1);
    expect((await fetch(`${base}/api/account/play`)).status).toBe(405);
    expect((await post('/api/auth/logout', {}, s.accountToken)).status).toBe(200);
    expect((await fetch(`${base}/api/account`, { headers: { authorization: `Bearer ${s.accountToken}` } })).status).toBe(401);
  });

  it('migration 003 is additive: guests, matches and admin data from before stay as they were', async () => {
    const old = await freshDatabase('accmig');
    const s = postgres(old.url, { max: 2, onnotice: () => {} });
    try {
      const all = await readMigrations();
      const before = all.filter((f) => f.name < '003');
      expect(await migrate(s, before)).toEqual(['001_init.sql', '002_admin.sql']);
      await s`insert into players (id, name, tag) values ('00000000-0000-4000-8000-0000000000a1', 'OldGuest', 1234), ('00000000-0000-4000-8000-0000000000a2', 'OtherGuest', 4321)`;
      await s`insert into admin_settings (key, value) values ('dm.maxHumans', '20')`;
      await s`insert into bans (player_id, reason, created_by) values ('00000000-0000-4000-8000-0000000000a2', 'test', 'admin')`;
      expect(await migrate(s, all)).toEqual(all.filter((f) => f.name >= '003').map((f) => f.name));
      const players = await s<{ name: string; account_id: string | null; slot: number | null; look: number; level: number; xp: string }[]>`select name, account_id, slot, look, level, xp from players order by name`;
      expect(players).toEqual([
        { name: 'OldGuest', account_id: null, slot: null, look: 0, level: 1, xp: '0' },
        { name: 'OtherGuest', account_id: null, slot: null, look: 0, level: 1, xp: '0' },
      ]);
      expect((await s<{ value: unknown }[]>`select value from admin_settings where key = 'dm.maxHumans'`)[0]?.value).toBe(20);
      expect((await s<{ n: number }[]>`select count(*)::int as n from bans`)[0]?.n).toBe(1);
      // An old guest keeps working through the guest path.
      const m = new MetaService({ env: { DATABASE_URL: old.url, SESSION_SECRET: SECRET }, mailer: null });
      await m.start();
      const r = await m.createSession({ name: 'NewGuest' }, ip());
      expect(r.status).toBe(200);
      await m.stop();
    } finally {
      await s.end();
      await old.drop();
    }
  });
});
