/** Local launcher only. Uses the real password + TOTP flow; no auth bypass. */
import { randomBytes } from 'node:crypto';
import { chromium, type Browser } from 'playwright';
import { hashPassword } from '../apps/server/src/admin/password.ts';
import { base32Encode, hotp, stepAt } from '../apps/server/src/admin/totp.ts';

export async function createDevAdmin(root: string): Promise<{
  env: NodeJS.ProcessEnv;
  open: () => Promise<void>;
  close: () => Promise<void>;
}> {
  // New for each dev run; never stored in files or printed in the terminal.
  const password = randomBytes(24).toString('base64url');
  const secret = randomBytes(20);
  let browser: Browser | undefined;
  let launching: Promise<Browser> | undefined;
  let closed = false;
  return {
    env: {
      ADMIN_PASSWORD_HASH: await hashPassword(password),
      ADMIN_TOTP_SECRET: base32Encode(secret),
      QWAKK_ADMIN_DIR: `${root}/apps/admin/dist`,
    },
    async open() {
      if (closed) return;
      try {
        launching = chromium.launch({ channel: 'chrome', headless: false, timeout: 10000,
          handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
        browser = await launching;
        if (closed) { await browser.close(); return; }
        const context = await browser.newContext({ viewport: null });
        const admin = await context.newPage();
        await admin.goto('http://localhost:2567/admin');
        await admin.locator('input[name=password]').fill(password);
        await admin.locator('input[name=code]').fill(hotp(secret, stepAt(Date.now())));
        await admin.locator('button[type=submit]').click();
        await admin.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
        const game = await context.newPage();
        await game.goto('http://localhost:5173/game/');
        console.log('[dev] Chrome ready: game + authenticated admin tabs (temporary local credentials).');
      } catch {
        await browser?.close();
        // Playwright errors can include filled input values. Never print them.
        throw new Error('Could not open and sign in to the local Chrome preview');
      }
    },
    async close() {
      closed = true;
      const active = await launching?.catch(() => undefined);
      await active?.close();
    },
  };
}
