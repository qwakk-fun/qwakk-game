/**
 * Admin login building blocks: the scrypt password hash, TOTP (RFC 6238
 * vectors, the drift window, replay), the lockout and the signed session
 * cookie (tampering, expiry, idle time, logout).
 */
import { describe, expect, it } from 'vitest';
import { loadAdminConfig } from '../../src/admin/config.ts';
import { LoginLockout, LOCKOUT } from '../../src/admin/lockout.ts';
import { hashPassword, parseHash, verifyPassword } from '../../src/admin/password.ts';
import { AdminSessions, clearCookie, COOKIE_NAME, readCookie, sessionCookie } from '../../src/admin/sessions.ts';
import { base32Decode, base32Encode, hotp, matchStep, otpauthUri, TotpGuard } from '../../src/admin/totp.ts';

const FAST = { logN: 14, r: 8, p: 1, keyLen: 32, saltLen: 16 } as const;

describe('admin password hash', () => {
  it('verifies the right password and refuses a wrong one', async () => {
    const enc = await hashPassword('correct horse battery', FAST);
    expect(enc).toMatch(/^scrypt:14:8:1:[\w-]+:[\w-]+$/);
    const h = parseHash(enc)!;
    expect(h).not.toBeNull();
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('correct horse batterz', h)).toBe(false);
    expect(await verifyPassword('', h)).toBe(false);
    expect(await verifyPassword(undefined, h)).toBe(false);
    expect(await verifyPassword(12345, h)).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same password', FAST)).not.toBe(await hashPassword('same password', FAST));
  });

  it('refuses malformed hashes and unsafe parameters', () => {
    expect(parseHash('')).toBeNull();
    expect(parseHash('scrypt:15:8:1:abc')).toBeNull();
    expect(parseHash('bcrypt:15:8:1:aaaaaaaaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')).toBeNull();
    const salt = Buffer.alloc(16, 1).toString('base64url');
    const hash = Buffer.alloc(32, 2).toString('base64url');
    expect(parseHash(`scrypt:15:8:1:${salt}:${hash}`)).not.toBeNull();
    expect(parseHash(`scrypt:30:8:1:${salt}:${hash}`)).toBeNull(); // a memory bomb
    expect(parseHash(`scrypt:10:8:1:${salt}:${hash}`)).toBeNull(); // too weak
    expect(parseHash(`scrypt:15:8:1:${Buffer.alloc(4).toString('base64url')}:${hash}`)).toBeNull();
  });
});

describe('TOTP', () => {
  // RFC 6238 appendix B, SHA-1 secret "12345678901234567890" (8 digits there; the last 6 here).
  const secret = Buffer.from('12345678901234567890');
  it('matches the RFC 6238 test vectors', () => {
    expect(hotp(secret, Math.floor(59 / 30), 8)).toBe('94287082');
    expect(hotp(secret, Math.floor(1111111109 / 30), 8)).toBe('07081804');
    expect(hotp(secret, Math.floor(1234567890 / 30), 8)).toBe('89005924');
    expect(hotp(secret, Math.floor(2000000000 / 30), 8)).toBe('69279037');
    expect(hotp(secret, Math.floor(59 / 30))).toBe('287082');
  });

  it('round-trips base32 and builds an otpauth URI', () => {
    const raw = Buffer.from('a secret of twenty b');
    expect(base32Decode(base32Encode(raw))).toEqual(raw);
    expect(base32Decode('JBSW Y3DP ehpk3pxp')).toEqual(base32Decode('JBSWY3DPEHPK3PXP'));
    expect(base32Decode('not base32!')).toBeNull();
    expect(otpauthUri('JBSWY3DPEHPK3PXP')).toMatch(/^otpauth:\/\/totp\/Qwakk%20Game%3Aadmin\?secret=JBSWY3DPEHPK3PXP&issuer=Qwakk\+Game/);
  });

  it('accepts one step of drift either way, nothing more', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(matchStep(secret, hotp(secret, step), now)).toBe(step);
    expect(matchStep(secret, hotp(secret, step - 1), now)).toBe(step - 1);
    expect(matchStep(secret, hotp(secret, step + 1), now)).toBe(step + 1);
    expect(matchStep(secret, hotp(secret, step - 2), now)).toBeNull();
    expect(matchStep(secret, hotp(secret, step + 2), now)).toBeNull();
    expect(matchStep(secret, '12345', now)).toBeNull();
    expect(matchStep(secret, 123456, now)).toBeNull();
  });

  it('never accepts a code twice, nor an older one after a newer one (replay)', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    const guard = new TotpGuard(secret);
    expect(guard.use(hotp(secret, step), now)).toBe(true);
    expect(guard.use(hotp(secret, step), now)).toBe(false);
    expect(guard.use(hotp(secret, step), now + 10_000)).toBe(false);
    expect(guard.use(hotp(secret, step - 1), now)).toBe(false);
    expect(guard.use(hotp(secret, step + 1), now + 30_000)).toBe(true);
    expect(guard.use('000000', now)).toBe(false);
  });
});

describe('login lockout', () => {
  it('locks an address after repeated failures, then doubles', () => {
    const l = new LoginLockout();
    const t = 1_000_000;
    for (let i = 0; i < LOCKOUT.ipFailures - 1; i++) l.failure('203.0.113.5', t + i);
    expect(l.retryAfterMs('203.0.113.5', t + 10)).toBe(0);
    l.failure('203.0.113.5', t + 10);
    expect(l.retryAfterMs('203.0.113.5', t + 10)).toBe(LOCKOUT.ipLockMs);
    expect(l.retryAfterMs('198.51.100.9', t + 10)).toBe(0); // another address is not locked
    const later = t + LOCKOUT.ipLockMs + 20;
    expect(l.retryAfterMs('203.0.113.5', later)).toBe(0);
    for (let i = 0; i < LOCKOUT.ipFailures; i++) l.failure('203.0.113.5', later + i);
    expect(l.retryAfterMs('203.0.113.5', later + LOCKOUT.ipFailures)).toBe(LOCKOUT.ipLockMs * 2 - 1);
  });

  it('a success clears the failures of that address', () => {
    const l = new LoginLockout();
    for (let i = 0; i < LOCKOUT.ipFailures - 1; i++) l.failure('203.0.113.6', i);
    l.success('203.0.113.6');
    l.failure('203.0.113.6', 100);
    expect(l.retryAfterMs('203.0.113.6', 100)).toBe(0);
  });

  it('locks every login when failures come from many addresses (global backoff)', () => {
    const l = new LoginLockout();
    for (let i = 0; i <= LOCKOUT.globalFailures; i++) l.failure(`198.51.100.${i}`, 5000 + i);
    const at = 5000 + LOCKOUT.globalFailures;
    expect(l.retryAfterMs('192.0.2.1', at)).toBe(LOCKOUT.globalLockMs);
    expect(l.retryAfterMs('192.0.2.1', at + LOCKOUT.globalLockMs)).toBe(0);
  });

  it('counts an IPv6 /64 as one address', () => {
    const l = new LoginLockout();
    for (let i = 0; i < LOCKOUT.ipFailures; i++) l.failure(`2001:db8:1:2::${i + 1}`, i);
    expect(l.retryAfterMs('2001:db8:1:2:ffff::1', 10)).toBeGreaterThan(0);
  });
});

describe('admin session cookie', () => {
  it('signs, verifies and revokes', () => {
    const s = new AdminSessions();
    const { session, cookie } = s.create(1000);
    expect(s.verify(cookie, 2000)?.id).toBe(session.id);
    s.revoke(session.id);
    expect(s.verify(cookie, 3000)).toBeNull();
  });

  it('refuses a tampered cookie, a cookie from another process and junk', () => {
    const s = new AdminSessions();
    const { cookie } = s.create(1000);
    const parts = cookie.split('.');
    expect(s.verify([parts[0], parts[1], String(Number(parts[2]) + 3600), parts[3]].join('.'), 2000)).toBeNull();
    expect(s.verify(cookie.slice(0, -2) + (cookie.endsWith('AA') ? 'BB' : 'AA'), 2000)).toBeNull();
    expect(new AdminSessions().verify(cookie, 2000)).toBeNull();
    expect(s.verify(undefined)).toBeNull();
    expect(s.verify('v1.x.y')).toBeNull();
    expect(s.verify('x'.repeat(500))).toBeNull();
  });

  it('expires after its lifetime and after idle time', () => {
    const s = new AdminSessions(10_000, 4_000);
    const a = s.create(0);
    expect(s.verify(a.cookie, 3_000)).not.toBeNull();
    expect(s.verify(a.cookie, 6_500)).not.toBeNull(); // touched at 3 s, so idle until 7 s
    expect(s.verify(a.cookie, 10_500)).toBeNull(); // past the 10 s lifetime
    const b = s.create(20_000);
    expect(s.verify(b.cookie, 24_500)).toBeNull(); // idle for 4.5 s
  });

  it('sets the cookie HttpOnly, Secure, SameSite=Strict with the __Host- prefix, and clears it', () => {
    const c = sessionCookie('v1.a.b.c', 12 * 3600_000);
    expect(c).toBe(`${COOKIE_NAME}=v1.a.b.c; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Strict`);
    expect(COOKIE_NAME.startsWith('__Host-')).toBe(true);
    expect(clearCookie()).toContain('Max-Age=0');
    expect(readCookie(`a=1; ${COOKIE_NAME}=v1.x.y.z; b=2`)).toBe('v1.x.y.z');
    expect(readCookie('a=1')).toBeUndefined();
  });

  it('gives each session an audit label that is not the session id', () => {
    const s = new AdminSessions();
    const { session } = s.create();
    expect(session.actor).toMatch(/^admin@[0-9a-f]{4}$/);
    expect(session.actor).not.toContain(session.id);
  });
});

describe('admin config', () => {
  it('is off unless both secrets are set and valid', async () => {
    expect(loadAdminConfig({}).config).toBeNull();
    expect(loadAdminConfig({ ADMIN_TOTP_SECRET: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' }).config).toBeNull();
    const hash = await hashPassword('a long admin password', FAST);
    expect(loadAdminConfig({ ADMIN_PASSWORD_HASH: hash }).config).toBeNull();
    expect(loadAdminConfig({ ADMIN_PASSWORD_HASH: 'nope', ADMIN_TOTP_SECRET: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' }).config).toBeNull();
    expect(loadAdminConfig({ ADMIN_PASSWORD_HASH: hash, ADMIN_TOTP_SECRET: 'JBSWY3DP' }).config).toBeNull(); // too short
    expect(loadAdminConfig({ ADMIN_PASSWORD_HASH: hash, ADMIN_TOTP_SECRET: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' }).config).not.toBeNull();
  });
});
