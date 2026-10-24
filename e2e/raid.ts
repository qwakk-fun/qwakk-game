/**
 * Hunt Season end to end (v3, the push with the katana) on Pond Keep: the
 * real server (test hooks on, a throwaway database), `vite preview` of the
 * test bundle, headless Chrome.
 *
 *   Solo: a signed-in duck walks through Duck Plaza's Hunt Season portal into
 *   a run and plays with the dev autopilot (it cuts with the katana, dashes,
 *   quacks, lets the Blade Storm go, walks out through the gate to the
 *   objective). Packs held off, it meets a minion pack in the field: one
 *   swing cuts several (a multi-kill), the dash and the "VAK!" shockwave are
 *   used, the combo grows, the damage numbers show; the storm with a full
 *   meter. Then the packs come again and it takes the first objective (the
 *   trench) at full hunter damage, picks a card. The other objectives are
 *   skipped through with test hooks for their screenshots (the crates and
 *   their markers, the watchtowers with snipers, the Big Hunter's camp), the
 *   run is won and the duck's XP (stored by the game server, read back over
 *   the account API) has gone up. Prediction corrections 0 through all of it.
 *
 *   Progression (docs/progression.md), the same duck: it starts at level 1
 *   with the light combo only (Dash, VAK! and the storm locked on the HUD; a
 *   pressed Dash does nothing, the server masks it), so the kit checks above
 *   use the `unlock` test hook for that run only. The win levels it up (the
 *   end screen says Dash is unlocked) and earns Tüy; back in Duck Plaza it
 *   walks to the Blacksmith, buys and equips the Bamboo Blade, spends a tree
 *   point on Sharp Edge (My Duck), and in its next run Dash is unlocked and
 *   its plain cuts deal the new damage (24 x 1.07 x 1.03 = 26, was 24).
 *
 *   Party: two ducks in a party, one on an emulated phone in landscape
 *   (touch controls), start a run: the phone fights with its touch skill
 *   buttons (Dash, VAK!, the storm) and the Fire button; screenshots of both;
 *   the end screen on both. The phone's duck is a veteran (level 20, set in
 *   the throwaway database) that bought the Dragon Fang and the Toony Plate
 *   over the API: both screens show its gear; the desktop duck is fresh.
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
import postgres from 'postgres';
import { Button, Goal, RAID, RaidStage, xpForLevel } from '@qwakk/shared';
import { shopSpot } from '@qwakk/shared/hub';
import { accountSeed, e2eDatabase, fetchAccount, openSheet, pickDuck, seedBrowser, signUpApi, waitPlaza } from './lib/accounts.ts';
import { center, Fingers } from './lib/fingers.ts';

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
const hub = (p: Page): Promise<any> => p.evaluate(() => (window as any).__qwakkHub?.snapshot() ?? null);
const hubCall = (p: Page, fn: string, ...args: unknown[]): Promise<unknown> => p.evaluate(([f, a]) => (window as any).__qwakkHub[f as string](...(a as unknown[])), [fn, args] as const);

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
    if (Date.now() > end) throw new Error(`timeout: ${label} (${JSON.stringify(v)?.slice(0, 900)})`);
    await sleep(250);
  }
}

let n = 0;
async function newDuck(browser: Browser, name: string, phone = false): Promise<{ ctx: BrowserContext; page: Page; token: string }> {
  const ctx = phone
    ? await browser.newContext({ locale: 'en-US', viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    : await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 720 } });
  const s = await signUpApi(API, `e2e.raid${++n}.${Date.now() % 100000}@example.com`, [[`${name}${n}`, n % 2]]);
  await seedBrowser(ctx, accountSeed(s));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[${name}] page error:`, e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.error(`[${name}] console:`, m.text()));
  return { ctx, page, token: s.session.accountToken };
}

const menuUrl = (extra = ''): string => `http://localhost:${WEB_PORT}/game/?lang=en&server=${server_}&hud=0&menu=1${extra}`;

/** Wait until this page is in a run at a stage (and objective). */
const inStage = (p: Page, stage: number, wave: number, ms: number): Promise<Raid> => until(`stage ${stage} objective ${wave}`, () => raid(p), (r) => r?.stage === stage && r.wave >= wave, ms);

/** Screenshots every `everyMs` while `test` holds (a fight: the best frames show the swing); returns how many. */
async function burst(p: Page, name: string, count: number, everyMs: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await hideOverlay(p);
    await p.screenshot({ path: `${out}/${name}-${String(i).padStart(2, '0')}.png` });
    await sleep(everyMs);
  }
}

/** Walk in the plaza (the hub's test hook) and wait until there. */
async function plazaWalk(p: Page, x: number, z: number, label: string, near = 1.6): Promise<void> {
  await hubCall(p, 'walkTo', x, z, 20000);
  await until(label, () => hub(p), (s) => !!s && Math.hypot(s.pos.x - x, s.pos.z - z) < near, 22000);
}

/** The game session token of an account's first duck (the /api/duck routes take it). */
async function duckToken(accountToken: string): Promise<{ id: string; token: string }> {
  const acc = await fetchAccount(API, accountToken);
  const id = acc.characters[0]!.id;
  const res = await fetch(`${API}/api/account/play`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accountToken}` }, body: JSON.stringify({ id }) });
  const j = (await res.json()) as { token: string };
  return { id, token: j.token };
}

async function duckApi(token: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API}/api/duck${path}`, body === undefined ? { headers: { authorization: `Bearer ${token}` } } : { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const j = (await res.json()) as any;
  if (!res.ok) throw new Error(`/api/duck${path}: ${res.status} ${j.error}`);
  return j.duck;
}

let dbUrl = '';

async function noCorrections(p: Page, label: string): Promise<void> {
  const pred = (await snap(p)).prediction;
  console.log(`${label}: ${pred.reconciles} reconciles, ${pred.corrected} corrected (max ${pred.maxErrM.toFixed(4)} m)`);
  if (pred.corrected !== 0) throw new Error(`prediction corrections (${label}): ${pred.corrected}`);
}

async function solo(browser: Browser): Promise<void> {
  const A = await newDuck(browser, 'Hunt');
  const a = A.page;
  const before = (await fetchAccount(API, A.token)).characters[0]!;
  await a.goto(menuUrl('&autopilot=raid'));
  await pickDuck(a);
  // Through Duck Plaza's Hunt Season portal (east), round the pond on the promenade.
  const ring = (deg: number): [number, number] => [Math.round(18.4 * Math.cos((deg * Math.PI) / 180) * 10) / 10, Math.round((-4 + 12.6 * Math.sin((deg * Math.PI) / 180)) * 10) / 10];
  for (const [x, z] of [ring(90), ring(45), ring(0), [26, -4]] as [number, number][]) {
    await hubCall(a, 'walkTo', x, z, 20000);
    await until(`plaza walk to ${x}, ${z}`, () => hub(a), (s) => !!s && Math.hypot(s.pos.x - x, s.pos.z - z) < 1.6, 22000);
  }
  await hubCall(a, 'look', -Math.PI / 2, 0.08);
  await sleep(900);
  await a.screenshot({ path: `${out}/01-plaza-hunt-portal.png` });
  await hubCall(a, 'walkTo', 44, -4, 15000);
  await until('in a hunt through the portal', () => snap(a), (s) => s?.mode === 2, 60000);
  const map = (await snap(a)).mapId;
  if (map !== RAID.mapId) throw new Error(`the hunt is on ${map}, not ${RAID.mapId}`);
  await hideOverlay(a);
  await sleep(1500);
  await a.screenshot({ path: `${out}/02-lobby-katana.png` });
  // A fresh duck: level 1, the light combo only. The HUD shows Dash, VAK! and the storm locked; a pressed Dash does nothing.
  const k0 = await until('the kit from the server', () => raid(a), (r) => r?.kit?.known, 15000);
  if (k0.kit.level !== 1 || k0.kit.unlocks !== 0) throw new Error(`a fresh duck's kit: ${JSON.stringify(k0.kit)}`);
  await until('locked skill buttons', () => raid(a), (r) => ['dash', 'quack', 'storm'].every((x) => r.skillLocks.includes(x)), 10000);
  await press(a, Button.Dash, 200);
  await sleep(400);
  const k1 = await raid(a);
  if (k1.blade.dashes !== 0 || (k1.ex & 127) !== 0) throw new Error(`a level 1 duck dashed: ${JSON.stringify(k1.blade)} ex ${k1.ex}`);
  await a.screenshot({ path: `${out}/02b-locked-skills.png` });
  await a.screenshot({ path: `${out}/02c-locked-skills-hud.png`, clip: { x: 900, y: 520, width: 380, height: 200 } });
  // The kit test below needs every move: the test hook unlocks them for this run only (the stored level stays 1).
  await dev(a, 'unlock');
  await until('every move unlocked for this run', () => raid(a), (r) => r.kit.unlocks === 31 && r.skillLocks.length === 0, 10000);
  await inStage(a, RaidStage.Fight, 1, 30000);
  const r1 = await until('the trench objective', () => raid(a), (r) => r.goal === Goal.Trench && r.gNeed > 0, 10000);
  console.log(`objective 1: the trench, ${r1.gNeed} hunters to bag`);
  await sleep(2500);
  await hideOverlay(a);
  await a.screenshot({ path: `${out}/03-objective-1.png` });

  // The kit, with the packs held off and the duck held (no damage): out in the field, a pack charges it.
  await dev(a, 'quiet', 1);
  await dev(a, 'freeze', 1);
  await dev(a, 'hold');
  await dev(a, 'tpgoal', 30);
  await sleep(1500);
  await a.evaluate(() => (window as any).__qwakk.resetStats());
  const kb = (await raid(a)).blade;
  await dev(a, 'pack', 10);
  // The autopilot meets it: dash in, cut, quack when surrounded.
  await sleep(600);
  await burst(a, '04-pack-fight', 10, 260);
  const fight = await until('the autopilot cuts the pack down', () => raid(a), (r) => r.blade.mostKilledAtOnce >= 2 && r.blade.dashes > kb.dashes, 30000);
  console.log(`pack: swings ${fight.blade.swings}, predicted hits ${fight.blade.predictedHits} (multi ${fight.blade.multiHits}), most killed by one swing ${fight.blade.mostKilledAtOnce}, dashes ${fight.blade.dashes}, quacks ${fight.blade.quacks}, combo ${fight.blade.bestCombo}, numbers ${fight.blade.numbers}`);
  // Surrounded: the "VAK!" shockwave (the autopilot quacks with 4 around; press it once to be sure).
  await dev(a, 'pack', 8);
  await sleep(900);
  if ((await raid(a)).blade.quacks === 0) await press(a, Button.Quack, 120);
  await until('a quack', () => raid(a), (r) => r.blade.quacks >= 1, 10000);
  await sleep(150);
  await hideOverlay(a);
  await a.screenshot({ path: `${out}/05-shockwave.png` });
  // The Blade Storm with a full meter (the autopilot lets it go with two hunters near).
  await dev(a, 'meter');
  await dev(a, 'pack', 8);
  await until('the Blade Storm', () => raid(a), (r) => r.blade.storms >= 1, 15000);
  await sleep(700);
  await burst(a, '06-blade-storm', 3, 300);
  await until('the pack gone', () => raid(a), (r) => r.hunters === 0, 30000).catch(() => console.log('note: hunters still standing after the storm'));
  await noCorrections(a, 'prediction while dashing, cutting, quacking and spinning');
  const after = (await raid(a)).blade;
  if (after.dashes < 1 || after.quacks < 1 || after.storms < 1 || after.mostKilledAtOnce < 2) throw new Error(`the kit was not used in full: ${JSON.stringify(after)}`);

  // The trench at full hunter damage: its count starts over, the packs come again, the autopilot takes the objective.
  // The autopilot is no expert: alone at full damage it loses about one trench in two (it did before progression too).
  // A lost run is a real run (stored, XP and Tüy); "Play again" starts the next one and the autopilot tries again, up to 4 runs.
  let took: Raid = null;
  let t0 = Date.now();
  for (let attempt = 1; ; attempt++) {
    await dev(a, 'resetgoal');
    await dev(a, 'freeze', 0);
    await dev(a, 'hold', 2);
    await dev(a, 'quiet', 0);
    await dev(a, 'tpgoal', 22);
    t0 = Date.now();
    await sleep(4000);
    await burst(a, '07-trench-fight', 4, 1200);
    took = await until('the trench taken by the autopilot', () => raid(a), (r) => r.cleared >= 1 || r.stage === RaidStage.Lost, 240000);
    if (took.stage !== RaidStage.Lost) break;
    await a.screenshot({ path: `${out}/xx-lost-trench-${attempt}.png` });
    if (attempt >= 4) throw new Error(`the autopilot lost the run on the trench ${attempt} times: ${JSON.stringify(took).slice(0, 600)}`);
    console.log(`note: the autopilot lost the trench (run ${attempt}, ${took.teamKills} kills); Play again`);
    await until('the lost run stored', () => raid(a), (x) => x.endOpen && x.ended >= 2, 20000);
    await a.locator('.raid-end-buttons .again').click();
    await until('in the next hunt', () => raid(a), (r) => !!r && r.stage === RaidStage.Fight && r.ended === 0, 60000);
    await hideOverlay(a);
    await dev(a, 'unlock');
    await until('every move again', () => raid(a), (r) => r.kit.unlocks === 31, 10000);
    await dev(a, 'quiet', 1);
    await dev(a, 'hold');
    await sleep(1000);
  }
  // The rest is for screenshots: the duck is held from here on.
  await dev(a, 'hold');
  console.log(`trench taken in ${((Date.now() - t0) / 1000).toFixed(0)} s (team kills ${took.teamKills}, hp ${Math.round(took.hp)}, best combo ${took.blade.bestCombo}, streaks ${took.blade.streaks})`);
  await until('cards offered', () => raid(a), (x) => x.offers >= 1, 10000);
  if ((await raid(a)).cardsOpen) {
    await sleep(300);
    await a.screenshot({ path: `${out}/08-melee-cards.png` });
  }
  await until('the autopilot picked a card', () => raid(a), (x) => x.picks >= 1 && !x.cardsOpen, 15000);
  // Objectives 2 to 4, each taken by a test hook after its screenshot: the supply crates by the dugouts (markers over them),
  // the watchtowers with their snipers (the pistol's job), the Big Hunter's camp.
  const shots: [number, string, number, number][] = [[Goal.Crates, '09-supply-crates', 12, -0.12], [Goal.Towers, '10-watchtower-snipers', 30, 0.12], [Goal.Camp, '11-boss-camp', 14, 0.05]];
  for (const [goal, name, short, pitch] of shots) {
    await dev(a, 'break');
    await inStage(a, RaidStage.Fight, goal, 15000);
    const r = await until(`objective ${goal}`, () => raid(a), (x) => x.goal === goal && (goal !== Goal.Camp || x.bossMax > 0), 10000);
    await dev(a, 'tpgoal', short);
    await sleep(2200);
    const at = r.targets.find((t: { done: number }) => t.done === 0) ?? { x: r.gx, z: r.gz };
    await face(a, at.x, at.z, 3000, pitch);
    await sleep(1100);
    await hideOverlay(a);
    await a.screenshot({ path: `${out}/${name}.png` });
    await dev(a, 'clear');
    await until(`objective ${goal} taken`, () => raid(a), (x) => x.cleared >= goal, 15000);
  }
  const end = await until('end screen', () => raid(a), (x) => x.endOpen && x.ended >= 2, 20000);
  console.log(`run won: ended messages ${end.ended}, team kills ${end.teamKills}`);
  // The level-up lines name the new moves (Dash first, unless a lost run before this one already gave level 2), the Tüy line the run's feathers.
  await a.locator('.raid-end-xp .unlock').first().waitFor({ timeout: 8000 });
  const unlockText = (await a.locator('.raid-end-xp .unlock').allInnerTexts()).join(' / ');
  const tuyText = await a.locator('.raid-end-xp .gain.tuy').innerText();
  console.log(`end screen: "${unlockText}", "${tuyText}"`);
  if (!/New skill unlocked/.test(unlockText)) throw new Error(`no "New skill unlocked" on the end screen: ${unlockText}`);
  await sleep(2000);
  await a.screenshot({ path: `${out}/12-end-screen.png` });
  const afterAcc = (await fetchAccount(API, A.token)).characters[0]!;
  console.log(`XP ${before.xp} -> ${afterAcc.xp}, level ${before.level} -> ${afterAcc.level}, best ${JSON.stringify(afterAcc.raidBest)}`);
  if (!(afterAcc.xp > before.xp)) throw new Error('the duck got no XP');
  if (!(afterAcc.level >= 2)) throw new Error(`no level-up: ${afterAcc.level}`);
  if (!afterAcc.raidBest || afterAcc.raidBest.wave < RAID.objectives) throw new Error('no personal best stored');
  // A plain cut of the first run: the bokken's 24.
  const plain1 = end.blade.plain as Record<string, number>;
  if (!plain1['24']) throw new Error(`no plain 24 cut in the first run: ${JSON.stringify(plain1)}`);
  await a.locator('.raid-end-buttons .back').click();
  await waitPlaza(a);
  const plazaLevel = await a.evaluate(() => (window as any).__qwakkHub.snapshot().ducks.find((d: { self: boolean }) => d.self)?.level ?? 0);
  if (plazaLevel !== afterAcc.level) throw new Error(`the plaza shows level ${plazaLevel}, the account has ${afterAcc.level}`);
  await progressionChain(a, A.token, afterAcc.level);
  await A.ctx.close();
}

/**
 * After the first run: Tüy earned, the Blacksmith (walk up, E, buy and equip
 * the Bamboo Blade), My Duck (spend a point on Sharp Edge), then a second run
 * from the sheet: Dash unlocked, the new damage on plain cuts, 0 corrections.
 */
async function progressionChain(a: Page, accountToken: string, level: number): Promise<void> {
  const { token } = await duckToken(accountToken);
  const firstRoom = (await snap(a))?.roomId ?? '';
  const d0 = await duckApi(token, '');
  console.log(`after the first run: level ${d0.level}, ${d0.feathers} Tüy, owned ${d0.owned.join(', ')}`);
  if (!(d0.feathers >= 200)) throw new Error(`not enough Tüy for the Bamboo Blade: ${d0.feathers}`);
  // The Blacksmith: around the fountain square's west side, to the spot in front of its counter.
  const spot = shopSpot('smith');
  await plazaWalk(a, -6, 21, 'to the market');
  await plazaWalk(a, spot.x, spot.z, 'to the Blacksmith', 1.2);
  await hubCall(a, 'look', Math.PI / 2, -0.08);
  await a.locator('.hu-shop:not([hidden])').waitFor({ timeout: 10000 });
  await sleep(500);
  await a.screenshot({ path: `${out}/13-blacksmith-stall.png` });
  await a.keyboard.press('KeyE');
  await a.locator('.qp-shop:not([hidden]) .qp-item[data-item="katana_bamboo"] .qp-buy:not([disabled])').waitFor({ timeout: 10000 });
  await sleep(300);
  await a.screenshot({ path: `${out}/14-shop-blacksmith.png` });
  await a.locator('.qp-item[data-item="katana_bamboo"] .qp-buy').click();
  await a.locator('.qp-item[data-item="katana_bamboo"] .qp-equip').click({ timeout: 10000 });
  await a.locator('.qp-item.is-on[data-item="katana_bamboo"]').waitFor({ timeout: 10000 });
  await sleep(300);
  await a.screenshot({ path: `${out}/15-shop-equipped.png` });
  await a.locator('.qp-shop-x').click();
  await until('the shop closed', () => a.locator('.qp-shop:not([hidden])').count(), (c) => c === 0, 5000);
  // My Duck: the tree, one point on Sharp Edge.
  await openSheet(a, 6);
  await a.locator('.qp-node[data-node="edge"]:not([disabled])').waitFor({ timeout: 10000 });
  await sleep(300);
  await a.screenshot({ path: `${out}/16-my-duck.png` });
  await a.locator('.qp-node[data-node="edge"]').click();
  await a.locator('.qp-node.has-rank[data-node="edge"]').waitFor({ timeout: 10000 });
  await sleep(300);
  await a.screenshot({ path: `${out}/17-my-duck-spent.png` });
  const d1 = await duckApi(token, '');
  console.log(`bought and spent: ${d1.feathers} Tüy, katana ${d1.equipped.katana}, tree ${JSON.stringify(d1.tree)}`);
  if (d1.equipped.katana !== 'katana_bamboo' || d1.tree.edge !== 1 || d1.feathers !== d0.feathers - 200) throw new Error(`the purchase or the spend did not stick: ${JSON.stringify(d1)}`);
  // The next run, from the sheet's mode list.
  await openSheet(a, 0);
  await a.locator('.qm-sheet-mode[data-mode="raid"]').click();
  // The test hook keeps the last game's view until the next one replaces it: wait for a new room.
  await until('in the second hunt', () => snap(a), (s) => s?.mode === 2 && s.roomId !== firstRoom, 60000);
  const k = await until('the new kit', () => raid(a), (r) => r?.kit?.known, 15000);
  console.log(`second run kit: ${JSON.stringify(k.kit)}`);
  if (k.kit.level !== level || (k.kit.unlocks & 1) === 0 || k.kit.katana !== 1 || k.kit.bladePct !== 10) throw new Error(`the second run's kit: ${JSON.stringify(k.kit)}`);
  if (k.skillLocks.includes('dash')) throw new Error('Dash still locked after the level-up');
  await hideOverlay(a);
  await inStage(a, RaidStage.Fight, 1, 40000);
  await dev(a, 'quiet', 1);
  await dev(a, 'freeze', 1);
  await dev(a, 'hold');
  await dev(a, 'tpgoal', 30);
  await sleep(1500);
  await a.evaluate(() => (window as any).__qwakk.resetStats());
  await dev(a, 'pack', 10);
  await sleep(500);
  await burst(a, '18-bamboo-katana-fight', 4, 300);
  const r2 = await until('plain cuts with the new katana', () => raid(a), (r) => Object.keys(r.blade.plain).length > 0 && r.blade.dashes >= 1, 30000);
  const plain2 = r2.blade.plain as Record<string, number>;
  console.log(`second run plain cuts: ${JSON.stringify(plain2)}, dashes ${r2.blade.dashes}`);
  if (!plain2['26'] || plain2['24']) throw new Error(`the new damage does not show: ${JSON.stringify(plain2)}`);
  await noCorrections(a, 'prediction in the second run (Dash unlocked, the new katana)');
  await dev(a, 'freeze', 0);
  await dev(a, 'skip', RAID.objectives);
  await sleep(800);
  await dev(a, 'clear');
  await until('second end', () => raid(a), (x) => x.endOpen && x.ended >= 2, 20000);
}

async function party(browser: Browser): Promise<void> {
  const A = await newDuck(browser, 'Lead');
  const B = await newDuck(browser, 'Mate', true);
  const a = A.page;
  const b = B.page;
  // The phone's duck is a veteran: level 20 and Tüy set in the throwaway database (a test shortcut; in the game only
  // the run's end grants them), then it buys and wears the Dragon Fang and the Toony Plate through the checked API.
  const vet = await duckToken(B.token);
  const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
  await sql`update players set level = 20, xp = ${xpForLevel(20)} where id = ${vet.id}`;
  await duckApi(vet.token, '');
  await sql`update duck_progress set feathers = 9000 where player_id = ${vet.id}`;
  await sql.end();
  for (const item of ['katana_dragon', 'armor_plate']) {
    await duckApi(vet.token, '/buy', { item });
    await duckApi(vet.token, '/equip', { item });
  }
  const geared = await duckApi(vet.token, '');
  if (geared.equipped.katana !== 'katana_dragon' || geared.equipped.armor !== 'armor_plate' || geared.feathers !== 9000 - 4500 - 3500) throw new Error(`the veteran's gear: ${JSON.stringify(geared)}`);
  await a.goto(menuUrl('&autopilot=raid'));
  await pickDuck(a);
  await openSheet(a, 1);
  await a.locator('.qm-party button', { hasText: 'Create party' }).click();
  const code = await a.locator('.qm-party-codetext').innerText({ timeout: 20000 });
  await b.goto(`${menuUrl()}&party=${code}`);
  await pickDuck(b, 60_000, true);
  await until('party of two', () => a.locator('.qm-party-member').count(), (c) => c === 2, 20000);
  await openSheet(a, 0);
  await a.locator('.qm-sheet-mode[data-mode="raid"]').click();
  const sa = await until('A in a hunt', () => snap(a), (s) => s?.mode === 2, 60000);
  const sb = await until('B followed into the hunt', () => snap(b), (s) => s?.mode === 2, 60000);
  const ra = await until('two ducks in the run', () => raid(a), (r) => r?.ducks === 2, 30000);
  console.log(`party hunt: ${sa.sessionId} and ${sb.sessionId}, ducks ${ra.ducks}`);
  const cdp = await B.ctx.newCDPSession(b);
  const f = new Fingers(cdp);
  // The phone's first tap on the pause card turns touch play on.
  const card = await center(b, '#overlay .card').catch(() => null);
  if (card) await f.tap(card.x, card.y);
  await hideOverlay(a);
  await inStage(a, RaidStage.Fight, 1, 40000);
  await dev(a, 'quiet', 1);
  await dev(a, 'hold');
  // Both out in the field, a pack charging the phone.
  await dev(b, 'tpgoal', 30);
  await dev(a, 'tpgoal', 32);
  await sleep(1500);
  await until('the touch skill buttons', () => b.locator('.tc-dash:not([hidden])').count(), (c) => c === 1, 15000);
  // The veteran has every move (level 20): no lock on its touch buttons; the fresh desktop duck's are locked.
  if ((await b.locator('.tc-skill.locked').count()) !== 0) throw new Error('a level 20 duck has locked touch skills');
  const ka = await raid(a);
  if (!ka.skillLocks.includes('dash')) throw new Error(`the fresh desktop duck should have Dash locked: ${JSON.stringify(ka.kit)}`);
  // The teleports above were corrections; count from here.
  await b.evaluate(() => (window as any).__qwakk.resetStats());
  await dev(b, 'pack', 8);
  await sleep(500);
  // The phone: Dash toward them, VAK! when they close in, Fire taps (slashes), then the storm.
  const dash = await center(b, '.tc-dash');
  await f.tap(dash.x, dash.y);
  await sleep(700);
  const fire = await center(b, '.tc-fire:not(.tc-fire-l)');
  for (let i = 0; i < 6; i++) {
    await f.tap(fire.x, fire.y, 50);
    await sleep(140);
  }
  const quack = await center(b, '.tc-quack');
  await f.tap(quack.x, quack.y);
  await sleep(250);
  await b.screenshot({ path: `${out}/20-phone-quack.png` });
  await dev(b, 'meter');
  await sleep(400);
  const storm = await center(b, '.tc-storm');
  await f.tap(storm.x, storm.y);
  await sleep(900);
  await b.screenshot({ path: `${out}/21-phone-blade-storm.png` });
  const rb = await raid(b);
  console.log(`phone: dashes ${rb.blade.dashes}, swings ${rb.blade.swings}, quacks ${rb.blade.quacks}, storms ${rb.blade.storms}, predicted hits ${rb.blade.predictedHits}`);
  if (rb.blade.dashes < 1 || rb.blade.quacks < 1 || rb.blade.storms < 1 || rb.blade.swings < 1) throw new Error(`the phone's touch skills did not all go: ${JSON.stringify(rb.blade)}`);
  await sleep(1500);
  await hideOverlay(a);
  await a.screenshot({ path: `${out}/22-party-desktop.png` });
  await noCorrections(b, 'the phone');
  // The veteran's gear as the desktop duck sees it: both moved close (test-hook teleports: corrections, so after the
  // check above), the desktop turned to where it draws the phone's duck (its remote pose).
  await dev(b, 'quiet', 1);
  await dev(a, 'tpgoal', 30);
  await dev(b, 'tpgoal', 26);
  await sleep(1200);
  const seen = await snap(a);
  const pb = Object.values(seen.remotes as Record<string, { x: number; z: number }>)[0];
  await a.evaluate(([x, z]) => (window as any).__qwakk.face(x, z, 1800, -0.12), [pb?.x ?? 0, pb?.z ?? 0] as const);
  await sleep(1600);
  await hideOverlay(a);
  await a.screenshot({ path: `${out}/22b-veteran-gear.png` });
  await dev(a, 'skip', RAID.objectives);
  await sleep(1000);
  await dev(a, 'clear');
  await until('end on both', async () => [await raid(a), await raid(b)], ([x, y]) => x.endOpen && y.endOpen, 20000);
  await sleep(2200);
  await a.screenshot({ path: `${out}/23-party-end-desktop.png` });
  await b.screenshot({ path: `${out}/24-party-end-phone.png` });
  await A.ctx.close();
  await B.ctx.close();
}

async function main(): Promise<void> {
  const dist = isAbsolute(DIST) ? DIST : `${root}/apps/client/${DIST}`;
  if (!existsSync(`${dist}/index.html`)) throw new Error('Build the test client first: npm run build:test');
  const db = await e2eDatabase('raid');
  dbUrl = db.url;
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
