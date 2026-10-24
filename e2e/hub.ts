/**
 * Duck Plaza end to end: the real server (a throwaway PostgreSQL database,
 * test hooks on, bots off), `vite preview` of the test bundle and headless
 * Chrome.
 *
 *   Two account ducks pick their duck on the character select and walk into
 *   the plaza; the leader sees the other with its name and level, clicks it
 *   and invites it, the other accepts (Join), both carry the team marker;
 *   speech bubbles; the leader walks into the Deathmatch portal and both
 *   land in the same match as allies, then both come back to the plaza in
 *   front of that portal. The menu sheet (Esc). Prediction corrections 0.
 *   A guest makes its duck on the guest card, finds the Battle Royale portal
 *   locked (a toast with Sign in) and the Deathmatch one open.
 *   A phone (landscape, touch): the plaza with the touch layer, a tap opens a
 *   duck's bubble.
 *
 * Screenshots go to OUTDIR (look at them). Usage: npm run e2e:hub [-- OUTDIR]
 * (npm run build:test first, and the local database: npm run db:up).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { accountSeed, e2eDatabase, seedBrowser, signUpApi } from './lib/accounts.ts';
import { MetaService } from '../apps/server/src/meta/service.ts';

/** A season with made-up rounds, so the plaza's leaderboard board has names on it (12 guest ducks, 30 rounds). */
async function seedLeaderboard(url: string): Promise<void> {
  const meta = new MetaService({ env: { DATABASE_URL: url, SESSION_SECRET: 'e2e-hub-seed-secret-e2e-hub-seed-1' } });
  await meta.start();
  const names = ['BreadBandit', 'SoggyMallard', 'TurboTeal', 'QuackNorris', 'Puddlejumper', 'FeatherStorm', 'MightyDrake', 'LuckyPaddler', 'SneakyBill', 'CosmicQuack', 'SaltyWaddler', 'GoldenEgg'];
  const ids: { playerId: string; name: string }[] = [];
  for (const [i, name] of names.entries()) ids.push({ playerId: ((await meta.createSession({ name }, `10.2.0.${i}`)).body as { playerId: string }).playerId, name });
  for (let m = 0; m < 30; m++) {
    const players = ids.slice(0, 8).map((p, i) => ({ playerId: p.playerId, name: p.name, isBot: false, placement: ((i + m) % 8) + 1, kills: (i * 3 + m) % 7, damage: 300 + i * 40, survivedMs: 300_000 }));
    await meta.recordMatch({ matchId: `hub-seed-${m}`, mode: 'br', mapId: 'sainte-canard', startedAt: Date.now() - 900_000, endedAt: Date.now() - 300_000, players });
  }
  for (let m = 0; m < 10; m++) {
    const players = ids.slice(4).map((p, i) => ({ playerId: p.playerId, name: p.name, isBot: false, placement: ((i + m) % 8) + 1, kills: (i * 2 + m) % 9, damage: 200, survivedMs: 300_000 }));
    await meta.recordMatch({ matchId: `hub-seed-dm-${m}`, mode: 'dm', mapId: 'canard-quarter', startedAt: Date.now() - 900_000, endedAt: Date.now() - 300_000, players });
  }
  await meta.stop();
}

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? join(tmpdir(), 'qwakk-shots-hub');
mkdirSync(out, { recursive: true });
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 2567);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5173);
const API = `http://localhost:${SERVER_PORT}`;
const MENU = `http://localhost:${WEB_PORT}/game/?lang=en&hud=0`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    if (Date.now() > end) throw new Error(`timeout: ${label} (${JSON.stringify(v)?.slice(0, 600)})`);
    await sleep(200);
  }
}

interface HubDuck {
  pid: number;
  name: string;
  tag: string;
  level: number;
  team: number;
  self: boolean;
  seen: boolean;
  pos: { x: number; y: number; z: number } | null;
  screen: { x: number; y: number; on: boolean } | null;
}
interface HubSnap {
  roomId: string;
  me: number;
  pos: { x: number; y: number; z: number };
  ducks: HubDuck[];
  labels: number;
  leaving: boolean;
  bubble: { pid: number; name: string } | null;
  invite: { pid: number; name: string } | null;
  touch: boolean;
  corrected: number;
  reconciles: number;
  maxErr: number;
  fps: number;
}

const hub = (p: Page): Promise<HubSnap | null> => p.evaluate(() => ((window as any).__qwakkHub?.snapshot() ?? null) as never);
const game = (p: Page): Promise<any> => p.evaluate(() => (window as any).__qwakk?.snapshot() ?? null);
const call = (p: Page, fn: string, ...args: unknown[]): Promise<unknown> => p.evaluate(([f, a]) => (window as any).__qwakkHub[f as string](...(a as unknown[])), [fn, args] as const);

async function context(browser: Browser, name: string, opts: Parameters<Browser['newContext']>[0] = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 760 }, ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[${name}] page error:`, e.message));
  page.on('console', (m) => m.type() === 'error' && !/404|401|Failed to load resource/.test(m.text()) && console.error(`[${name}] console:`, m.text()));
  return { ctx, page };
}

/** On the character select: Play, then wait for the plaza (the hub test hook and our duck in the room). */
async function intoPlaza(page: Page, tap = false): Promise<HubSnap> {
  const play = page.locator('.qd-play:not([disabled])');
  if (tap) await play.tap({ timeout: 30000 });
  else await play.click({ timeout: 30000 });
  return until('in the plaza', () => hub(page), (s) => !!s && s.me > 0 && s.ducks.some((d) => d.self), 60000) as Promise<HubSnap>;
}

/** Walk to a point (the dev hook holds W toward it) and wait until there. */
async function walk(page: Page, x: number, z: number, label: string, near = 1.2, ms = 30000): Promise<HubSnap> {
  await call(page, 'walkTo', x, z, ms);
  const s = (await until(`walk: ${label}`, () => hub(page), (v) => !!v && Math.hypot(v.pos.x - x, v.pos.z - z) < near, ms + 2000)) as HubSnap;
  await call(page, 'stop');
  await sleep(250);
  return s;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${out}/${name}.png` });
}

async function accounts(browser: Browser): Promise<void> {
  const leadAcc = await signUpApi(API, 'e2e.hub.lead@example.com', [['PlazaLead', 0]]);
  const mateAcc = await signUpApi(API, 'e2e.hub.mate@example.com', [['PlazaMate', 1]]);
  const A = await context(browser, 'lead');
  const B = await context(browser, 'mate');
  await seedBrowser(A.ctx, accountSeed(leadAcc));
  await seedBrowser(B.ctx, accountSeed(mateAcc));
  await A.page.goto(MENU);
  await B.page.goto(MENU);
  const a0 = await intoPlaza(A.page);
  const b0 = await intoPlaza(B.page);
  if (a0.roomId !== b0.roomId) throw new Error(`two plazas: ${a0.roomId} vs ${b0.roomId}`);
  console.log(`plaza ${a0.roomId}: lead pid ${a0.me} at (${a0.pos.x.toFixed(1)}, ${a0.pos.z.toFixed(1)}), mate pid ${b0.me}`);
  await shot(A.page, '01-plaza-arrive');

  // The mate stands a few meters in front of the leader; the leader turns to it.
  await walk(B.page, 0, 12, 'mate to the pond walk');
  await walk(A.page, 0, 17, 'lead behind it');
  await call(A.page, 'look', 0, -0.12);
  await sleep(600); // the camera turns on the next frames
  const seen = await until('lead sees the mate with name and level', () => hub(A.page), (s) => !!s && s.ducks.some((d) => !d.self && d.seen && d.name === 'PlazaMate' && d.level === 1 && d.tag !== '' && !!d.screen?.on) && s.labels >= 1);
  await sleep(300);
  const mate = (await hub(A.page))!.ducks.find((d) => !d.self)!;
  const label = await A.page.locator('.hl:not([hidden]) .hl-name', { hasText: 'PlazaMate' }).count();
  if (label < 1) throw new Error('no name label over the mate');
  await sleep(500);
  await shot(A.page, '02-plaza-other-duck-label');

  // Click the duck: its bubble, then Invite to team.
  const under = await A.page.evaluate(([x, y]) => { const e = document.elementFromPoint(x!, y!); return e ? `${e.tagName}#${e.id}.${e.className}` : 'none'; }, [mate.screen!.x, mate.screen!.y - 10]);
  console.log(`under the mate: ${under}, a click there picks pid ${await call(A.page, 'pickAt', mate.screen!.x, mate.screen!.y - 10)}`);
  await A.page.mouse.click(mate.screen!.x, mate.screen!.y - 10);
  await until('bubble open', () => hub(A.page), (s) => s?.bubble?.pid === mate.pid);
  await sleep(300);
  await shot(A.page, '03-duck-bubble');
  await A.page.locator('.hu-invite-btn').click();
  await until('the mate got the invite', () => hub(B.page), (s) => s?.invite?.pid === a0.me);
  await B.page.locator('.hu-invite:not([hidden])').waitFor();
  await call(B.page, 'look', Math.PI, -0.2);
  await sleep(500);
  await shot(B.page, '04-invite-bubble');
  await B.page.locator('.hu-accept').click();
  await until('team markers on both', () => hub(A.page), (s) => {
    const me = s?.ducks.find((d) => d.self);
    const other = s?.ducks.find((d) => d.pid === mate.pid);
    return !!me && !!other && me.team > 0 && me.team === other.team;
  }, 20000);
  await A.page.locator('.hu-team:not([hidden])').waitFor({ timeout: 10000 });
  console.log('team linked: both ducks carry the same marker');

  // Speech bubbles.
  await call(A.page, 'chat', 'Hello pond! Deathmatch?');
  await sleep(1300);
  await call(B.page, 'chat', 'Quack yes, lead the way');
  await until('bubble text', () => A.page.locator('.hl-bubble:not([hidden])').allInnerTexts(), (t) => t.some((x) => x.includes('Quack yes')));
  await call(A.page, 'emote', 1);
  await sleep(400);
  await shot(A.page, '05-speech-bubbles-team');

  // The leaderboard board by Fountain Square.
  await walk(A.page, 15.5, 17.5, 'lead to the board');
  await call(A.page, 'look', Math.atan2(-(21 - 15.5), -(21 - 17.5)), 0.22);
  await sleep(1200);
  await shot(A.page, '05b-leaderboard-board');

  // The menu sheet (Esc).
  await A.page.keyboard.press('Escape');
  await A.page.locator('#hub-sheet:not([hidden])').waitFor({ timeout: 5000 });
  await sleep(400);
  await shot(A.page, '06-menu-sheet');
  await A.page.locator('.qm-sheet-tab').nth(1).click();
  await sleep(300);
  await shot(A.page, '06b-menu-sheet-team');
  await A.page.locator('.qm-sheet-resume').click();
  await A.page.locator('#hub-sheet').waitFor({ state: 'hidden' });

  // Each portal from its apron (screenshots), the leader's prediction stays exact.
  // Round the pond on the promenade (the statue island is in the middle).
  const ring = (deg: number): [number, number] => [Math.round(18.4 * Math.cos((deg * Math.PI) / 180) * 10) / 10, Math.round((-4 + 12.6 * Math.sin((deg * Math.PI) / 180)) * 10) / 10];
  const legs: Record<string, [number, number][]> = {
    br: [ring(90), ring(135), ring(180), [-26, -4]],
    raid: [ring(180), ring(135), ring(90), ring(45), ring(0), [26, -4]],
    dm: [ring(0), ring(-45), ring(-90), [0, -27]],
  };
  for (const [id, , , yaw] of [['br', -26, -4, Math.PI / 2], ['raid', 26, -4, -Math.PI / 2], ['dm', 0, -27, 0]] as const) {
    const pts = legs[id]!;
    for (const [i, [x, z]] of pts.entries()) await walk(A.page, x, z, `to the ${id} gate (${i})`, 1.5);
    await call(A.page, 'look', yaw, 0.08);
    await sleep(900);
    await shot(A.page, `07-portal-${id}`);
  }

  // The leader walks into the Deathmatch portal: both land in the same match, as allies.
  const before = (await hub(A.page))!;
  console.log(`lead prediction before the portal: ${before.corrected} corrections in ${before.reconciles} reconciles (max ${before.maxErr.toFixed(4)} m)`);
  if (before.corrected > 0) throw new Error(`prediction corrections in the plaza: ${before.corrected}`);
  await call(A.page, 'walkTo', 0, -42, 15000);
  const gA = await until('lead in the match', () => game(A.page), (s) => !!s?.roomId && s.mode === 0, 45000);
  const gB = await until('mate followed into the same match', () => game(B.page), (s) => !!s?.roomId && s.roomId === gA.roomId, 45000);
  await until('allies', () => game(A.page), (s) => s?.team?.allies?.some((m: { name: string }) => m.name === 'PlazaMate'), 20000);
  console.log(`both in deathmatch ${gA.roomId} (mate ${gB.sessionId}), allies`);
  await sleep(1500);
  await shot(A.page, '08-deathmatch-together');

  // Back to the plaza: in front of the Deathmatch portal.
  for (const p of [A.page, B.page]) {
    await p.locator('#leave:not([hidden])').click({ timeout: 15000 });
  }
  const back = await until('lead back in the plaza', () => hub(A.page), (s) => !!s && s.me > 0 && !s.leaving && s.ducks.some((d) => d.self), 45000);
  await until('mate back too', () => hub(B.page), (s) => !!s && s.me > 0 && !s.leaving, 45000);
  await sleep(800);
  const at = (await hub(A.page))!.pos;
  if (Math.hypot(at.x - 0, at.z - -30.5) > 6) throw new Error(`not back at the Deathmatch gate: (${at.x.toFixed(1)}, ${at.z.toFixed(1)})`);
  console.log(`back in plaza ${back!.roomId} at (${at.x.toFixed(1)}, ${at.z.toFixed(1)})`);
  await call(A.page, 'look', Math.PI, -0.15);
  await sleep(1200);
  await shot(A.page, '09-back-at-the-gate');
  await A.ctx.close();
  await B.ctx.close();
}

async function guest(browser: Browser): Promise<void> {
  const G = await context(browser, 'guest');
  await seedBrowser(G.ctx, { guest: true });
  await G.page.goto(MENU);
  await G.page.locator('.qm-guest:not([hidden])').waitFor({ timeout: 20000 });
  await G.page.locator('#qm-name').fill('PlazaGuest');
  await sleep(300);
  await shot(G.page, '10-guest-card');
  await G.page.locator('.qm-guest-enter').click();
  const s = await until('guest in the plaza', () => hub(G.page), (v) => !!v && v.me > 0, 60000);
  const me = s!.ducks.find((d) => d.self)!;
  if (me.level !== 0 || me.name !== 'PlazaGuest') throw new Error(`guest duck: ${JSON.stringify(me)}`);
  // The Battle Royale portal: locked, a toast with Sign in.
  await walk(G.page, -29, -4, 'guest to the br gate');
  await call(G.page, 'look', Math.PI / 2, 0.05);
  await sleep(600);
  await shot(G.page, '11-guest-br-portal-locked');
  await call(G.page, 'walkTo', -40, -4, 8000);
  await G.page.locator('.hu-toast:not([hidden]) .hu-toast-act').waitFor({ timeout: 10000 });
  const text = await G.page.locator('.hu-toast').innerText();
  if (!/account/i.test(text)) throw new Error(`no lock toast: ${text}`);
  const still = await hub(G.page);
  if (still?.leaving) throw new Error('a guest went through the Battle Royale portal');
  await walk(G.page, -30, -4, 'guest steps back');
  await call(G.page, 'look', Math.PI / 2, 0.05);
  await sleep(700);
  await shot(G.page, '12-guest-locked-toast');
  // Deathmatch opens for a guest.
  for (const [x, z] of [[-18.4, -4], [-13, -12.9], [0, -16.6], [0, -28]] as const) await walk(G.page, x, z, 'guest to the dm gate', 1.5);
  await call(G.page, 'walkTo', 0, -42, 12000);
  await until('guest in a deathmatch', () => game(G.page), (v) => !!v?.roomId && v.mode === 0, 45000);
  console.log('guest: Battle Royale locked, Deathmatch open');
  await G.ctx.close();
}

async function phone(browser: Browser): Promise<void> {
  const acc = await signUpApi(API, 'e2e.hub.phone@example.com', [['PhoneDuck', 1]]);
  const other = await signUpApi(API, 'e2e.hub.other@example.com', [['WaveDuck', 0]]);
  const O = await context(browser, 'other');
  await seedBrowser(O.ctx, accountSeed(other));
  await O.page.goto(MENU);
  await intoPlaza(O.page);
  await walk(O.page, 3, 12, 'other to the pond');
  const P = await context(browser, 'phone', { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await seedBrowser(P.ctx, accountSeed(acc));
  await P.page.goto(MENU);
  await intoPlaza(P.page, true);
  await sleep(800);
  // The first tap starts touch play (the touch layer on).
  await P.page.touchscreen.tap(600, 200);
  await until('touch play on', () => hub(P.page), (s) => !!s?.touch);
  await walk(P.page, 3, 17, 'phone near the other');
  await call(P.page, 'look', 0, -0.15);
  const s = await until('phone sees the other duck', () => hub(P.page), (v) => !!v && v.ducks.some((d) => !d.self && d.seen && !!d.screen?.on));
  await sleep(600);
  await shot(P.page, '13-phone-landscape-plaza');
  await sleep(300);
  const o = (await hub(P.page))!.ducks.find((d) => !d.self && d.seen)!;
  const under = await P.page.evaluate(([x, y]) => { const e = document.elementFromPoint(x!, y!); return e ? `${e.tagName}.${e.className}` : 'none'; }, [o.screen!.x, o.screen!.y - 6]);
  console.log(`phone: under the duck ${under}, a tap there picks pid ${await call(P.page, 'pickAt', o.screen!.x, o.screen!.y - 6)} (other pid ${o.pid})`);
  await P.page.touchscreen.tap(o.screen!.x, o.screen!.y - 6);
  await until('phone bubble', () => hub(P.page), (v) => v?.bubble?.pid === o.pid, 8000);
  await sleep(300);
  await shot(P.page, '14-phone-duck-bubble');
  await P.ctx.close();
  await O.ctx.close();
}

async function main(): Promise<void> {
  if (!existsSync(`${root}/apps/client/dist-test/index.html`)) throw new Error('Build the test client first: npm run build:test');
  const db = await e2eDatabase('hub');
  await seedLeaderboard(db.url);
  const server = run(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], root, {
    PORT: String(SERVER_PORT),
    DATABASE_URL: db.url,
    QWAKK_TEST_HOOKS: '1',
    QWAKK_BOTS: '0',
    QWAKK_DM_SPAWN_RADIUS: '21',
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
    await accounts(browser);
    await guest(browser);
    await phone(browser);
    console.log(`screenshots in ${out}`);
    console.log('HUB E2E OK');
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
