/**
 * Parties and teams end to end: the real server (bots off, test hooks on),
 * `vite preview` of the test bundle and two headless Chrome players who play
 * through the menu (npm run build:test first).
 *
 *   Deathmatch: A creates a party in the menu, B opens the share link and
 *   lands in it. A clicks Deathmatch, B follows into the same room. They are
 *   allies: each sees the other's green name tag, and A's shots at B do no
 *   damage (no hit confirmed, B keeps full health).
 *
 *   Duo battle royale: a new party, A picks Quick Play (the menu switches to
 *   Duo for a party of two and opens a Duo room), B follows: same room, same
 *   team, the room is listed as Duo. Both drop on autopilot, land, see each
 *   other's tags and teammate entries. A is knocked (a test-only self-hurt
 *   message, QWAKK_TEST_HOOKS=1), crawls; B walks up and holds E: A is back
 *   up with KNOCK.reviveHp.
 *
 * Saves screenshots to OUTDIR. Usage: npm run e2e:party [-- OUTDIR]
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { Button, KNOCK } from '@qwakk/shared';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? join(tmpdir(), 'qwakk-shots-party');
mkdirSync(out, { recursive: true });
// The menu's API calls go to port 2567 in test builds (net/endpoint.ts), so the server runs there.
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 2567);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5173);
const server_ = `ws://localhost:${SERVER_PORT}`;
const VILLAGE = { x: 40, z: -192 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Snap = any;
const snap = (p: Page): Promise<Snap> => p.evaluate(() => (window as any).__qwakk?.snapshot() ?? null);

function run(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}): ChildProcess {
  return spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function waitForOutput(proc: ChildProcess, needle: string, timeoutMs = 30000): Promise<void> {
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

const hideOverlay = (p: Page): Promise<void> => p.evaluate(() => document.getElementById('overlay')?.classList.add('hidden'));
/** Approach using normal inputs before checking names, which only show nearby. */
async function walkNear(page: Page, target: string, range: number): Promise<number> {
  const end = Date.now() + 45000;
  let distance = Infinity;
  while (Date.now() < end) {
    const me = (await snap(page)).me;
    const pose = await page.evaluate((id) => (window as any).__qwakk.poseOf(id), target);
    if (!me || !pose) { await sleep(200); continue; }
    distance = Math.hypot(pose.x - me.x, pose.z - me.z);
    await page.evaluate(([x, z]) => (window as any).__qwakk.face(x, z, 120000, -0.1), [pose.x, pose.z]);
    if (distance < range) return distance;
    const ms = Math.round(Math.min(1000, Math.max(120, (distance - range + 0.5) * 110)));
    await page.evaluate(([btn, t]) => (window as any).__qwakk.press(btn, t, 1), [distance > 6 ? Button.Sprint : 0, ms]);
    await sleep(ms);
  }
  throw new Error(`Could not approach teammate within ${range} m (distance ${distance})`);
}
const partyNames = async (p: Page): Promise<string[]> => (await p.locator('.qm-party-member .qm-party-name').allInnerTexts()).map((t) => t.replace(/\s+/g, ''));

/** A creates a party in the menu, B opens the share link; both see two members. Returns the code. */
async function formParty(a: Page, b: Page, menuUrl: string): Promise<string> {
  await a.goto(menuUrl);
  await a.locator('.qm-party button', { hasText: 'Create party' }).click();
  const code = await a.locator('.qm-party-codetext').innerText({ timeout: 20000 });
  await b.goto(`${menuUrl}&party=${code}`);
  await until('both see two members', async () => [await partyNames(a), await partyNames(b)], ([x, y]) => x?.length === 2 && y?.length === 2, 20000);
  console.log(`party ${code}: ${(await partyNames(a)).join(', ')}`);
  return code;
}

async function newPlayer(browser: import('playwright').Browser, name: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[${name}] page error:`, e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.error(`[${name}] console:`, m.text()));
  return { ctx, page };
}

async function deathmatch(browser: import('playwright').Browser): Promise<void> {
  const A = await newPlayer(browser, 'A');
  const B = await newPlayer(browser, 'B');
  const a = A.page;
  const b = B.page;
  await formParty(a, b, `http://localhost:${WEB_PORT}/game/?lang=en&server=${server_}&hud=0&menu=1`);
  await sleep(300);
  await a.screenshot({ path: `${out}/1-party-menu-leader.png` });
  await b.screenshot({ path: `${out}/2-party-menu-member.png` });
  // Members wait for the leader: B's Play buttons are off.
  if (!(await b.locator('.qm-btn-play').isDisabled())) throw new Error('a party member can start a match on its own');

  await a.locator('.qm-btn[data-mode="dm"]').click();
  const sa = await until('A in the deathmatch', () => snap(a), (s) => s?.mode === 0 && s.players === 2, 60000);
  const sb = await until('B followed into the room', () => snap(b), (s) => s?.mode === 0 && s.players === 2, 60000);
  if (!sa.team.myTeam || sa.team.myTeam !== sb.team.myTeam) throw new Error(`not allies: ${sa.team.myTeam} / ${sb.team.myTeam}`);
  console.log(`deathmatch: both in, ally group ${sa.team.myTeam}`);
  const bId = sb.sessionId;
  const aId = sa.sessionId;

  await a.evaluate(() => (window as any).__qwakk.face(0, 0, 120000, 0));
  await walkNear(b, aId, 6);
  // Face each other nearby: green name tags both ways.
  for (const [p, other] of [[a, bId], [b, aId]] as const) {
    const pose = await until('ally pose', () => p.evaluate((id) => (window as any).__qwakk.poseOf(id), other), (v) => v !== null, 10000);
    await p.evaluate(([x, z]) => (window as any).__qwakk.face(x, z, 8000, 0.0), [pose.x, pose.z]);
  }
  await hideOverlay(a);
  await hideOverlay(b);
  await until('A shows B tag', () => snap(a), (s) => s.team.tags.allyTags >= 1, 10000);
  await until('B shows A tag', () => snap(b), (s) => s.team.tags.allyTags >= 1, 10000);
  await a.screenshot({ path: `${out}/3-dm-ally-tag.png` });

  // No friendly fire: A empties a burst into B (past spawn protection).
  await sleep(2000);
  const pose = await a.evaluate((id) => (window as any).__qwakk.poseOf(id), bId);
  await a.evaluate(([x, z]) => (window as any).__qwakk.face(x, z, 4000, -0.05), [pose.x, pose.z]);
  const before = (await snap(a)).combat;
  await a.evaluate((btn) => (window as any).__qwakk.press(btn, 1500), Button.Fire);
  await sleep(2500);
  const after = (await snap(a)).combat;
  const bHp = (await snap(b)).mine?.hp ?? (await snap(b)).team.hp;
  const shots = after.shotsFired - before.shotsFired;
  console.log(`friendly fire: A fired ${shots} shots at B: ${after.confirmedHits - before.confirmedHits} hits confirmed, ${after.predictedHits - before.predictedHits} predicted, B health ${bHp}`);
  if (shots < 3) throw new Error('A did not fire');
  if (after.confirmedHits !== before.confirmedHits || after.predictedHits !== before.predictedHits || bHp !== 100) throw new Error('a party ally took damage');
  await A.ctx.close();
  await B.ctx.close();
}

async function duo(browser: import('playwright').Browser): Promise<void> {
  const A = await newPlayer(browser, 'A');
  const B = await newPlayer(browser, 'B');
  const a = A.page;
  const b = B.page;
  await formParty(a, b, `http://localhost:${WEB_PORT}/game/?lang=en&server=${server_}&hud=0&menu=1&autopilot=br&aptarget=${VILLAGE.x},${VILLAGE.z}`);
  const mode = await a.locator('.qm-mode.is-on').innerText();
  if (mode !== 'Duo') throw new Error(`a party of two should pick Duo, picked ${mode}`);
  await a.locator('.qm-btn-play').click();
  const sa = await until('A in a duo room', () => snap(a), (s) => s?.mode === 1 && s.team.teamSize === 2 && s.players === 2, 60000);
  const sb = await until('B followed', () => snap(b), (s) => s?.mode === 1 && s.players === 2, 60000);
  if (!sa.team.myTeam || sa.team.myTeam !== sb.team.myTeam) throw new Error(`not one team: ${sa.team.myTeam} / ${sb.team.myTeam}`);
  console.log(`duo: same room, team ${sa.team.myTeam}, allies ${JSON.stringify(sa.team.allies.map((x: any) => x.name))}`);
  await hideOverlay(a);
  await sleep(500);
  await a.screenshot({ path: `${out}/4-duo-waiting-room.png` });
  const aId = sa.sessionId;
  const bId = sb.sessionId;

  // The drop, on autopilot to the same village.
  await until('A lands', () => snap(a), (s) => s.br?.landed, 120000);
  await until('B lands', () => snap(b), (s) => s.br?.landed, 60000);
  const landed = await snap(a);
  const ally = landed.team.allies[0];
  console.log(`landed: A has B's pose ${ally?.pose}, teammate entry ${JSON.stringify(ally?.mate)}`);
  if (!ally?.pose || !ally.mate) throw new Error('A does not get its teammate (pose and team entry)');
  await a.evaluate(() => (window as any).__qwakk.face(0, 0, 120000, 0));
  await walkNear(b, aId, 6);
  const bPose = await a.evaluate((id) => (window as any).__qwakk.poseOf(id), bId);
  await a.evaluate(([x, z]) => (window as any).__qwakk.face(x, z, 3000, -0.1), [bPose.x, bPose.z]);
  await until('A shows B tag', () => snap(a), (s) => s.team.tags.allyTags >= 1, 10000);
  await sleep(300);
  await a.screenshot({ path: `${out}/5-duo-ally-tag.png` });

  // A stands still; B walks up to it. Then A is knocked (test hook) and B holds E.
  await a.evaluate(() => (window as any).__qwakk.face(0, 0, 120000, 0));
  const end = Date.now() + 45000;
  let dist = 99;
  while (Date.now() < end) {
    const me = (await snap(b)).me;
    const p = await b.evaluate((id) => (window as any).__qwakk.poseOf(id), aId);
    if (!me || !p) {
      await sleep(200);
      continue;
    }
    dist = Math.hypot(p.x - me.x, p.z - me.z);
    await b.evaluate(([x, z]) => (window as any).__qwakk.face(x, z, 2500, -0.35), [p.x, p.z]);
    if (dist < 1.3) break;
    const ms = Math.round(Math.min(1200, Math.max(120, dist * 110)));
    await b.evaluate(([btn, t]) => (window as any).__qwakk.press(btn, t, 1), [dist > 6 ? Button.Sprint : 0, ms]);
    await sleep(ms);
  }
  console.log(`B walked up to A: ${dist.toFixed(2)} m`);
  if (dist > KNOCK.reviveRange - 0.4) throw new Error('B could not reach A');
  // Hold B there (its autopilot would wander off to loot).
  const at = await b.evaluate((id) => (window as any).__qwakk.poseOf(id), aId);
  await b.evaluate(([x, z, ms]) => (window as any).__qwakk.face(x, z, ms, -0.35), [at.x, at.z, (KNOCK.reviveSeconds + 15) * 1000]);
  await a.evaluate(() => (window as any).__qwakk.devHurt(500));
  await until('A knocked', () => snap(a), (s) => s.team.down === 1 && s.me?.alive === 1, 10000);
  await until('B sees A knocked', () => snap(b), (s) => s.team.allies[0]?.mate?.down === 1, 10000);
  console.log('A is knocked; B sees it in its team entry');
  await sleep(400);
  await a.screenshot({ path: `${out}/6-knocked.png` });
  await b.evaluate(([btn, ms]) => (window as any).__qwakk.press(btn, ms), [Button.Use, (KNOCK.reviveSeconds + 2) * 1000]);
  await until('B gets the revive prompt', () => snap(b), (s) => s.team.revivePrompt !== '', 5000);
  await sleep(2500);
  await hideOverlay(b);
  await b.screenshot({ path: `${out}/7-reviving.png` });
  const up = await until('A revived', () => snap(a), (s) => s.team.down === 0, (KNOCK.reviveSeconds + 5) * 1000);
  console.log(`revived: A down ${up.team.down}, health ${up.team.hp}`);
  if (up.team.hp !== KNOCK.reviveHp) throw new Error(`revived with ${up.team.hp} health, expected ${KNOCK.reviveHp}`);
  await sleep(500);
  await a.screenshot({ path: `${out}/8-revived.png` });
  await A.ctx.close();
  await B.ctx.close();
}

async function main(): Promise<void> {
  if (!existsSync(`${root}/apps/client/dist-test/index.html`)) throw new Error('Build the test client first: npm run build:test');
  const server = run(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], root, {
    PORT: String(SERVER_PORT),
    QWAKK_BOTS: '0',
    QWAKK_BR_COUNTDOWN: '8',
    QWAKK_BR_MIN_HUMANS: '2',
    QWAKK_BR_SEED: '7',
    QWAKK_DM_SPAWN_RADIUS: '21',
    QWAKK_TEST_HOOKS: '1',
  });
  const web = run(process.execPath, [`${root}/node_modules/vite/bin/vite.js`, 'preview', '--outDir', 'dist-test', '--port', String(WEB_PORT), '--strictPort'], `${root}/apps/client`);
  const procs = [server, web];
  const cleanup = () => procs.forEach((p) => p.exitCode === null && p.kill('SIGINT'));
  process.on('exit', cleanup);
  try {
    await Promise.all([waitForOutput(server, 'server listening'), waitForOutput(web, String(WEB_PORT))]);
    const browser = await chromium.launch({
      ...((process.env.E2E_BROWSER ?? 'chrome') === 'chrome' ? { channel: 'chrome' } : {}),
      headless: true,
      args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
    });
    await deathmatch(browser);
    await duo(browser);
    await browser.close();
    console.log(`screenshots in ${out}`);
    console.log('PARTY E2E OK');
  } finally {
    cleanup();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
