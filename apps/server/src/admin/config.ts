/**
 * Admin panel settings from the environment. The panel exists only when both
 * secrets are set and valid; otherwise every /admin path is a plain 404, as if
 * there were no panel at all.
 *
 *   ADMIN_PASSWORD_HASH  scrypt hash of the admin password (npm run admin:setup)
 *   ADMIN_TOTP_SECRET    base32 TOTP secret for the authenticator app (npm run admin:setup)
 *   QWAKK_ADMIN_DIR      the built admin UI (default apps/admin/dist; the image sets /srv/admin)
 *
 * Secrets live only in the server environment (CapRover), never in the repo,
 * an image or a log.
 */
import { fileURLToPath } from 'node:url';
import { parseHash, type ScryptHash } from './password.ts';
import { base32Decode } from './totp.ts';

export interface AdminConfig {
  passwordHash: ScryptHash;
  totpSecret: Buffer;
  uiDir: string;
  production: boolean;
}

export const DEFAULT_UI_DIR = fileURLToPath(new URL('../../../admin/dist/', import.meta.url));

/** The admin config, or null (panel off) with the reason in `why`. */
export function loadAdminConfig(env: NodeJS.ProcessEnv = process.env): { config: AdminConfig | null; why: string } {
  const rawHash = env.ADMIN_PASSWORD_HASH?.trim();
  const rawTotp = env.ADMIN_TOTP_SECRET?.trim();
  if (!rawHash || !rawTotp) return { config: null, why: 'ADMIN_PASSWORD_HASH and ADMIN_TOTP_SECRET are not both set' };
  const passwordHash = parseHash(rawHash);
  if (!passwordHash) return { config: null, why: 'ADMIN_PASSWORD_HASH is not a valid scrypt hash (run npm run admin:setup)' };
  const totpSecret = base32Decode(rawTotp);
  if (!totpSecret || totpSecret.length < 16) return { config: null, why: 'ADMIN_TOTP_SECRET is not base32 of at least 16 bytes (run npm run admin:setup)' };
  return {
    config: { passwordHash, totpSecret, uiDir: env.QWAKK_ADMIN_DIR?.trim() || DEFAULT_UI_DIR, production: env.NODE_ENV === 'production' },
    why: '',
  };
}
