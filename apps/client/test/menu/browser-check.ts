/**
 * Headless Chrome check of the menu (not part of `npm test`; needs the local
 * PostgreSQL from docker compose). Starts the meta server on :2591 with a
 * throwaway database seeded with fake matches, Vite on :5181 with the menu
 * harness, then checks render, settings persistence and Play, and saves
 * screenshots.
 *
 *   node --disable-warning=ExperimentalWarning apps/client/test/menu/browser-check.ts OUT_DIR
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';
import { createMetaHandler } from '../../../server/src/meta/http.ts';
import { MetaService } from '../../../server/src/meta/service.ts';
import { freshDatabase } from '../../../server/test/meta/testDb.ts';

const out = process.argv[2] ?? 'menu-shots';
mkdirSync(out, { recursive: true });
const clientDir = fileURLToPath(new URL('../../', import.meta.url));
const API_PORT = 2591;
const WEB_PORT = 5181;
const procs: ChildProcess[] = [];
const fail = (msg: string): never => {
  throw new Error(msg);
};

/** This check drives the guest menu: skip the sign-in screen and the storage notice. */
const guestMenu = async (ctx: import('playwright').BrowserContext): Promise<void> => void await
  ctx.addInitScript(() => {
    localStorage.setItem('qwakk.entry', 'guest');
    localStorage.setItem('qwakk.storage-notice', '2026-10-23');
  });

const db = await freshDatabase('shots');
const meta = new MetaService({ env: { DATABASE_URL: db.url, SESSION_SECRET: 'browser-check-secret-browser-check-1' } });
let api: ReturnType<typeof createServer> | null = null;
try {
  await meta.start();
  // Seed: 14 ducks, 40 royale rounds and 10 deathmatch rounds with made-up stats.
  const names = ['BreadBandit', 'SoggyMallard', 'TurboTeal', 'QuackNorris', 'Puddlejumper', 'FeatherStorm', 'DuckNorris', 'MightyDrake', 'LuckyPaddler', 'SneakyBill', 'CosmicQuack', 'SaltyWaddler', 'GoldenEgg', 'RapidRubber'];
  const ids: { playerId: string; name: string }[] = [];
  for (const [i, name] of names.entries()) {
    const r = await meta.createSession({ name }, `10.1.0.${i}`);
    ids.push({ playerId: (r.body as { playerId: string }).playerId, name });
  }
  let seed = 7;
  const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let m = 0; m < 50; m++) {
    const mode = m < 40 ? 'br' : 'dm';
    const field = mode === 'br' ? 24 : 8;
    const humans = [...ids].sort(() => rand() - 0.5).slice(0, 6);
    const skill = (n: string): number => 1 - names.indexOf(n) / names.length;
    const order = humans.map((p) => ({ p, s: skill(p.name) + rand() * 0.9 })).sort((a, b) => b.s - a.s);
    const players = order.map(({ p, s }, i) => ({ playerId: p.playerId, name: p.name, isBot: false, placement: i * 3 + 1, kills: Math.floor(s * 6 + rand() * 3), damage: Math.floor(s * 800), survivedMs: 600_000 - i * 60_000 }));
    for (let b = players.length; b < field; b++) players.push({ playerId: null as unknown as string, name: `Bot ${b}`, isBot: true, placement: Math.min(field, b + 1 + players.length), kills: 1, damage: 100, survivedMs: 1000 });
    const placements = new Set<number>();
    for (const p of players) {
      while (placements.has(p.placement)) p.placement = (p.placement % field) + 1;
      placements.add(p.placement);
    }
    await meta.recordMatch({ matchId: `seed-${m}`, mode, mapId: 'island-1', startedAt: Date.now() - 900_000, endedAt: Date.now() - 300_000, players });
  }

  api = createServer(createMetaHandler(meta));
  await new Promise<void>((r) => api!.listen(API_PORT, '127.0.0.1', r));

  const vite = spawn('npx', ['vite', '--port', String(WEB_PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: clientDir,
    env: { ...process.env, VITE_API_BASE: `http://127.0.0.1:${API_PORT}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  procs.push(vite);
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite did not start')), 30_000);
    vite.stdout!.on('data', (d: Buffer) => {
      if (String(d).includes('Local')) {
        clearTimeout(t);
        resolve();
      }
    });
  });

  const url = `http://127.0.0.1:${WEB_PORT}/game/test/menu/harness.html`;
  const browser = await chromium.launch({ channel: process.env.E2E_BROWSER === 'chromium' ? undefined : 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await guestMenu(ctx);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
  // Expected failures: the blocked-name check (400). Anything else counts.
  page.on('response', (r) => r.status() >= 400 && !(r.status() === 400 && r.url().endsWith('/api/session')) && errors.push(`${r.status()} ${r.url()}`));

  const t0 = Date.now();
  await page.goto(url);
  await page.waitForSelector('#menu .qm-btn-play');
  const paintMs = Date.now() - t0;
  // Session and #tag arrive from the API once a name is committed.
  await page.fill('#qm-name', 'QuackAttack');
  await page.press('#qm-name', 'Enter');
  await page.waitForFunction(() => /^#\d{4}$/.test(document.querySelector('.qm-tag')?.textContent ?? ''));
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/menu.png` });

  // Blocked name shows a friendly error.
  await page.fill('#qm-name', 'sh1tduck');
  await page.press('#qm-name', 'Enter');
  await page.waitForSelector('.qm-name-msg.is-error');
  const blockedMsg = await page.textContent('.qm-name-msg');
  await page.fill('#qm-name', 'QuackAttack');
  await page.press('#qm-name', 'Enter');
  await page.waitForFunction(() => /^#\d{4}$/.test(document.querySelector('.qm-tag')?.textContent ?? ''));

  // Leaderboard
  await page.click('#qm-tab-leaderboard');
  await page.waitForSelector('.qm-table tbody tr');
  const lbRows = await page.locator('.qm-table tbody tr').count();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/leaderboard.png` });
  await page.click('.qm-lb-controls .qm-seg >> nth=1 >> text=Kills');
  await page.waitForFunction(() => document.querySelector('.qm-table td.hot') !== null && document.querySelectorAll('.qm-table td:nth-child(5).hot').length > 0);

  // Settings: keyboard on the FOV slider, then reload and check it stuck.
  await page.click('#qm-tab-settings');
  await page.focus('#qm-set-fov');
  for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');
  await page.fill('#qm-set-volume', '0.35');
  await page.dispatchEvent('#qm-set-volume', 'input');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/settings.png` });
  await page.reload();
  await page.waitForSelector('#menu');
  await page.click('#qm-tab-settings');
  const fov = await page.inputValue('#qm-set-fov');
  const vol = await page.inputValue('#qm-set-volume');
  const stored = await page.evaluate(() => localStorage.getItem('qwakk.settings'));
  if (fov !== '90' || vol !== '0.35') fail(`settings did not persist: fov ${fov}, volume ${vol}, stored ${stored}`);

  await page.click('#qm-tab-howto');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/howto.png` });

  // Tab keyboard navigation
  await page.focus('#qm-tab-howto');
  await page.keyboard.press('Home');
  const selected = await page.getAttribute('#qm-tab-play', 'aria-selected');
  if (selected !== 'true') fail('Home key did not select the Play tab');

  // Play: the game entry is loaded and called with the session and settings, then the round ends.
  await page.click('.qm-btn-play');
  await page.waitForFunction(() => (window as unknown as { __menuTest: { starts: unknown[] } }).__menuTest.starts.length === 1);
  const start = (await page.evaluate(() => (window as unknown as { __menuTest: { starts: Record<string, unknown>[] } }).__menuTest.starts[0])) ?? fail('startGame was not called');
  if (start?.mode !== 'br' || typeof start.token !== 'string' || !(start.token as string).startsWith('s1.')) fail(`bad startGame call: ${JSON.stringify(start)}`);
  if ((start.settings as { fov: number }).fov !== 90) fail('startGame did not get the saved FOV');
  await page.waitForSelector('#menu', { state: 'hidden' });
  await page.waitForSelector('#menu .qm-result:not([hidden])');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/result.png` });

  // Phone: browsable, Play on (touch controls), with a note.
  const phone = await browser.newContext({ ...devices['iPhone 13'] });
  await guestMenu(phone);
  const pp = await phone.newPage();
  await pp.goto(url);
  await pp.waitForSelector('.qm-mobile');
  const disabled = await pp.locator('.qm-btn-play').isDisabled();
  if (disabled) fail('Play should be on for touch-only devices');
  await pp.waitForTimeout(700);
  await pp.screenshot({ path: `${out}/mobile.png`, fullPage: false });

  await browser.close();
  const report = { paintMs, blockedMsg, lbRows, settingsPersisted: { fov, vol }, start: { mode: start.mode, hasToken: true, settings: start.settings }, mobilePlayEnabled: !disabled, errors };
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) fail(`page errors: ${errors.join(' | ')}`);
  console.log(`menu check passed, screenshots in ${out}`);
} finally {
  for (const p of procs) p.kill('SIGTERM');
  api?.close();
  await meta.stop();
  await db.drop();
}
