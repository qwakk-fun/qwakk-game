/**
 * Accounts end to end: the real server (a throwaway PostgreSQL database,
 * test hooks on so sign-in codes land in the dev mail sink, bots off), `vite
 * preview` of the test bundle and headless Chrome playing through the menu
 * (npm run build:test first, and the local database: npm run db:up).
 *
 *   Guest: the sign-in screen, "Play as guest", the guest card (name and
 *   look), Duck Plaza; in the menu sheet Battle Royale is locked (it opens
 *   sign-in, Back returns to the plaza), the server refuses a guest session a
 *   battle royale room, and Deathmatch plays.
 *   Account: sign up by email (the code from the dev mail sink, typed into
 *   the code boxes), accept the terms, hatch two ducks (one Toski), pick it,
 *   Duck Plaza shows it, the sheet's account tab, Battle Royale joins a battle royale
 *   wearing the duck's look; then log out, sign in again with a new code and
 *   see both ducks.
 *   Phone: the sign-in screen and the character select, upright and sideways,
 *   then the plaza and its sheet.
 *
 * Screenshots (desktop and phone) go to OUTDIR. Usage: npm run e2e:accounts [-- OUTDIR]
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@colyseus/sdk';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { BR } from '@qwakk/shared';
import { ACCOUNT_ERROR } from '@qwakk/shared/accounts';
import { accountSeed, e2eDatabase, fetchAccount, mailCode, openSheet, pickDuck, seedBrowser, signUpApi, waitPlaza } from './lib/accounts.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? join(tmpdir(), 'qwakk-shots-accounts');
mkdirSync(out, { recursive: true });
// The menu's API calls go to port 2567 in test builds (net/endpoint.ts), so the server runs there.
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 2567);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5173);
const API = `http://localhost:${SERVER_PORT}`;
const MENU = `http://localhost:${WEB_PORT}/game/?lang=en&hud=0`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const snap = (p: Page): Promise<any> => p.evaluate(() => (window as any).__qwakk?.snapshot() ?? null);

function run(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}): ChildProcess {
  return spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function waitForOutput(proc: ChildProcess, needle: string, timeoutMs = 60000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${needle}"`)), timeoutMs);
    const onData = (chunk: Buffer) => {
      if (chunk.toString().includes(needle)) {
        clearTimeout(timer);
        resolve();
      }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
  });
}

async function until<T>(label: string, get: () => Promise<T>, test: (v: T) => boolean, timeoutMs = 30000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await get();
    if (test(v)) return v;
    if (Date.now() > end) throw new Error(`timeout: ${label} (${JSON.stringify(v)?.slice(0, 400)})`);
    await sleep(200);
  }
}

async function context(browser: Browser, name: string, opts: Parameters<Browser['newContext']>[0] = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 }, ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[${name}] page error:`, e.message));
  page.on('console', (m) => m.type() === 'error' && !/404|401|Failed to load resource/.test(m.text()) && console.error(`[${name}] console:`, m.text()));
  return { ctx, page };
}

/** No sideways scrolling, at any size. */
async function noSideScroll(page: Page, label: string): Promise<void> {
  const r = await page.evaluate(() => ({ sw: document.querySelector('#menu')!.scrollWidth, w: window.innerWidth }));
  if (r.sw > r.w + 1) throw new Error(`${label}: the menu scrolls sideways (${r.sw} > ${r.w})`);
}

/** Wait until the select's ducks are drawn in 3D (or give up after a while: the portraits stay). */
async function ducksDrawn(page: Page, n: number): Promise<boolean> {
  try {
    await page.waitForFunction((k) => document.querySelectorAll('.qd-canvas[data-ready]').length >= k, n, { timeout: 25000 });
    await sleep(900); // the picked duck's turn settles
    return true;
  } catch {
    console.log('3D ducks not drawn in time; the portraits are shown');
    return false;
  }
}

async function guest(browser: Browser): Promise<void> {
  const { ctx, page } = await context(browser, 'guest');
  await seedBrowser(ctx); // storage notice closed only
  await page.goto(MENU);
  await page.locator('.qa-auth').waitFor({ timeout: 20000 });
  await page.locator('.qa-guest').click();
  // A new guest names its duck on the guest card, then walks into Duck Plaza.
  await page.locator('.qm-guest:not([hidden])').waitFor({ timeout: 10000 });
  await page.locator('#qm-name').fill('GuestDuck');
  await page.screenshot({ path: `${out}/g0-guest-card.png` });
  // Enter in the name field (or the button) saves the name, gets the #tag and walks in.
  await page.locator('#qm-name').press('Enter');
  await waitPlaza(page);
  const tag = (JSON.parse((await page.evaluate(() => localStorage.getItem('qwakk.identity'))) ?? '{}') as { tag?: string }).tag ?? '';
  if (!/^\d{4}$/.test(tag)) throw new Error(`no guest tag: "${tag}"`);
  // The menu sheet: Battle Royale is locked for a guest.
  await openSheet(page);
  const locked = await page.locator('.qm-sheet-mode[data-mode="br"]').getAttribute('class');
  if (!locked?.includes('is-locked')) throw new Error('Battle Royale is not locked for a guest');
  await sleep(600);
  await page.screenshot({ path: `${out}/g1-guest-sheet-br-locked.png` });
  // Battle Royale as a guest opens the sign-in screen instead of a match; Back returns to the plaza.
  await page.locator('.qm-sheet-mode[data-mode="br"]').click();
  await page.locator('#menu[data-screen="login"] .qa-auth-back:not([hidden])').waitFor({ timeout: 5000 });
  await page.locator('.qa-auth-back').click();
  await waitPlaza(page);

  // The server refuses the guest's session in a battle royale (matchmaking guard).
  const id = JSON.parse((await page.evaluate(() => localStorage.getItem('qwakk.identity'))) ?? '{}') as { token?: string };
  if (!id.token) throw new Error('no guest session token');
  let code = 0;
  try {
    const r = await new Client(`ws://localhost:${SERVER_PORT}`).joinOrCreate(BR.roomName, { token: id.token });
    await r.leave(true);
  } catch (err) {
    code = (err as { code?: number }).code ?? -1;
  }
  if (code !== ACCOUNT_ERROR.needsAccount) throw new Error(`a guest session got into a battle royale (code ${code})`);
  console.log(`guest: battle royale refused by the server (${code})`);

  // Deathmatch plays (the sheet's mode list; the portal is in e2e/hub.ts).
  await openSheet(page);
  await page.locator('.qm-sheet-mode[data-mode="dm"]').click();
  await until('guest in the deathmatch', () => snap(page), (s) => s?.mode === 0 && s.players >= 1 && s.server?.alive === 1, 60000);
  console.log('guest: deathmatch joined');
  await ctx.close();
}

async function account(browser: Browser): Promise<{ token: string; expiresAt: number; email: string }> {
  const email = 'e2e.duck+accounts@example.com';
  const { ctx, page } = await context(browser, 'account');
  await seedBrowser(ctx);
  await page.goto(MENU);
  await page.locator('.qa-auth').waitFor({ timeout: 20000 });
  await page.locator('.qa-auth-art img').evaluate((img: HTMLImageElement) => img.decode().catch(() => {}));
  await sleep(500);
  await page.screenshot({ path: `${out}/a1-login.png` });
  if (!(await page.locator('.qa-qorex').isDisabled())) throw new Error('the QoreX button is not disabled');

  // A bad address stays on the form.
  await page.locator('#qa-email').fill('not-an-email');
  await page.locator('.qa-send').click();
  await until('email error', () => page.locator('.qa-auth .qa-msg').innerText(), (t) => t.includes('looks off'), 5000);
  await page.locator('#qa-email').fill(email);
  await page.locator('.qa-send').click();
  await page.locator('#menu .qa-auth[data-step="code"]').waitFor({ timeout: 15000 });
  const code = await mailCode(API, email);
  // A wrong code first: the boxes say how many tries are left.
  const wrong = code === '000000' ? '111111' : '000000';
  await page.locator('#qa-code').pressSequentially(wrong.slice(0, 3), { delay: 40 });
  await sleep(200);
  await page.screenshot({ path: `${out}/a2-code-entry.png` });
  await page.locator('#qa-code').pressSequentially(wrong.slice(3), { delay: 40 });
  await until('wrong code message', () => page.locator('.qa-auth .qa-msg').innerText(), (t) => t.includes('tries left'), 10000);
  await page.screenshot({ path: `${out}/a2b-code-wrong.png` });
  await page.locator('#qa-code').fill('');
  // Paste the real code: every box fills at once.
  await page.locator('#qa-code').fill(code);
  await page.locator('#menu .qa-auth[data-step="signup"]').waitFor({ timeout: 15000 });
  await sleep(300);
  await page.screenshot({ path: `${out}/a3-signup-consent.png` });
  if (await page.locator('#qa-news').isChecked()) throw new Error('the news box is checked by default');
  await page.locator('.qa-auth .qm-btn-yellow').click();
  await until('consent required', () => page.locator('.qa-auth .qa-msg').innerText(), (t) => t.includes('first box'), 5000);
  await page.locator('label[for="qa-consent"]').click({ position: { x: 20, y: 20 } });
  await page.locator('.qa-auth .qm-btn-yellow').click();

  // The character select, no ducks yet: hatch two.
  await page.locator('#menu[data-screen="ducks"] .qd-nest.is-empty').first().waitFor({ timeout: 15000 });
  const hatch = async (name: string, look: 'classic' | 'mallard', shot?: string): Promise<void> => {
    await page.locator('.qd-nest.is-empty').first().click();
    await page.locator('.qd-create:not([hidden]) #qd-name').waitFor();
    await page.locator('#qd-name').fill(name);
    await page.locator(`.qd-create .qm-char[data-character="${look}"]`).click();
    if (shot) {
      await page.locator('.qd-create .qm-art-duck.is-3d').waitFor({ timeout: 20000 }).catch(() => console.log('create preview stayed 2D'));
      await sleep(700);
      await page.screenshot({ path: shot });
    }
    await page.locator('.qd-hatch').click();
    await page.locator(`.qd-nest[data-duck] .qd-name:has-text("${name}")`).waitFor({ timeout: 15000 });
  };
  await hatch('Quackers', 'mallard', `${out}/a4-create-duck.png`);
  await hatch('Waddles', 'classic');
  // A blocked name is refused with our own words.
  await page.locator('.qd-nest.is-empty').first().click();
  await page.locator('#qd-name').fill('fuck');
  await page.locator('.qd-hatch').click();
  await until('blocked name', () => page.locator('.qd-create .qa-msg').innerText(), (t) => t.includes('ruffles feathers'), 10000);
  await page.locator('.qd-create-actions .qm-btn-ghost').click();

  // Pick Quackers (Toski): it turns to the viewer.
  await page.locator('.qd-nest[data-duck]', { hasText: 'Quackers' }).click();
  const drawn = await ducksDrawn(page, 2);
  await page.screenshot({ path: `${out}/a5-character-select.png` });
  const play = await page.locator('.qd-play').innerText();
  if (!play.includes('Quackers')) throw new Error(`the Play button says "${play}"`);
  console.log(`select: 2 ducks${drawn ? ' in 3D' : ''}, ${play}`);
  await page.locator('.qd-play').click();
  await waitPlaza(page);
  const me = await page.evaluate(() => (window as any).__qwakkHub.snapshot().ducks.find((d: { self: boolean }) => d.self));
  if (me?.name !== 'Quackers' || me.character !== 1 || me.level !== 1) throw new Error(`the plaza duck: ${JSON.stringify(me)}`);
  await sleep(800);
  await page.screenshot({ path: `${out}/a6-plaza-account.png` });
  await openSheet(page, 5);
  const who = await page.locator('.qm-active-name').innerText();
  if (!/Quackers\s*#\d{4}/.test(who)) throw new Error(`the account tab shows "${who}"`);
  if (await page.locator('#qm-name').isVisible()) throw new Error('the guest name field shows for an account duck');
  await page.locator('.qm-account-email').waitFor();
  await sleep(300);
  await page.screenshot({ path: `${out}/a7-account-screen.png` });
  // The news switch: on, then off again (each change is stored with its time).
  await page.locator('label[for="qm-news"]').click();
  await until('news on', () => page.locator('.qm-account .qa-msg').innerText(), (t) => t.includes('on the list'), 10000);
  await page.locator('label[for="qm-news"]').click();
  await until('news off', () => page.locator('.qm-account .qa-msg').innerText(), (t) => t.includes('off the list'), 10000);
  // The delete dialog (opened and kept: Keep my account).
  await page.locator('.qm-account-delete').click();
  await page.locator('.qa-dialog').waitFor();
  await sleep(300);
  await page.screenshot({ path: `${out}/a7b-delete-account-dialog.png` });
  await page.keyboard.press('Escape');
  await page.locator('.qa-dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  await openSheet(page, 0);

  // Quick Play: a battle royale as Quackers, wearing Toski.
  await page.locator('.qm-sheet-mode[data-mode="br"]').click();
  const br = await until('in a battle royale', () => snap(page), (s) => s?.mode === 1 && s.players >= 1, 60000);
  if (!br.characters?.[1]) throw new Error(`the duck is not wearing its look in the room: ${JSON.stringify(br.characters)}`);
  console.log(`account: battle royale joined, looks in the room ${JSON.stringify(br.characters)}`);
  await sleep(500);
  await page.screenshot({ path: `${out}/a8-battle-royale.png` });

  // Back to the menu (a reload), log out, sign in again: both ducks are there.
  const stored = JSON.parse((await page.evaluate(() => localStorage.getItem('qwakk.account'))) ?? '{}') as { token: string; expiresAt: number; email: string };
  await page.goto(MENU);
  await page.locator('#menu[data-screen="ducks"] .qd-nest[data-duck]').first().waitFor({ timeout: 20000 });
  await page.locator('.qd-logout').click();
  await page.locator('#menu[data-screen="login"]').waitFor();
  await until('logged out note', () => page.locator('.qa-auth .qa-msg').innerText(), (t) => t.includes('Logged out'), 5000);
  if (await page.evaluate(() => localStorage.getItem('qwakk.account'))) throw new Error('the account session stayed in storage after log out');
  const old = await fetch(`${API}/api/account`, { headers: { authorization: `Bearer ${stored.token}` } });
  if (old.status !== 401) throw new Error(`the old account session still works after log out (${old.status})`);
  await page.locator('#qa-email').fill(email.toUpperCase());
  await page.locator('.qa-send').click();
  await page.locator('#menu .qa-auth[data-step="code"]').waitFor({ timeout: 15000 });
  await page.locator('#qa-code').fill(await mailCode(API, email));
  await page.locator('#menu[data-screen="ducks"] .qd-nest[data-duck]').nth(1).waitFor({ timeout: 15000 });
  const names = await page.locator('.qd-nest[data-duck] .qd-name').allInnerTexts();
  if (names.length !== 2 || !names.some((n) => n.startsWith('Quackers')) || !names.some((n) => n.startsWith('Waddles'))) throw new Error(`after signing in again: ${JSON.stringify(names)}`);
  console.log(`signed in again: ${names.join(', ')}`);
  const fresh = JSON.parse((await page.evaluate(() => localStorage.getItem('qwakk.account'))) ?? '{}') as { token: string; expiresAt: number; email: string };
  await ctx.close();
  return fresh;
}

async function phone(browser: Browser, session: { token: string; expiresAt: number; email: string }): Promise<void> {
  const phoneOpts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } as const;
  {
    const { ctx, page } = await context(browser, 'phone-login', phoneOpts);
    await seedBrowser(ctx);
    await page.goto(MENU);
    await page.locator('.qa-auth').waitFor({ timeout: 20000 });
    await sleep(600);
    await page.screenshot({ path: `${out}/p1-phone-login-portrait.png` });
    await noSideScroll(page, 'phone login portrait');
    await page.setViewportSize({ width: 844, height: 390 });
    await sleep(500);
    await page.screenshot({ path: `${out}/p2-phone-login-landscape.png` });
    await noSideScroll(page, 'phone login landscape');
    await ctx.close();
  }
  {
    const account = await fetchAccount(API, session.token);
    const { ctx, page } = await context(browser, 'phone-ducks', phoneOpts);
    await seedBrowser(ctx, { account: { ...session, active: account.characters[0]?.id } });
    await page.goto(MENU);
    await page.locator('#menu[data-screen="ducks"] .qd-nest[data-duck]').nth(1).waitFor({ timeout: 20000 });
    await ducksDrawn(page, 2);
    await page.screenshot({ path: `${out}/p3-phone-select-portrait.png` });
    await noSideScroll(page, 'phone select portrait');
    await page.setViewportSize({ width: 844, height: 390 });
    await sleep(900);
    await page.screenshot({ path: `${out}/p4-phone-select-landscape.png` });
    await noSideScroll(page, 'phone select landscape');
    // Play as the duck: Duck Plaza on a phone, sideways and upright (the rotate screen).
    await pickDuck(page, 60_000, true);
    await sleep(1500);
    await page.screenshot({ path: `${out}/p5-phone-plaza-landscape.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(700);
    await page.screenshot({ path: `${out}/p5b-phone-plaza-portrait.png` });
    await page.setViewportSize({ width: 844, height: 390 });
    await sleep(500);
    await openSheet(page, 5);
    await sleep(400);
    await page.screenshot({ path: `${out}/p6-phone-account-sheet.png` });
    await ctx.close();
  }
}

async function main(): Promise<void> {
  if (!existsSync(`${root}/apps/client/dist-test/index.html`)) throw new Error('Build the test client first: npm run build:test');
  const db = await e2eDatabase('accounts');
  const server = run(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], root, {
    PORT: String(SERVER_PORT),
    DATABASE_URL: db.url,
    QWAKK_TEST_HOOKS: '1',
    QWAKK_BOTS: '0',
    QWAKK_BR_COUNTDOWN: '30',
    QWAKK_BR_MIN_HUMANS: '2',
  });
  const web = run(process.execPath, [`${root}/node_modules/vite/bin/vite.js`, 'preview', '--outDir', process.env.E2E_DIST ?? 'dist-test', '--port', String(WEB_PORT), '--strictPort'], `${root}/apps/client`);
  const procs = [server, web];
  const cleanup = () => procs.forEach((p) => p.exitCode === null && p.kill('SIGINT'));
  process.on('exit', cleanup);
  let browser: Browser | null = null;
  try {
    await Promise.all([waitForOutput(server, 'database ready'), waitForOutput(server, 'server listening'), waitForOutput(web, String(WEB_PORT))]);
    browser = await chromium.launch({
      ...((process.env.E2E_BROWSER ?? 'chrome') === 'chrome' ? { channel: 'chrome' } : {}),
      headless: true,
      args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
    });
    await guest(browser);
    const session = await account(browser);
    await phone(browser, session);
    // An account made over the API works too (what the other e2e scripts use).
    const api = await signUpApi(API, 'e2e.api@example.com', [['ApiDuck', 0]]);
    if (!accountSeed(api)) throw new Error('no seed');
    console.log(`screenshots in ${out}`);
    console.log('ACCOUNTS E2E OK');
  } finally {
    await browser?.close().catch(() => {});
    cleanup();
    await sleep(300);
    await db.drop().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
