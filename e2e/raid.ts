/**
 * Hunt Season end to end: the real server (test hooks on, a throwaway
 * database), `vite preview` of the test bundle, headless Chrome.
 *
 *   Solo: a signed-in duck (signed up through the API and the dev mail sink)
 *   clicks Hunt Season in the menu and plays with the dev autopilot (it fights
 *   the hunters it sees, holds the tower, picks a card). It clears waves 1
 *   and 2 on its own; the cards are picked and the server takes the pick;
 *   then test hooks jump to the boss wave and to wave 15 for the screenshots,
 *   and the run is won. The duck's XP (stored by the game server at the run
 *   end, read back over the account API) has gone up, with a personal best.
 *
 *   Party: two ducks in a party (one on an emulated phone in landscape, touch
 *   controls) start a hunt: the leader clicks Hunt Season, the member follows
 *   into the same run; both reach wave 1 and see the hunters; then the boss
 *   wave, the cards (tapped on the phone) and the end screen, on both screens.
 *
 * Screenshots to OUTDIR. Usage: npm run e2e:raid [-- OUTDIR] (npm run build:test first).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { RaidStage } from '@qwakk/shared';
import { accountSeed, e2eDatabase, fetchAccount, pickDuck, seedBrowser, signUpApi } from './lib/accounts.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? join(tmpdir(), 'qwakk-shots-raid');
mkdirSync(out, { recursive: true });
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 2567);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5173);
const API = `http://localhost:${SERVER_PORT}`;
const server_ = `ws://localhost:${SERVER_PORT}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Raid = any;
const raid = (p: Page): Promise<Raid> => p.evaluate(() => (window as any).__qwakk?.raid() ?? null);
const snap = (p: Page): Promise<any> => p.evaluate(() => (window as any).__qwakk?.snapshot() ?? null);
const dev = (p: Page, op: string, wave = 0): Promise<void> => p.evaluate(([o, w]) => (window as any).__qwakk.devRaid(o, w), [op, wave] as const);
const hideOverlay = (p: Page): Promise<void> => p.evaluate(() => document.getElementById('overlay')?.classList.add('hidden'));

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
    if (Date.now() > end) throw new Error(`timeout: ${label} (${JSON.stringify(v)?.slice(0, 800)})`);
    await sleep(250);
  }
}

/** Face the nearest hunter that passes `want` (the autopilot pauses meanwhile) and take a screenshot; skipped with a note if none comes. */
async function closeUp(p: Page, want: (h: { kind: number; act: number; dist: number }) => boolean, path: string, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const list = (await p.evaluate(() => (window as any).__qwakk.hunters())) as { kind: number; act: number; x: number; y: number; z: number; dist: number }[];
    const h = list.find((x) => x.act !== 11 && want(x));
    if (h) {
      await p.evaluate(([x, z]) => (window as any).__qwakk.face(x, z, 1400, -0.02), [h.x, h.z]);
      await sleep(700);
      await hideOverlay(p);
      await p.screenshot({ path });
      console.log(`close-up: kind ${h.kind} act ${h.act} at ${h.dist.toFixed(1)} m -> ${path}`);
      return;
    }
    await sleep(200);
  }
  console.log(`close-up skipped (none came near): ${path}`);
}

let n = 0;
async function newDuck(browser: Browser, name: string, phone = false): Promise<{ ctx: BrowserContext; page: Page; token: string; duckId: string }> {
  const ctx = phone
    ? await browser.newContext({ locale: 'en-US', viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    : await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 720 } });
  const s = await signUpApi(API, `e2e.raid${++n}.${Date.now() % 100000}@example.com`, [[`${name}${n}`, n % 2]]);
  await seedBrowser(ctx, accountSeed(s));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[${name}] page error:`, e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.error(`[${name}] console:`, m.text()));
  return { ctx, page, token: s.session.accountToken, duckId: s.ducks[0]!.id };
}

const menuUrl = (extra = ''): string => `http://localhost:${WEB_PORT}/game/?lang=en&server=${server_}&hud=0&menu=1${extra}`;

/** Wait until this page is in a hunt (mode 2) at a stage. */
const inStage = (p: Page, stage: number, wave: number, ms: number): Promise<Raid> => until(`stage ${stage} wave ${wave}`, () => raid(p), (r) => r?.stage === stage && r.wave >= wave, ms);

async function solo(browser: Browser): Promise<void> {
  const A = await newDuck(browser, 'Hunt');
  const a = A.page;
  const before = (await fetchAccount(API, A.token)).characters[0]!;
  await a.goto(menuUrl('&autopilot=raid'));
  await pickDuck(a);
  await a.locator('.qm-btn[data-mode="raid"]').waitFor();
  await sleep(1500);
  await a.screenshot({ path: `${out}/01-menu-hunt-season.png` });
  await a.locator('.qm-btn[data-mode="raid"]').click();
  await until('in a hunt', () => snap(a), (s) => s?.mode === 2, 60000);
  await hideOverlay(a);
  await sleep(800);
  await a.screenshot({ path: `${out}/02-lobby.png` });
  await inStage(a, RaidStage.Wave, 1, 30000);
  const t0 = Date.now();
  const first = await until('hunters out', () => raid(a), (r) => r.hunters >= 2, 30000);
  console.log(`wave 1: ${JSON.stringify(first)}`);
  await sleep(4000);
  await hideOverlay(a);
  await a.screenshot({ path: `${out}/03-wave1-hunters.png` });
  await closeUp(a, (h) => h.dist < 26, `${out}/03b-hunter-closeup.png`, 40000);
  await closeUp(a, (h) => h.kind === 1 && h.act === 3 && h.dist < 45, `${out}/03c-rifleman-laser.png`, 30000);
  // Waves 1 and 2, cleared by the autopilot alone.
  for (const w of [1, 2]) {
    const r = await until(`wave ${w} cleared by the autopilot`, () => raid(a), (x) => (x.stage === RaidStage.Break && x.wave === w) || x.stage === RaidStage.Lost || x.stage === RaidStage.Won, 240000);
    if (r.stage === RaidStage.Lost) {
      await a.screenshot({ path: `${out}/xx-lost-wave${w}.png` });
      throw new Error(`the autopilot lost the run on wave ${w}: ${JSON.stringify(r)}`);
    }
    console.log(`wave ${w} cleared in ${((Date.now() - t0) / 1000).toFixed(0)} s (kills ${r.teamKills}, tower ${r.tower}/${r.towerMax}, hp ${Math.round(r.hp)})`);
    await until('cards up', () => raid(a), (x) => x.offers >= w, 10000);
    if (w === 1) {
      await sleep(400);
      await a.screenshot({ path: `${out}/04-upgrade-cards.png` });
    }
    const picked = await until('the autopilot picked a card, the server took it', () => raid(a), (x) => x.picks >= w && !x.cardsOpen, 15000);
    console.log(`card picked (picks ${picked.picks}), max health now ${picked.maxHp}`);
    await dev(a, 'break');
    await inStage(a, RaidStage.Wave, w + 1, 15000);
  }
  // A line-up of every kind 8 m in front (test hook), ducks held (no damage) for the review shots.
  await dev(a, 'hold');
  await a.evaluate(() => (window as any).__qwakk.face(0, 60, 4000, -0.05));
  await sleep(600);
  for (const k of [1, 2, 3, 4, 5]) await dev(a, 'spawn', k);
  await sleep(1200);
  const me = (await snap(a)).me;
  const fwd = await a.evaluate(() => (window as any).__qwakk.snapshot().controls.yaw);
  await a.evaluate(([x, z]) => (window as any).__qwakk.face(x, z, 3000, 0.02), [me.x - Math.sin(fwd) * 8, me.z - Math.cos(fwd) * 8]);
  await sleep(500);
  await hideOverlay(a);
  await a.screenshot({ path: `${out}/04b-hunter-lineup.png` });
  await closeUp(a, (h) => h.kind === 1 && h.act === 3 && h.dist < 15, `${out}/04c-rifleman-aiming.png`, 15000);
  await dev(a, 'clear');
  await sleep(1500);
  await a.screenshot({ path: `${out}/04d-defeat-poof.png` });
  // The boss wave, forced by the test hook.
  await dev(a, 'skip', 5);
  await until('the Big Hunter', () => raid(a), (x) => x.bossMax > 0, 30000);
  await sleep(5000);
  await hideOverlay(a);
  await a.screenshot({ path: `${out}/05-boss-wave.png` });
  await closeUp(a, (h) => h.kind === 5 && h.dist < 40, `${out}/05b-boss-closeup.png`, 50000);
  await closeUp(a, (h) => h.kind === 4 && h.dist < 22, `${out}/05c-dogs.png`, 20000);
  // Wave 15, beaten: the run is won and XP is granted by the server.
  await dev(a, 'skip', 15);
  await sleep(1500);
  await dev(a, 'clear');
  const end = await until('end screen', () => raid(a), (x) => x.endOpen && x.ended >= 2, 20000);
  console.log(`run won: ended messages ${end.ended}, kills ${end.teamKills}`);
  await sleep(2000);
  await a.screenshot({ path: `${out}/06-end-screen.png` });
  const after = (await fetchAccount(API, A.token)).characters[0]!;
  console.log(`XP ${before.xp} -> ${after.xp}, level ${before.level} -> ${after.level}, best ${JSON.stringify(after.raidBest)}`);
  if (!(after.xp > before.xp)) throw new Error('the duck got no XP');
  if (!after.raidBest || after.raidBest.wave < 3) throw new Error('no personal best stored');
  // Back to the pond: the menu shows the new level and the XP bar.
  await a.locator('.raid-end-buttons .back').click();
  await a.locator('#menu[data-screen="main"]').waitFor({ timeout: 20000 });
  await until('the menu shows the XP', () => a.locator('.qm-active-xp .qm-xp-text').innerText().catch(() => ''), (t) => /XP|Max/.test(t), 10000);
  await sleep(2500);
  await a.screenshot({ path: `${out}/07-menu-after-xp.png` });
  const p = await snap(a).catch(() => null);
  void p;
  await A.ctx.close();
}

async function party(browser: Browser): Promise<void> {
  const A = await newDuck(browser, 'Lead');
  const B = await newDuck(browser, 'Mate', true);
  const a = A.page;
  const b = B.page;
  await a.goto(menuUrl());
  await pickDuck(a);
  await a.locator('.qm-party button', { hasText: 'Create party' }).click();
  const code = await a.locator('.qm-party-codetext').innerText({ timeout: 20000 });
  await b.goto(`${menuUrl()}&party=${code}`);
  await b.locator('.qd-play:not([disabled])').tap({ timeout: 30000 });
  await b.locator('#menu[data-screen="main"]').waitFor({ timeout: 30000 });
  await until('party of two', () => a.locator('.qm-party-member').count(), (c) => c === 2, 20000);
  await until('the raid card offers the party hunt', () => a.locator('.qm-btn[data-mode="raid"] .qm-btn-sub').innerText(), (t) => t.includes('party'), 10000);
  await a.locator('.qm-btn[data-mode="raid"]').click();
  const sa = await until('A in a hunt', () => snap(a), (s) => s?.mode === 2, 60000);
  const sb = await until('B followed into the hunt', () => snap(b), (s) => s?.mode === 2, 60000).catch(async (err) => {
    console.error('B menu:', await b.locator('.qm-status').innerText().catch(() => '?'), '|', await b.locator('.qm-party').innerText().catch(() => '?'), '| screen', await b.locator('#menu').getAttribute('data-screen').catch(() => '?'));
    await b.screenshot({ path: `${out}/xx-b-not-following.png` });
    throw err;
  });
  const ra = await until('two ducks in the run', () => raid(a), (r) => r?.ducks === 2, 30000);
  console.log(`party hunt: ${sa.sessionId} and ${sb.sessionId}, ducks ${ra.ducks}`);
  // The phone taps the card to play with the touch controls.
  await b.locator('#overlay .card').tap().catch(() => undefined);
  await hideOverlay(a);
  await inStage(a, RaidStage.Wave, 1, 40000);
  await until('B sees hunters', () => raid(b), (r) => r.hunters >= 1, 30000);
  await sleep(5000);
  await hideOverlay(a);
  await a.screenshot({ path: `${out}/10-party-wave1-desktop.png` });
  await b.screenshot({ path: `${out}/11-party-wave1-phone.png` });
  await dev(a, 'skip', 5);
  await until('boss on the phone', () => raid(b), (r) => r.bossMax > 0, 30000);
  await sleep(4000);
  await b.screenshot({ path: `${out}/12-boss-phone.png` });
  await dev(a, 'clear');
  await until('cards on the phone', () => raid(b), (r) => r.cardsOpen, 20000);
  await sleep(500);
  await b.screenshot({ path: `${out}/13-cards-phone.png` });
  await b.locator('.raid-card').first().tap();
  await until('the phone picked a card', () => raid(b), (r) => r.picks >= 1 && !r.cardsOpen, 10000);
  await dev(a, 'break');
  await dev(a, 'skip', 15);
  await sleep(1000);
  await dev(a, 'clear');
  await until('end on both', async () => [await raid(a), await raid(b)], ([x, y]) => x.endOpen && y.endOpen, 20000);
  await sleep(2200);
  await a.screenshot({ path: `${out}/14-party-end-desktop.png` });
  await b.screenshot({ path: `${out}/15-party-end-phone.png` });
  await A.ctx.close();
  await B.ctx.close();
}

async function main(): Promise<void> {
  if (!existsSync(`${root}/apps/client/dist-test/index.html`)) throw new Error('Build the test client first: npm run build:test');
  const db = await e2eDatabase('raid');
  const server = run(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], root, {
    PORT: String(SERVER_PORT),
    DATABASE_URL: db.url,
    QWAKK_BOTS: '0',
    QWAKK_RAID_COUNTDOWN: '4',
    QWAKK_TEST_HOOKS: '1',
  });
  const web = run(process.execPath, [`${root}/node_modules/vite/bin/vite.js`, 'preview', '--outDir', process.env.E2E_DIST ?? 'dist-test', '--port', String(WEB_PORT), '--strictPort'], `${root}/apps/client`);
  const procs = [server, web];
  const cleanup = () => procs.forEach((p) => p.exitCode === null && p.kill('SIGINT'));
  process.on('exit', cleanup);
  try {
    await Promise.all([waitForOutput(server, 'canard-quarter navmesh ready'), waitForOutput(web, String(WEB_PORT))]);
    const browser = await chromium.launch({
      ...((process.env.E2E_BROWSER ?? 'chrome') === 'chrome' ? { channel: 'chrome' } : {}),
      headless: true,
      args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
    });
    if (process.env.RAID_ONLY !== 'party') await solo(browser);
    if (process.env.RAID_ONLY !== 'solo') await party(browser);
    await browser.close();
    console.log(`screenshots in ${out}`);
    console.log('RAID E2E OK');
  } finally {
    cleanup();
    await sleep(300);
    await db.drop().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
