/**
 * npm run admin:setup: make the two admin panel secrets.
 *
 * Asks for a password (twice, hidden), then prints ADMIN_PASSWORD_HASH (scrypt)
 * and ADMIN_TOTP_SECRET (a fresh random base32 secret), the otpauth:// URI and
 * a QR code to scan with an authenticator app. Writes nothing to disk: copy
 * the two lines into the CapRover app's environment variables, then clear the
 * terminal. Running it again makes new secrets (re-add the account in the app).
 */
import { randomBytes } from 'node:crypto';
import { stdin, stdout } from 'node:process';
import { emitKeypressEvents } from 'node:readline';
import { hashPassword } from '../apps/server/src/admin/password.ts';
import { base32Encode, otpauthUri } from '../apps/server/src/admin/totp.ts';
import { qrTerminal } from './qr.ts';

const MIN_LENGTH = 4;

/** Read a line without echoing it (a TTY in raw mode). */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY) {
      reject(new Error('run this in a terminal (the password is read without echo)'));
      return;
    }
    stdout.write(prompt);
    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    let value = '';
    const done = (fn: () => void): void => {
      stdin.off('keypress', onKey);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      fn();
    };
    const onKey = (str: string | undefined, key: { name?: string; ctrl?: boolean } | undefined): void => {
      if (key?.ctrl && key.name === 'c') return done(() => reject(new Error('cancelled')));
      if (key?.name === 'return' || key?.name === 'enter') return done(() => resolve(value));
      if (key?.name === 'backspace') {
        value = value.slice(0, -1);
        return;
      }
      if (str && !key?.ctrl && str >= ' ') value += str;
    };
    stdin.on('keypress', onKey);
  });
}

async function main(): Promise<void> {
  console.log('Qwakk admin panel setup. Nothing is written to disk.\n');
  const pw = await askHidden(`Admin password (at least ${MIN_LENGTH} characters): `);
  if (pw.length < MIN_LENGTH) throw new Error(`the password needs at least ${MIN_LENGTH} characters`);
  const again = await askHidden('Same password again: ');
  if (again !== pw) throw new Error('the two passwords differ');

  const hash = await hashPassword(pw);
  const secret = base32Encode(randomBytes(20));
  const uri = otpauthUri(secret);

  console.log('\nScan this with your authenticator app (Google Authenticator, 1Password, Authy, ...):\n');
  console.log(qrTerminal(uri));
  console.log(`\nOr add it by hand: ${uri}\n`);
  console.log('Paste these two lines into CapRover > qwakk-game > App Configs > Environmental Variables, then Save:\n');
  console.log(`ADMIN_PASSWORD_HASH=${hash}`);
  console.log(`ADMIN_TOTP_SECRET=${secret}`);
  console.log('\nThen open https://play.qwakk.fun/admin and log in with the password and a code from the app.');
  console.log('Clear this terminal afterwards (the secret is on screen).');
}

main().catch((err: unknown) => {
  console.error(`\nadmin:setup stopped: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
