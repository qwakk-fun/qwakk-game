/**
 * Account pieces without a database: code making and hashing, the account
 * session and sign-up tokens, the game session's account claims, email
 * normalisation, the emails, the revocation list, the matchmaking account
 * check and the test-hooks route being off by default.
 */
import { describe, expect, it } from 'vitest';
import { ACCOUNT_ERROR, normalizeEmail } from '@qwakk/shared/accounts';
import { codeKey, hashCode, isCodeShape, newCode, sameHash } from '../../src/meta/accounts/codes.ts';
import { DevMailSink, maskEmail, senderAddress, SmtpMailer } from '../../src/meta/accounts/mail.ts';
import { codeMail, deletedMail } from '../../src/meta/accounts/mailText.ts';
import { clearRevoked, isRevoked, revokeGuestSessions, revokeSessions } from '../../src/meta/accounts/revoked.ts';
import { ACCOUNT_SESSION_MS, signAccountSession, signSignupTicket, verifyAccountSession, verifySignupTicket } from '../../src/meta/accounts/tokens.ts';
import { checkAccount } from '../../src/matchmaking.ts';
import { MetaService } from '../../src/meta/service.ts';
import { signSession, verifySessionToken } from '../../src/meta/token.ts';

const SECRET = 'unit-test-secret-unit-test-secret-1234';
const ACC = '11111111-1111-4111-8111-111111111111';
const SID = '22222222-2222-4222-8222-222222222222';

describe('sign-in codes', () => {
  it('are 6 digits, uniform-looking and keep leading zeros', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = newCode();
      expect(c).toMatch(/^\d{6}$/);
      seen.add(c);
    }
    expect(seen.size).toBeGreaterThan(1990);
    expect(isCodeShape('012345')).toBe(true);
    for (const bad of ['12345', '1234567', '12345a', ' 123456', 123456, null]) expect(isCodeShape(bad)).toBe(false);
  });

  it('are hashed with the purpose, the address and a salt under a derived key', () => {
    const key = codeKey(SECRET);
    expect(key.equals(Buffer.from(SECRET))).toBe(false);
    const h = hashCode(key, 'login', 'a@b.co', 'salt', '123456');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('123456');
    expect(sameHash(h, hashCode(key, 'login', 'a@b.co', 'salt', '123456'))).toBe(true);
    expect(sameHash(h, hashCode(key, 'delete', 'a@b.co', 'salt', '123456'))).toBe(false);
    expect(sameHash(h, hashCode(key, 'login', 'a@b.co', 'salt2', '123456'))).toBe(false);
    expect(sameHash(h, hashCode(key, 'login', 'x@b.co', 'salt', '123456'))).toBe(false);
    expect(sameHash(h, hashCode(codeKey('another-secret-another-secret-xx'), 'login', 'a@b.co', 'salt', '123456'))).toBe(false);
    expect(sameHash(h, '')).toBe(false);
  });
});

describe('account tokens', () => {
  it('sign and verify an account session; refuse forged, expired and other kinds', () => {
    const now = 1_700_000_000_000;
    const exp = now + ACCOUNT_SESSION_MS;
    const t = signAccountSession(SECRET, SID, ACC, exp);
    expect(verifyAccountSession(SECRET, t, now)).toEqual({ sessionId: SID, accountId: ACC, expiresAt: Math.floor(exp / 1000) * 1000 });
    expect(verifyAccountSession(SECRET, t, exp + 1000)).toBeNull();
    expect(verifyAccountSession('another-secret-another-secret-xx', t, now)).toBeNull();
    const [p, body, sig] = t.split('.') as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ s: SID, a: '33333333-3333-4333-8333-333333333333', e: 9e9 })).toString('base64url');
    expect(verifyAccountSession(SECRET, `${p}.${forged}.${sig}`, now)).toBeNull();
    expect(verifyAccountSession(SECRET, `${p}.${body}.${sig.slice(1)}x`, now)).toBeNull();
    // A game session or a sign-up ticket never passes as an account session (and back).
    const game = signSession(SECRET, { playerId: ACC, name: 'Duck', tag: '1234' }, now).token;
    expect(verifyAccountSession(SECRET, game, now)).toBeNull();
    expect(verifySessionToken(SECRET, t, now)).toBeNull();
    const ticket = signSignupTicket(SECRET, 'a@b.co', now).token;
    expect(verifyAccountSession(SECRET, ticket, now)).toBeNull();
    expect(verifySignupTicket(SECRET, t, now)).toBeNull();
    expect(verifySignupTicket(SECRET, ticket, now)).toBe('a@b.co');
    expect(verifySignupTicket(SECRET, ticket, now + 16 * 60_000)).toBeNull();
  });

  it('game sessions carry the account flag and the look; old guest tokens read as guests', () => {
    const now = Date.now();
    const acc = signSession(SECRET, { playerId: ACC, name: 'Duck', tag: '1234', account: true, look: 1 }, now).token;
    expect(verifySessionToken(SECRET, acc, now)).toMatchObject({ playerId: ACC, account: true, look: 1 });
    const guest = signSession(SECRET, { playerId: ACC, name: 'Duck', tag: '1234' }, now).token;
    const g = verifySessionToken(SECRET, guest, now);
    expect(g?.account).toBe(false);
    expect(g && 'look' in g).toBe(false);
  });
});

describe('emails', () => {
  it('normalises addresses: trimmed and lower case, dots and plus parts kept', () => {
    expect(normalizeEmail('  John.Doe+Qwakk@Example.COM ')).toBe('john.doe+qwakk@example.com');
    expect(normalizeEmail("o'neil.x_y-z!#$%&*/=?^`{|}~@sub-1.example.co.uk")).toBe("o'neil.x_y-z!#$%&*/=?^`{|}~@sub-1.example.co.uk");
    for (const bad of ['', 'no-at', 'a@b', 'a@@b.co', 'a b@c.co', 'a@b..co', `${'x'.repeat(65)}@b.co`, 42, null]) expect(normalizeEmail(bad)).toBeNull();
    // Nothing a mail library could re-parse as a display name, a group or a second recipient.
    for (const bad of ['x<a@evil.com>', 'evil,victim@gmail.com', 'a@evil.com;b@victim.com', 'name (c) @x.co', '"quoted"@x.co', 'a@x.co>', 'a(b)@x.co', 'a@-x.co', 'a@x-.co', 'a@x.c0', '.a@x.co', 'a.@x.co', 'a..b@x.co', 'a@x.co\nBcc: b@y.co'])
      expect(normalizeEmail(bad), bad).toBeNull();
    expect(senderAddress('Qwakk <noreply@qwakk.fun>')).toBe('noreply@qwakk.fun');
    expect(senderAddress('noreply@qwakk.fun')).toBe('noreply@qwakk.fun');
  });

  it('puts the code in the body, never the subject, in both languages', () => {
    for (const lang of ['en', 'tr'] as const) {
      for (const purpose of ['login', 'delete'] as const) {
        const m = codeMail('042137', lang, purpose);
        expect(m.subject).not.toContain('042137');
        expect(m.text).toContain('042137');
        expect(m.html).toContain('042137');
        expect(m.html).not.toMatch(/<img|<script|https?:\/\/[^"]*track/i);
        expect(`${m.subject}${m.text}${m.html}`).not.toContain('—');
      }
    }
    expect(codeMail('1', 'en', 'login').subject).toBe('Your Qwakk sign-in code');
    expect(deletedMail('tr').subject).toBe('Qwakk hesabın silindi');
    expect(maskEmail('someone@example.com')).toBe('s***@example.com');
  });

  it('hands nodemailer the recipient as an address object with an explicit envelope', async () => {
    const sent: Record<string, unknown>[] = [];
    const fake = { sendMail: async (o: Record<string, unknown>) => void sent.push(o) } as unknown as ConstructorParameters<typeof SmtpMailer>[2];
    const mailer = new SmtpMailer({ host: 'smtp.example', port: 465, user: 'noreply@qwakk.fun', pass: 'x' }, 'Qwakk <noreply@qwakk.fun>', fake);
    await mailer.send({ to: 'duck@example.com', ...codeMail('123456', 'en', 'login') });
    expect(sent[0]?.to).toEqual({ name: '', address: 'duck@example.com' });
    expect(sent[0]?.envelope).toEqual({ from: 'noreply@qwakk.fun', to: ['duck@example.com'] });
  });

  it('the dev sink keeps the last code per address', async () => {
    const sink = new DevMailSink({ quiet: true });
    await sink.send({ to: 'a@b.co', ...codeMail('111111', 'en', 'login'), code: '111111', purpose: 'login' });
    await sink.send({ to: 'a@b.co', ...codeMail('222222', 'en', 'login'), code: '222222', purpose: 'login' });
    expect(sink.lastTo('a@b.co')?.code).toBe('222222');
    expect(sink.lastTo('c@d.co')).toBeNull();
  });
});

describe('revoked game sessions', () => {
  it('refuses sessions issued before the revocation, accepts later ones', () => {
    clearRevoked();
    const now = 1_700_000_000_500;
    revokeSessions(ACC, now);
    expect(isRevoked(ACC, now - 5000, true, now)).toBe(true);
    expect(isRevoked(ACC, Math.floor(now / 1000) * 1000, true, now)).toBe(true);
    expect(isRevoked(ACC, now + 1000, true, now)).toBe(false);
    expect(isRevoked(SID, now - 5000, false, now)).toBe(false);
    // Forgotten after every session it could hit has expired anyway.
    expect(isRevoked(ACC, now - 5000, true, now + 26 * 3600_000)).toBe(false);
    // A claimed guest: its guest sessions stop, its account sessions (even this second) work.
    revokeGuestSessions(SID, now);
    expect(isRevoked(SID, now - 5000, false, now)).toBe(true);
    expect(isRevoked(SID, now - 5000, true, now)).toBe(false);
    clearRevoked();
  });
});

describe('matchmaking account check', () => {
  const who = { guest: { playerId: 'g', account: false }, acc: { playerId: 'a', account: true }, lead: { playerId: 'l', account: true } } as const;
  const o = {
    accountOnly: {
      rooms: ['br'],
      identify: async (t: string | undefined) => (t ? (who[t as keyof typeof who] ?? null) : null),
      partyHasGuest: (id: string) => id === 'l',
      roomNameOf: (id: string) => (id === 'room1' ? 'br' : id === 'dm1' ? 'dm' : undefined),
    },
  };
  const code = async (method: string, room: string, options: Record<string, unknown>): Promise<number> => {
    try {
      await checkAccount(method, room, options, o);
      return 0;
    } catch (err) {
      return (err as { code?: number }).code ?? -1;
    }
  };

  it('refuses guests and parties with a guest a battle royale room, by any method', async () => {
    expect(await code('create', 'br', { token: 'guest' })).toBe(ACCOUNT_ERROR.needsAccount);
    expect(await code('joinOrCreate', 'br', { token: 'guest' })).toBe(ACCOUNT_ERROR.needsAccount);
    expect(await code('joinById', 'room1', { token: 'guest' })).toBe(ACCOUNT_ERROR.needsAccount);
    expect(await code('create', 'br', { token: 'lead' })).toBe(ACCOUNT_ERROR.partyHasGuest);
    expect(await code('create', 'br', { token: 'acc' })).toBe(0);
    // Deathmatch, other rooms and invalid tokens (the room refuses those) pass here.
    expect(await code('joinOrCreate', 'dm', { token: 'guest' })).toBe(0);
    expect(await code('joinById', 'dm1', { token: 'guest' })).toBe(0);
    expect(await code('create', 'br', { token: 'nobody' })).toBe(0);
  });
});

describe('test hooks route', () => {
  it('is a 404 unless QWAKK_TEST_HOOKS=1 outside production', () => {
    const q = new URLSearchParams('email=a@b.co');
    expect(new MetaService({ env: { SESSION_SECRET: SECRET } }).accounts.testMail(q).status).toBe(404);
    expect(new MetaService({ env: { SESSION_SECRET: SECRET, NODE_ENV: 'production', QWAKK_TEST_HOOKS: '1' } }).accounts.testMail(q).status).toBe(404);
    const on = new MetaService({ env: { SESSION_SECRET: SECRET, QWAKK_TEST_HOOKS: '1' }, mailer: new DevMailSink({ quiet: true }) });
    expect(on.accounts.testMail(q).status).toBe(404); // nothing sent yet
  });

  it('production without SMTP has no mailer: sending a code is a 503, never a fake success', async () => {
    const prod = new MetaService({ env: { SESSION_SECRET: SECRET, NODE_ENV: 'production' }, mailer: null });
    // No database either: the address check runs first, then 503.
    expect((await prod.accounts.requestCode({ email: 'nope' }, '10.0.0.1')).status).toBe(400);
    expect((await prod.accounts.requestCode({ email: 'a@b.co' }, '10.0.0.1')).status).toBe(503);
  });
});
