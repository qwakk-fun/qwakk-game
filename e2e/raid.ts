/**
 * Hunt Season end to end on Pond Keep: the real server (test hooks on, a
 * throwaway database), `vite preview` of the test bundle, headless Chrome.
 *
 *   Solo: a signed-in duck (signed up through the API and the dev mail sink)
 *   clicks Hunt Season in the menu and plays with the dev autopilot (it holds
 *   the courtyard behind the gate, fights the hunters it sees and picks a
 *   card). It clears waves 1 and 2 on its own (wave 1 at full hunter damage,
 *   wave 2 held: it never uses the keep's toys). On wave 3 (the Big Hunter's)
 *   the ducks are held (no damage) and the test walks the keep with test
 *   hooks: the wall walk; a bread cannon manned with Use and fired with the
 *   fire button (loaves from the server, the aim arc, no prediction
 *   corrections while manning); riflemen sent to the gate damage it and the
 *   duck repairs it by holding Use; the lever raises the drawbridge (the
 *   hunters at the gate go into the moat) and the wave's hunters paddle the
 *   raft lanes; the boss. Then wave 10 is beaten: the run is won and the
 *   duck's XP (stored by the game server, read back over the account API)
 *   has gone up, with a personal best.
 *
 *   Party: two ducks in a party (one on an emulated phone in landscape, touch
 *   controls) start a hunt: the leader clicks Hunt Season, the member follows
 *   into the same run; both reach wave 1 and see the hunters; then the boss
 *   wave, the cards (tapped on the phone) and the end screen, on both screens.
 *
 * Screenshots to OUTDIR. Usage: npm run e2e:raid [-- OUTDIR] (npm run build:test first).
 * E2E_SERVER_PORT, E2E_WEB_PORT and E2E_DIST pick other ports and a bundle built for them
 * (VITE_SERVER_PORT) while a dev server holds 2567 and 5173.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { BridgeState, Button, RAID, RaidStage } from '@qwakk/shared';
import { accountSeed, e2eDatabase, fetchAccount, pickDuck, seedBrowser, signUpApi } from './lib/accounts.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? join(tmpdir(), 'qwakk-shots-raid');
mkdirSync(out, { recursive: true });
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 2567);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5173);
const DIST = process.env.E2E_DIST ?? 'dist-test';
const API = `http://localhost:${SERVER_PORT}`;
const server_ = `ws://localhost:${SERVER_PORT}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Raid = any;
const raid = (p: Page): Promise<Raid> => p.evaluate(() => (window as any).__qwakk?.raid() ?? null);
const snap = (p: Page): Promise<any> => p.evaluate(() => (window as any).__qwakk?.snapshot() ?? null);
const dev = (p: Page, op: string, wave = 0): Promise<void> => p.evaluate(([o, w]) => (window as any).__qwakk.devRaid(o, w), [op, wave] as const);
const press = (p: Page, buttons: number, ms: number): Promise<void> => p.evaluate(([b, m]) => (window as any).__qwakk.press(b, m), [buttons, ms] as const);
const face = (p: Page, x: number, z: number, ms: number, pitch = 0.02): Promise<void> => p.evaluate(([fx, fz, m, pt]) => (window as any).__qwakk.face(fx, fz, m, pt), [x, z, ms, pitch] as const);
const hideOverlay = (p: Page): Promise<void> => p.evaluate(() => document.getElementById('overlay')?.classList.add('hidden'));

function run(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}): ChildProcess {
  return spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function waitForOutput(proc: ChildProcess, needle: string, timeoutMs = 120000): Promise<void> {
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

/**
 * Face the nearest hunter that passes `want` (the autopilot pauses meanwhile) and take a screenshot; skipped with a
 * note if none comes. `towers`: first move to the cannon stand spot (a tower top) nearest to it, to see past the walls.
 */
async function closeUp(p: Page, want: (h: { kind: number; act: number; dist: number }) => boolean, path: string, ms: number, pitch = -0.02, towers: { x: number; z: number }[] = []): Promise<boolean> {
  const end = Date.now() + ms;
  const list = (): Promise<{ id: string; kind: number; act: number; x: number; y: number; z: number; dist: number }[]> => p.evaluate(() => (window as any).__qwakk.hunters());
  while (Date.now() < end) {
    let h = (await list()).find((x) => x.act !== 11 && want(x));
    if (h) {
      if (towers.length > 0) {
        const at = h;
        const i = towers.map((t, k) => [Math.hypot(t.x - at.x, t.z - at.z), k] as const).sort((a, b) => a[0] - b[0])[0]![1];
        await dev(p, 'tp', i + 1);
        await sleep(1200);
        h = (await list()).find((x) => x.id === at.id) ?? at;
      }
      await face(p, h.x, h.z, 1600, pitch);
      await sleep(800);
      await hideOverlay(p);
      await p.screenshot({ path });
      console.log(`close-up: kind ${h.kind} act ${h.act} at ${h.dist.toFixed(1)} m -> ${path}`);
      return true;
    }
    await sleep(200);
  }
  console.log(`close-up skipped (none came): ${path}`);
  return false;
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

/** The keep's layout as this client loaded it (the map's markup). */
const keepOf = (p: Page): Promise<{ gate: { x: number; z: number; nx: number; nz: number }; lever: number[]; cannons: { x: number; z: number; yaw: number }[]; core: { x: number; z: number } }> =>
  p.evaluate(() => (window as any).__qwakk.keep());

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
  const map = (await snap(a)).mapId;
  if (map !== RAID.mapId) throw new Error(`the hunt is on ${map}, not ${RAID.mapId}`);
  await hideOverlay(a);
  await sleep(1500);
  await a.screenshot({ path: `${out}/02-lobby-courtyard.png` });
  await inStage(a, RaidStage.Wave, 1, 30000);
  const t0 = Date.now();
  const first = await until('hunters out', () => raid(a), (r) => r.hunters >= 2, 30000);
  console.log(`wave 1: ${JSON.stringify({ hunters: first.hunters, core: first.core, gate: first.gate, keepModels: first.keepModels })}`);
  await sleep(5000);
  await hideOverlay(a);
  await a.screenshot({ path: `${out}/03-wave1-hunters.png` });
  await closeUp(a, (h) => h.kind === 1 && h.act === 3 && h.dist < 90, `${out}/03b-rifleman-laser.png`, 25000);
  // Waves 1 and 2, cleared by the autopilot alone (it holds the courtyard; the hunters come through the gate).
  for (const w of [1, 2]) {
    const r = await until(`wave ${w} cleared by the autopilot`, () => raid(a), (x) => (x.stage === RaidStage.Break && x.wave === w) || x.stage === RaidStage.Lost || x.stage === RaidStage.Won, 300000);
    if (r.stage === RaidStage.Lost) {
      await a.screenshot({ path: `${out}/xx-lost-wave${w}.png` });
      throw new Error(`the autopilot lost the run on wave ${w}: ${JSON.stringify(r)}`);
    }
    console.log(`wave ${w} cleared in ${((Date.now() - t0) / 1000).toFixed(0)} s (kills ${r.teamKills}, core ${r.core}/${r.coreMax}, gate ${r.gate}/${r.gateMax}, hp ${Math.round(r.hp)})`);
    await until('cards up', () => raid(a), (x) => x.offers >= w, 10000);
    if (w === 1) {
      await sleep(400);
      await a.screenshot({ path: `${out}/04-upgrade-cards.png` });
    }
    const picked = await until('the autopilot picked a card, the server took it', () => raid(a), (x) => x.picks >= w && !x.cardsOpen, 15000);
    console.log(`card picked (picks ${picked.picks}), max health now ${picked.maxHp}`);
    // Wave 1 at full hunter damage; from wave 2 on the duck is held (the autopilot only shoots: it never mans a cannon,
    // pulls the lever or mends the gate, so a solo wave 2 with a sniper and dogs is a coin toss for it). It still has to bag every hunter.
    if (w === 1) await dev(a, 'hold');
    await dev(a, 'break');
    await inStage(a, RaidStage.Wave, w + 1, 15000);
  }
  // Wave 3: the Big Hunter's. Ducks held (no damage) while the test walks the keep.
  await inStage(a, RaidStage.Wave, 3, 20000);
  await dev(a, 'hold');
  const keep = await keepOf(a);
  const g = keep.gate;
  // The wall walk near the gate, looking out over the moat at the field.
  await dev(a, 'tp', 7);
  await sleep(1200);
  await face(a, g.x + g.nx * 60, g.z + g.nz * 60, 2500, -0.12);
  await sleep(900);
  await hideOverlay(a);
  await a.screenshot({ path: `${out}/05-wall-walk.png` });
  // A bread cannon: to its stand spot, Use mans it (the sim's own bit), then fire, looking out over the field.
  const c0 = keep.cannons[0]!;
  await dev(a, 'tp', 1);
  await sleep(1500);
  await a.evaluate(() => (window as any).__qwakk.resetStats());
  await face(a, c0.x - Math.sin(c0.yaw) * 70, c0.z - Math.cos(c0.yaw) * 70, 9000, -0.08);
  await sleep(300);
  await press(a, Button.Use, 120);
  await until('manning the cannon', () => raid(a), (x) => x.manning === 0, 5000);
  await press(a, Button.Fire, 5000);
  const firing = await until('loaves away', () => raid(a), (x) => x.fired >= 1 && (x.cannons.find((k: any) => k.i === 0)?.heat ?? 0) > 0, 8000);
  await sleep(500);
  await hideOverlay(a);
  await a.screenshot({ path: `${out}/06-cannon-firing.png` });
  await sleep(2500);
  await until('the loaves burst where they land', () => a.evaluate(() => (window as any).__qwakk.explosives()), (x) => x.booms >= 2, 10000);
  const booms = (await a.evaluate(() => (window as any).__qwakk.explosives())).booms;
  const pred = (await snap(a)).prediction;
  console.log(`cannon: fired ${firing.fired} (predicted thumps), heat ${firing.cannons[0]?.heat}, booms drawn ${booms}, prediction while manning: ${pred.reconciles} reconciles, ${pred.corrected} corrected (max ${pred.maxErrM.toFixed(4)} m)`);
  if (pred.corrected !== 0) throw new Error(`prediction corrections while manning a cannon: ${pred.corrected}`);
  if (booms < 1) throw new Error('no loaf burst was drawn');
  await press(a, Button.Jump, 120);
  await until('left the cannon', () => raid(a), (x) => x.manning === -1, 5000);
  // The gate: riflemen sent to it hammer it down to its damaged look.
  await dev(a, 'gatehunters', 6);
  const hurt = await until('the gate takes damage', () => raid(a), (x) => x.gate < x.gateMax * 0.45, 90000);
  console.log(`gate hammered to ${hurt.gate}/${hurt.gateMax} (look ${hurt.gateState})`);
  await dev(a, 'tp', 6);
  await sleep(1200);
  await face(a, g.x, g.z, 3000, 0.05);
  await sleep(800);
  await hideOverlay(a);
  await a.screenshot({ path: `${out}/07-gate-damaged.png` });
  // The lever: the drawbridge rises, the hunters in the gate passage go into the moat and the gate is covered.
  await dev(a, 'tp', 5);
  await sleep(1200);
  await face(a, g.x, g.z, 3000, 0.1);
  const splashBefore = (await raid(a)).splashes;
  await press(a, Button.Use, 150);
  const up = await until('the drawbridge rises', () => raid(a), (x) => x.bridge === BridgeState.Raising || x.bridge === BridgeState.Up, 5000);
  const splashed = await until('hunters splashed into the moat', () => raid(a), (x) => x.splashes > splashBefore, 4000).catch(() => null);
  console.log(`lever pulled: bridge ${up.bridge}, hunters splashed ${splashed ? splashed.splashes - splashBefore : 0}, lever ready at ${up.leverReady}`);
  // Now the duck mends the gate (holding Use at it), safe from the hammering.
  await dev(a, 'tp', 6);
  await sleep(1200);
  const low = (await raid(a)).gate;
  await face(a, g.x, g.z, 7500, 0.05);
  await press(a, Button.Use, 7000);
  const fixed = await until('the gate repaired', () => raid(a), (x) => x.gate > low + 120, 9000);
  console.log(`gate repaired ${low} -> ${fixed.gate} (look ${fixed.gateState})`);
  await sleep(500);
  await hideOverlay(a);
  await a.screenshot({ path: `${out}/08-gate-repaired.png` });
  await until('the drawbridge is up', () => raid(a), (x) => x.bridge === BridgeState.Up, 8000);
  // From the field past the moat: the raised drawbridge in front of the gatehouse.
  await dev(a, 'tp', 8);
  await sleep(1200);
  await face(a, g.x, g.z, 2500, 0.08);
  await sleep(900);
  await hideOverlay(a);
  await a.screenshot({ path: `${out}/09-drawbridge-up.png` });
  // From the nearest tower top: hunters on a raft lane across the moat.
  const towers = keep.cannons.map((c) => ({ x: c.x, z: c.z }));
  const rafting = await closeUp(a, (h) => h.act === 12, `${out}/10-hunters-on-rafts.png`, 30000, -0.3, towers);
  if (!rafting) console.log('note: no hunter paddled across while the bridge was up');
  // The Big Hunter: the wave's one is out (the boss bar); for the close-up one more stands 8 m in front of the duck in the field (test hook).
  await until('the Big Hunter', () => raid(a), (x) => x.bossMax > 0, 30000);
  await dev(a, 'tp', 8);
  await sleep(1000);
  await face(a, g.x + g.nx * 60, g.z + g.nz * 60, 4000, -0.05);
  await sleep(600);
  await dev(a, 'spawn', 5);
  await sleep(1500);
  await closeUp(a, (h) => h.kind === 5 && h.dist < 16, `${out}/11-boss.png`, 10000, 0.05);
  // Wave 10, beaten: the run is won and XP is granted by the server.
  await dev(a, 'skip', RAID.waves);
  await sleep(1500);
  await dev(a, 'clear');
  const end = await until('end screen', () => raid(a), (x) => x.endOpen && x.ended >= 2, 20000);
  console.log(`run won: ended messages ${end.ended}, kills ${end.teamKills}`);
  await sleep(2000);
  await a.screenshot({ path: `${out}/12-end-screen.png` });
  const after = (await fetchAccount(API, A.token)).characters[0]!;
  console.log(`XP ${before.xp} -> ${after.xp}, level ${before.level} -> ${after.level}, best ${JSON.stringify(after.raidBest)}`);
  if (!(after.xp > before.xp)) throw new Error('the duck got no XP');
  if (!after.raidBest || after.raidBest.wave < 3) throw new Error('no personal best stored');
  // Back to the pond: the menu shows the new level and the XP bar.
  await a.locator('.raid-end-buttons .back').click();
  await a.locator('#menu[data-screen="main"]').waitFor({ timeout: 20000 });
  await until('the menu shows the XP', () => a.locator('.qm-active-xp .qm-xp-text').innerText().catch(() => ''), (t) => /XP|Max/.test(t), 10000);
  await sleep(2500);
  await a.screenshot({ path: `${out}/13-menu-after-xp.png` });
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
  await a.screenshot({ path: `${out}/20-party-wave1-desktop.png` });
  await b.screenshot({ path: `${out}/21-party-wave1-phone.png` });
  // The phone at a cannon: the touch Use button shows, and the cannon panel once manned.
  await dev(b, 'tp', 2);
  await until('the phone sees the Use prompt', () => b.locator('.raid-prompt').innerText().catch(() => ''), (t) => t.length > 0, 8000).catch(() => console.log('note: no Use prompt text on the phone'));
  await press(b, Button.Use, 120);
  await until('the phone mans a cannon', () => raid(b), (x) => x.manning === 1, 6000);
  await sleep(800);
  await b.screenshot({ path: `${out}/22-cannon-phone.png` });
  await press(b, Button.Jump, 120);
  await dev(a, 'skip', RAID.bossWaves[0]!);
  await until('boss on the phone', () => raid(b), (r) => r.bossMax > 0, 30000);
  await sleep(4000);
  await b.screenshot({ path: `${out}/23-boss-phone.png` });
  await dev(a, 'clear');
  await until('cards on the phone', () => raid(b), (r) => r.cardsOpen, 20000);
  await sleep(500);
  await b.screenshot({ path: `${out}/24-cards-phone.png` });
  await b.locator('.raid-card').first().tap();
  await until('the phone picked a card', () => raid(b), (r) => r.picks >= 1 && !r.cardsOpen, 10000);
  await dev(a, 'break');
  await dev(a, 'skip', RAID.waves);
  await sleep(1000);
  await dev(a, 'clear');
  await until('end on both', async () => [await raid(a), await raid(b)], ([x, y]) => x.endOpen && y.endOpen, 20000);
  await sleep(2200);
  await a.screenshot({ path: `${out}/25-party-end-desktop.png` });
  await b.screenshot({ path: `${out}/26-party-end-phone.png` });
  await A.ctx.close();
  await B.ctx.close();
}

async function main(): Promise<void> {
  const dist = isAbsolute(DIST) ? DIST : `${root}/apps/client/${DIST}`;
  if (!existsSync(`${dist}/index.html`)) throw new Error('Build the test client first: npm run build:test');
  const db = await e2eDatabase('raid');
  const server = run(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], root, {
    PORT: String(SERVER_PORT),
    DATABASE_URL: db.url,
    QWAKK_BOTS: '0',
    QWAKK_RAID_COUNTDOWN: '4',
    QWAKK_TEST_HOOKS: '1',
  });
  const web = run(process.execPath, [`${root}/node_modules/vite/bin/vite.js`, 'preview', '--outDir', DIST, '--port', String(WEB_PORT), '--strictPort'], `${root}/apps/client`);
  const procs = [server, web];
  const cleanup = () => procs.forEach((p) => p.exitCode === null && p.kill('SIGINT'));
  process.on('exit', cleanup);
  try {
    await Promise.all([waitForOutput(server, `${RAID.mapId} navmesh ready`, 240000), waitForOutput(web, String(WEB_PORT))]);
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
