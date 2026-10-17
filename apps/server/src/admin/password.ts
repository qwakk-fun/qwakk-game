/**
 * The admin password hash: Node's scrypt with a random salt, its parameters
 * encoded in the value so they can change later without breaking old hashes.
 *
 *   scrypt:<log2 N>:<r>:<p>:<salt base64url>:<hash base64url>
 *
 * Colons, not dollar signs, so the value pastes into a shell or an env file
 * without quoting. Verification runs scrypt on the libuv thread pool (async),
 * so a login never stalls the game's tick loop, and compares in constant time.
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

export const SCRYPT_DEFAULTS = { logN: 15, r: 8, p: 1, keyLen: 32, saltLen: 16 } as const;

export interface ScryptHash {
  logN: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function derive(password: string, salt: Buffer, logN: number, r: number, p: number, keyLen: number): Promise<Buffer> {
  const N = 2 ** logN;
  const opts: ScryptOptions = { N, r, p, maxmem: 256 * N * r + 1024 * 1024 };
  return new Promise((resolve, reject) => scrypt(password.normalize('NFKC'), salt, keyLen, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

export interface ScryptParams {
  logN: number;
  r: number;
  p: number;
  keyLen: number;
  saltLen: number;
}

export async function hashPassword(password: string, o: ScryptParams = SCRYPT_DEFAULTS): Promise<string> {
  const salt = randomBytes(o.saltLen);
  const hash = await derive(password, salt, o.logN, o.r, o.p, o.keyLen);
  return `scrypt:${o.logN}:${o.r}:${o.p}:${salt.toString('base64url')}:${hash.toString('base64url')}`;
}

/** Parse an encoded hash; null when it is not one we accept (parameters out of a sane range). */
export function parseHash(encoded: string): ScryptHash | null {
  const parts = encoded.trim().split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [logN, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  // Bounds keep a bad env value from turning every login into a memory or CPU bomb.
  if (!Number.isInteger(logN) || logN < 14 || logN > 20) return null;
  if (!Number.isInteger(r) || r < 8 || r > 32 || !Number.isInteger(p) || p < 1 || p > 4) return null;
  const salt = Buffer.from(parts[4]!, 'base64url');
  const hash = Buffer.from(parts[5]!, 'base64url');
  if (salt.length < 16 || hash.length < 32 || hash.length > 64) return null;
  return { logN, r, p, salt, hash };
}

/** Does `password` match the hash? Constant-time compare; never throws. */
export async function verifyPassword(password: unknown, h: ScryptHash): Promise<boolean> {
  // A wrong type still costs a full derive, so the answer time says nothing.
  const pw = typeof password === 'string' && password.length <= 1024 ? password : '';
  try {
    const got = await derive(pw, h.salt, h.logN, h.r, h.p, h.hash.length);
    return timingSafeEqual(got, h.hash) && pw.length > 0;
  } catch {
    return false;
  }
}
