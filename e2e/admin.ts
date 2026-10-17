/** Real admin login, UI, persistence, moderation gates and logout on a throwaway local database. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { freshDatabase } from '../apps/server/test/meta/testDb.ts';
import { hashPassword } from '../apps/server/src/admin/password.ts';
import { base32Encode, hotp, stepAt } from '../apps/server/src/admin/totp.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? '/private/tmp/qwakk-admin-review';
mkdirSync(out, { recursive: true });
const port = 2588;
const origin = `http://localhost:${port}`;
const password = randomBytes(24).toString('base64url');
const secret = randomBytes(20);
const db = await freshDatabase('admin_e2e');
const env = { ...process.env, PORT: String(port), DATABASE_URL: db.url, SESSION_SECRET: randomBytes(32).toString('hex'), ADMIN_PASSWORD_HASH: await hashPassword(password), ADMIN_TOTP_SECRET: base32Encode(secret), QWAKK_BOTS: '0', QWAKK_CLIENT_DIR: `${root}/apps/client/dist`, QWAKK_ADMIN_DIR: `${root}/apps/admin/dist` };
let server: ChildProcess | undefined;
async function start(): Promise<void> {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], { cwd: root, env, stdio: 'pipe' });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server startup timed out')), 30000);
    server!.stdout!.on('data', (b: Buffer) => { if (b.toString().includes('server listening')) { clearTimeout(timer); resolve(); } });
    server!.once('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited: ${code}`)); });
  });
}
async function stop(): Promise<void> {
  if (server && server.exitCode === null) {
    const proc = server;
    await new Promise<void>((resolve) => { proc.once('exit', () => resolve()); proc.kill('SIGINT'); });
  }
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  await start();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  assert.equal((await context.request.get(`${origin}/admin/api/settings`)).status(), 401);
  await page.goto(`${origin}/admin`);
  await page.locator('input[name=password]').fill(password);
  await page.locator('input[name=code]').fill(hotp(secret, stepAt(Date.now())));
  await page.locator('button[type=submit]').click();
  await page.locator('h1', { hasText: 'Dashboard' }).waitFor({ timeout: 10000 }).catch(async (err) => {
    await page.screenshot({ path: `${out}/login-failed.png` });
    console.error('login state', page.url(), await page.locator('body').innerText(), errors, (await context.cookies()).map((c) => c.name));
    throw err;
  });
  await page.screenshot({ path: `${out}/dashboard.png`, fullPage: true });
  await page.locator('a[href="#/settings"]').click();
  const count = page.locator('#set-dm-players');
  await count.fill('20');
  const changed = page.waitForResponse((r) => r.url().endsWith('/admin/api/settings/set') && r.request().method() === 'POST');
  await count.press('Tab');
  assert.equal((await changed).status(), 200);
  await page.reload();
  await count.waitFor();
  assert.equal(await count.inputValue(), '20');
  await page.screenshot({ path: `${out}/settings.png`, fullPage: true });
  for (const route of ['moderation', 'notices', 'audit']) {
    await page.locator(`a[href="#/${route}"]`).click();
    await page.locator('h1').waitFor();
    await page.screenshot({ path: `${out}/${route}.png`, fullPage: true });
  }
  const api = async (route: string, body: unknown, originHeader = origin) => {
    const r = await context.request.post(`${origin}/admin/api/${route}`, { data: body, headers: { Origin: originHeader, 'Sec-Fetch-Site': 'same-origin' } });
    return { status: r.status(), body: await r.json() };
  };
  assert.equal((await api('settings/set', { key: 'dm.players', value: 18 }, 'https://foreign.invalid')).status, 403);
  assert.equal((await api('settings/set', { key: 'dm.players', value: 'invalid' })).status, 400);
  assert.equal((await api('settings/set', { key: 'ops.banner', value: 'Yerel test duyurusu' })).status, 200);
  assert.equal((await context.request.get(`${origin}/api/status`)).status(), 200);
  assert.equal((await (await context.request.get(`${origin}/api/status`)).json()).banner, 'Yerel test duyurusu');
  await stop();
  await start();
  // A process restart ends old sessions, while the saved setting survives.
  assert.equal((await context.request.get(`${origin}/admin/api/settings`)).status(), 401);
  await page.goto(`${origin}/admin`);
  await page.locator('input[name=password]').fill(password);
  await page.locator('input[name=code]').fill(hotp(secret, stepAt(Date.now())));
  await page.locator('button[type=submit]').click();
  await page.locator('a[href="#/settings"]').click();
  await count.waitFor();
  assert.equal(await count.inputValue(), '20');
  await page.locator('form.logout button').click();
  await page.locator('input[name=password]').waitFor();
  assert.equal((await context.request.get(`${origin}/admin/api/settings`)).status(), 401);
  assert.deepEqual(errors, []);
  await context.close();
  console.log('admin e2e: login + 2FA, five pages, setting persistence across restart, origin/validation gates, public notice, session revocation and logout passed');
} finally {
  await browser.close();
  await stop();
  await db.drop();
}
