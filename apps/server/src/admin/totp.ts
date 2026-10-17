/**
 * Time-based one-time passwords (RFC 6238 over RFC 4226): HMAC-SHA1, 6
 * digits, 30 second steps, what every authenticator app does by default.
 *
 * A code is accepted for the current step and one step either side (clock
 * drift), and each step only once: `TotpGuard` remembers the last step that
 * logged in, and a code from that step or an older one is refused (replay).
 * The guard lives in memory (one server instance).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const TOTP = { digits: 6, stepSeconds: 30, window: 1 } as const;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Decode base32 (case-insensitive, spaces and padding ignored); null on a bad character. */
export function base32Decode(s: string): Buffer | null {
  const clean = s.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) return null;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The code for one time step (HOTP of the step counter). */
export function hotp(secret: Buffer, counter: number, digits: number = TOTP.digits): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const off = mac[mac.length - 1]! & 0x0f;
  const bin = ((mac[off]! & 0x7f) << 24) | (mac[off + 1]! << 16) | (mac[off + 2]! << 8) | mac[off + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function stepAt(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP.stepSeconds);
}

/**
 * The step a code matches (within the window), or null. Every step in the
 * window is computed and compared in constant time, whatever matches first.
 */
export function matchStep(secret: Buffer, code: unknown, nowMs: number): number | null {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const now = stepAt(nowMs);
  let found: number | null = null;
  for (let d = -TOTP.window; d <= TOTP.window; d++) {
    const s = now + d;
    const ok = timingSafeEqual(Buffer.from(hotp(secret, s)), Buffer.from(code));
    if (ok && found === null) found = s;
  }
  return found;
}

/** Remembers the last step used, so no code can log in twice. */
export class TotpGuard {
  private lastStep = -1;
  private readonly secret: Buffer;

  constructor(secret: Buffer) {
    this.secret = secret;
  }

  /** Check a code; on success the step is used up. Call only once the password matched. */
  use(code: unknown, nowMs = Date.now()): boolean {
    const step = matchStep(this.secret, code, nowMs);
    if (step === null || step <= this.lastStep) return false;
    this.lastStep = step;
    return true;
  }
}

/** otpauth:// URI for authenticator apps (and the setup QR code). */
export function otpauthUri(secretB32: string, account = 'admin', issuer = 'Qwakk Game'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({ secret: secretB32, issuer, algorithm: 'SHA1', digits: String(TOTP.digits), period: String(TOTP.stepSeconds) });
  return `otpauth://totp/${label}?${q.toString()}`;
}
