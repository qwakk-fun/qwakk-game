/**
 * One-time sign-in codes: 6 digits from the CSPRNG, valid 10 minutes, 5
 * tries, one active code per address (a new code replaces the old one, for
 * any purpose). Only an HMAC of the code is stored: HMAC-SHA256 under a key
 * derived from SESSION_SECRET, over the purpose, the address, a per-code
 * random salt and the code, so a database dump reveals no code and a code
 * for one purpose (sign-in) never passes for another (account deletion).
 * Compares are constant time. Used and locked codes are deleted at once,
 * expired ones on the next issue.
 */
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Sql } from 'postgres';
import { CODE_DIGITS, CODE_MAX_ATTEMPTS, CODE_TTL_MS } from '@qwakk/shared/accounts';

export type CodePurpose = 'login' | 'delete';

export type CodeCheck =
  | { ok: true }
  | { ok: false; reason: 'code_wrong'; left: number }
  | { ok: false; reason: 'code_expired' | 'code_locked' };

/** The key codes are hashed with, derived from the session secret (never the secret itself). */
export function codeKey(sessionSecret: string): Buffer {
  return createHmac('sha256', sessionSecret).update('qwakk:login-code-key:v1').digest();
}

/** A fresh code: CODE_DIGITS digits, leading zeros kept, uniform (randomInt has no modulo bias). */
export function newCode(): string {
  return String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0');
}

export function hashCode(key: Buffer, purpose: CodePurpose, email: string, salt: string, code: string): string {
  return createHmac('sha256', key).update(`${purpose}\n${email}\n${salt}\n${code}`).digest('hex');
}

export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** Is this a well-formed code (exactly CODE_DIGITS ASCII digits)? */
export function isCodeShape(code: unknown): code is string {
  return typeof code === 'string' && new RegExp(`^\\d{${CODE_DIGITS}}$`).test(code);
}

/** Make and store a new code for `email` (the old one stops working). Returns the code to send. */
export async function issueCode(sql: Sql, key: Buffer, email: string, purpose: CodePurpose, nowMs = Date.now()): Promise<string> {
  const code = newCode();
  const salt = randomBytes(16).toString('hex');
  const hash = hashCode(key, purpose, email, salt, code);
  const expires = new Date(nowMs + CODE_TTL_MS);
  await sql`delete from login_codes where expires_at < now()`;
  await sql`
    insert into login_codes (email, purpose, code_hash, salt, attempts, created_at, expires_at)
    values (${email}, ${purpose}, ${hash}, ${salt}, 0, ${new Date(nowMs)}, ${expires})
    on conflict (email) do update set purpose = excluded.purpose, code_hash = excluded.code_hash, salt = excluded.salt,
      attempts = 0, created_at = excluded.created_at, expires_at = excluded.expires_at`;
  return code;
}

/**
 * Check a typed code. Right: the code is used up (deleted). Wrong: one try
 * fewer, and the code is deleted after the last one. Missing or expired
 * reads the same (`code_expired`), whatever the address.
 */
export async function checkCode(sql: Sql, key: Buffer, email: string, purpose: CodePurpose, code: string, nowMs = Date.now()): Promise<CodeCheck> {
  return sql.begin(async (tx) => {
    const [row] = await tx<{ purpose: string; code_hash: string; salt: string; attempts: number; expires_at: Date }[]>`
      select purpose, code_hash, salt, attempts, expires_at from login_codes where email = ${email} for update`;
    if (!row) return { ok: false, reason: 'code_expired' } as const;
    if (row.expires_at.getTime() <= nowMs) {
      await tx`delete from login_codes where email = ${email}`;
      return { ok: false, reason: 'code_expired' } as const;
    }
    // Hash first, compare in constant time; the purpose is inside the hash, so a delete code fails a sign-in.
    const right = sameHash(hashCode(key, purpose, email, row.salt, code), row.code_hash) && row.purpose === purpose;
    if (right) {
      await tx`delete from login_codes where email = ${email}`;
      return { ok: true } as const;
    }
    const attempts = row.attempts + 1;
    if (attempts >= CODE_MAX_ATTEMPTS) {
      await tx`delete from login_codes where email = ${email}`;
      return { ok: false, reason: 'code_locked' } as const;
    }
    await tx`update login_codes set attempts = ${attempts} where email = ${email}`;
    return { ok: false, reason: 'code_wrong', left: CODE_MAX_ATTEMPTS - attempts } as const;
  });
}
