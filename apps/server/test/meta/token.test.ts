import { describe, expect, it } from 'vitest';
import { hexToUuid, isUuid, mintDeviceToken, signSession, verifyDeviceToken, verifySessionToken } from '../../src/meta/token.ts';

const SECRET = 'test-secret-test-secret-test-secret-1234';
const id = { playerId: '2c261a2d-6132-4e99-ade1-18b2a15f9f5e', name: 'Duck', tag: '1234' };

function flip(s: string, at: number): string {
  const c = s[at] === 'A' ? 'B' : 'A';
  return s.slice(0, at) + c + s.slice(at + 1);
}

describe('session tokens', () => {
  it('round-trips the claims', () => {
    const { token, expiresAt } = signSession(SECRET, id, 1_000_000);
    const c = verifySessionToken(SECRET, token, 1_000_000 + 1000);
    expect(c).toMatchObject(id);
    expect(c?.expiresAt).toBe(expiresAt);
  });

  it('rejects tampered payloads and signatures', () => {
    const { token } = signSession(SECRET, id);
    const [v, body, sig] = token.split('.') as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), n: 'Admin' })).toString('base64url');
    expect(verifySessionToken(SECRET, `${v}.${forged}.${sig}`)).toBeNull();
    expect(verifySessionToken(SECRET, `${v}.${body}.${flip(sig, 5)}`)).toBeNull();
    expect(verifySessionToken(SECRET, `${v}.${flip(body, 3)}.${sig}`)).toBeNull();
    expect(verifySessionToken('another-secret-another-secret-12345', token)).toBeNull();
  });

  it('rejects expired, malformed and oversized tokens', () => {
    const { token } = signSession(SECRET, id, 0, 60);
    expect(verifySessionToken(SECRET, token, 61_000)).toBeNull();
    for (const bad of ['', 'x', 's1..', 's1.a.b.c', 'd1.abc.def', 'x'.repeat(5000), 42, null, undefined, {}]) expect(verifySessionToken(SECRET, bad)).toBeNull();
  });

  it('never accepts a device token as a session and vice versa', () => {
    const d = mintDeviceToken(SECRET);
    const [, hex, sig] = d.token.split('.');
    expect(verifySessionToken(SECRET, `s1.${hex}.${sig}`)).toBeNull();
    const { token } = signSession(SECRET, id);
    const [, body, ssig] = token.split('.');
    expect(verifyDeviceToken(SECRET, `d1.${body}.${ssig}`)).toBeNull();
  });
});

describe('device tokens', () => {
  it('carries the player id and verifies', () => {
    const d = mintDeviceToken(SECRET);
    expect(isUuid(d.playerId)).toBe(true);
    expect(d.playerId[14]).toBe('4');
    expect(verifyDeviceToken(SECRET, d.token)).toBe(d.playerId);
  });

  it('rejects forged ids and signatures', () => {
    const d = mintDeviceToken(SECRET);
    const [, hex, sig] = d.token.split('.') as [string, string, string];
    const other = (hex[0] === 'a' ? 'b' : 'a') + hex.slice(1);
    expect(verifyDeviceToken(SECRET, `d1.${other}.${sig}`)).toBeNull();
    expect(verifyDeviceToken(SECRET, `d1.${hex}.${flip(sig, 0)}`)).toBeNull();
    expect(verifyDeviceToken('another-secret-another-secret-12345', d.token)).toBeNull();
    expect(verifyDeviceToken(SECRET, 'd1.nothex.sig')).toBeNull();
  });

  it('formats UUIDs', () => {
    expect(hexToUuid('2c261a2d61324e99ade118b2a15f9f5e')).toBe('2c261a2d-6132-4e99-ade1-18b2a15f9f5e');
    expect(isUuid('dev-abc')).toBe(false);
  });
});
