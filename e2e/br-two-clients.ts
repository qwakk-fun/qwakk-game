/**
 * Battle royale with two real headless browsers in one room (no bots).
 *
 * Starts the game server (fixed match seed, short warm-up, a faster zone) and
 * `vite preview` of the test bundle (npm run build:test first), opens two
 * pages with the battle royale autopilot aimed at the village, and checks:
 *   - Node and Chrome load the same map (terrain and collider hash) and the
 *     sim scenario on it gives identical state hashes;
 *   - both see the plane, jump, glide and land;
 *   - in the plane neither receives the other's pose; on the ground each sees
 *     the other only when it is visible (line of sight or close), reported
 *     against a line-of-sight check in Node;
 *   - both pick up at least one item;
 *   - A walks to a closed crate, opens it (the lid swings up, the loot lies
 *     inside), opens the inventory screen and takes an item with its Take
 *     button (an inventory request the server answers);
 *   - when B leaves, A is the last duck standing and gets the victory card.
 * Saves screenshots (plane, glide over the village, looting, a closed and an
 * open crate, the inventory screen, zone wall, victory).
 *
 * Usage: npm run e2e:br [-- OUTDIR]
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { createSimWorld, initPhysics, mapDefHash, OPAQUE_QUERY_GROUPS, simSelfTestHashOn } from '@qwakk/shared';
import { loadSainteCanard } from '../apps/server/src/maps.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? join(tmpdir(), 'qwakk-shots-br');
mkdirSync(out, { recursive: true });
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 2567);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5173);
/** Path 7 passes about 40 m from the village square. */
const SEED = 7;
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

async function waitFor(p: Page, label: string, test: (s: Snap) => boolean, timeoutMs: number): Promise<Snap> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const s = await snap(p);
    if (s && test(s)) return s;
    if (Date.now() > end) throw new Error(`timeout: ${label} (${JSON.stringify(s && { phase: s.phase, mine: s.mine, br: s.br })})`);
    await sleep(250);
  }
}

type Los = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => boolean;
type CrateInfo = { key: string; crate: string; open: boolean; contents: number; x: number; y: number; z: number; dist: number };
const crates = (p: Page): Promise<CrateInfo[]> => p.evaluate(() => (window as any).__qwakk.crates(45));

/**
 * Screenshots of a closed crate, the same crate open with its loot inside,
 * and the inventory screen next to it; then a Take button in the screen must
 * bring an item into the inventory (the server's answer to Msg.Inv).
 */
async function crateAndInventory(a: Page, los: Los): Promise<void> {
  const tried = new Set<string>();
  for (let attempt = 0; attempt < 4; attempt++) {
    const s0 = await snap(a);
    const me = s0.me;
    const target = (await crates(a)).find((c) => !c.open && !tried.has(c.crate) && Math.abs(c.y - me.y) < 2 && los(me.x, me.y, me.z, c.x, c.y, c.z));
    if (!target) break;
    tried.add(target.crate);
    await a.evaluate(([k]) => (window as any).__qwakk.focusItem(k, true), [target.key]);
    // Walk up to it; stop a few meters short for the closed picture.
    const end = Date.now() + 20000;
    let near = false;
    while (Date.now() < end) {
      const s = await snap(a);
      if (s.me && Math.hypot(s.me.x - target.x, s.me.z - target.z) < 4.5) {
        near = true;
        break;
      }
      await sleep(150);
    }
    if (!near) continue;
    const me1 = (await snap(a)).me;
    if (attempt === 0 || !existsSync(`${out}/3a-crate-closed.png`)) {
      await a.evaluate(([x, z]) => (window as any).__qwakk.face(x, z, 1400, -0.3), [target.x, target.z]);
      await sleep(700);
      await a.screenshot({ path: `${out}/3a-crate-closed.png` });
      await sleep(800);
    }
    // Let the autopilot press E; it stops once the crate is open.
    const end2 = Date.now() + 15000;
    let opened: CrateInfo | undefined;
    while (Date.now() < end2 && !opened) {
      opened = (await crates(a)).find((c) => c.crate === target.crate && c.open);
      await sleep(100);
    }
    if (!opened) continue;
    const at = (await snap(a)).me;
    if (opened.contents === 0 || Math.hypot(at.x - target.x, at.z - target.z) > 4) {
      // Someone else got there first (we held a stale closed copy): try another one.
      console.log(`crate ${target.crate} was opened by someone else (${opened.contents} items left); trying another`);
      continue;
    }
    await sleep(900);
    const me2 = (await snap(a)).me ?? me1;
    await a.evaluate(([x, z]) => (window as any).__qwakk.face(x, z, 6000, -0.55), [target.x, target.z]);
    void me2;
    await sleep(700);
    await a.screenshot({ path: `${out}/3b-crate-open.png` });
    const before = (await snap(a)).br.picked;
    const shown = await a.evaluate(() => (window as any).__qwakk.inventory(true));
    await sleep(600);
    await a.screenshot({ path: `${out}/3c-inventory.png` });
    const takes = await a.locator('.br-invscreen .br-ibtn.take').count();
    console.log(`crate ${target.crate}: open, ${opened.contents} items inside; inventory screen ${shown ? 'shown' : 'NOT shown'}, ${takes} take buttons`);
    if (!shown) throw new Error('the inventory screen did not open');
    const waitPicked = async (from: number): Promise<number> => {
      const end3 = Date.now() + 5000;
      let now = from;
      while (Date.now() < end3 && now === from) {
        await sleep(150);
        now = (await snap(a)).br.picked;
      }
      return now;
    };
    if (takes > 0) {
      await a.locator('.br-invscreen .br-ibtn.take').first().click();
      const after = await waitPicked(before);
      await a.screenshot({ path: `${out}/3d-inventory-after-take.png` });
      console.log(`inventory take from the crate: picked ${before} -> ${after}`);
      if (after === before) throw new Error('taking an item from the inventory screen did nothing');
    }
    // Drop something from the backpack, then take it back from the ground.
    const carried = (m: any) => m.res0 + m.res1 + m.bandages + m.medkits;
    const drops = a.locator('.br-invscreen .br-inv-col:nth-child(2) .br-ibtn');
    if ((await drops.count()) > 0) {
      const had = carried((await snap(a)).mine);
      await drops.first().click();
      const end4 = Date.now() + 5000;
      let has = had;
      while (Date.now() < end4 && has === had) {
        await sleep(150);
        has = carried((await snap(a)).mine);
      }
      await sleep(400);
      await a.screenshot({ path: `${out}/3e-inventory-after-drop.png` });
      console.log(`inventory drop: carried ${had} -> ${has}`);
      if (has >= had) throw new Error('dropping from the inventory screen did nothing');
      const groundTake = a.locator('.br-invscreen .br-inv-col:nth-child(1) .br-ibtn.take');
      const end5 = Date.now() + 5000;
      while (Date.now() < end5 && (await groundTake.count()) === 0) await sleep(150);
      const p0 = (await snap(a)).br.picked;
      if ((await groundTake.count()) === 0) throw new Error('the dropped item did not show up in reach');
      await groundTake.last().click();
      const p1 = await waitPicked(p0);
      console.log(`take the dropped item back: picked ${p0} -> ${p1}, carried ${carried((await snap(a)).mine)}`);
      if (p1 === p0) throw new Error('taking the dropped item back did nothing');
    }
    await a.evaluate(() => (window as any).__qwakk.inventory(false));
    await a.evaluate(() => (window as any).__qwakk.focusItem(null));
    return;
  }
  await a.evaluate(() => (window as any).__qwakk.focusItem(null));
  throw new Error('no crate in sight could be opened for the crate screenshots');
}

async function main(): Promise<void> {
  if (!existsSync(`${root}/apps/client/dist-test/index.html`)) throw new Error('Build the test client first: npm run build:test');
  const server = run(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], root, {
    PORT: String(SERVER_PORT),
    QWAKK_BOTS: '0',
    QWAKK_BR_COUNTDOWN: '8',
    QWAKK_BR_MIN_HUMANS: '2',
    QWAKK_BR_SEED: String(SEED),
    QWAKK_ZONE_SCALE: '0.25',
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
    const url = (name: string) => `http://localhost:${WEB_PORT}/game/?mode=br&server=ws://localhost:${SERVER_PORT}&autopilot=br&name=${name}&hud=0&aptarget=${VILLAGE.x},${VILLAGE.z}`;
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    for (const [n, p] of [['A', a], ['B', b]] as const) {
      p.on('pageerror', (e) => console.error(`[${n}] page error:`, e.message));
      p.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.error(`[${n}] console:`, m.text()));
    }
    await a.goto(url('DuckA'));
    await b.goto(url('DuckB'));
    await waitFor(a, 'both in the warm-up', (s) => s?.players === 2 && s.mapId === 'sainte-canard', 60000);

    // Same map and same sim in Node and Chrome.
    await initPhysics();
    const def = loadSainteCanard().def;
    const nodeMap = mapDefHash(def);
    const nodeSim = simSelfTestHashOn(def, 200);
    const browserMap = await a.evaluate(() => (window as any).__qwakk.mapDefHash() as string);
    const browserSim = await a.evaluate(() => (window as any).__qwakk.mapSelfTestHash() as string);
    console.log(`map determinism: node ${nodeMap} / browser ${browserMap}; sim on the map: node ${nodeSim} / browser ${browserSim}`);
    if (nodeMap !== browserMap || nodeSim !== browserSim) throw new Error('map or sim differs between Node and the browser');

    // The plane.
    const inPlane = await waitFor(a, 'A boards the plane', (s) => s.mine?.mode === 1 && s.br?.planeSeen, 30000);
    await sleep(1500);
    await a.screenshot({ path: `${out}/1-plane.png` });
    const planeSees = (await snap(a)).visibleRemotes.length;
    console.log(`in the plane: A has ${planeSees} enemy poses (expected 0), alive ${inPlane.alive}`);
    if (planeSees !== 0) throw new Error('a duck in the plane was sent as a pose');

    // Jump, glide, land.
    await waitFor(a, 'A jumps', (s) => s.br?.jumped, 30000);
    const glide = await waitFor(a, 'A glides', (s) => s.mine?.mode === 3, 30000);
    void glide;
    await sleep(2500);
    await a.screenshot({ path: `${out}/2-glide-over-village.png` });
    await waitFor(a, 'A lands', (s) => s.br?.landed, 60000);
    await waitFor(b, 'B lands', (s) => s.br?.landed, 60000);

    // Ground: sample visibility against Node's own line-of-sight check, and wait for pickups.
    const sim = createSimWorld(def);
    const los = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
      const dx = bx - ax;
      const dy = by + 0.9 - (ay + 1.55);
      const dz = bz - az;
      const d = Math.hypot(dx, dy, dz);
      const hit = sim.world.castRay(new sim.rapier.Ray({ x: ax, y: ay + 1.55, z: az }, { x: dx / d, y: dy / d, z: dz / d }), d, false, undefined, OPAQUE_QUERY_GROUPS);
      return !hit || hit.timeOfImpact > d - 0.3;
    };
    let samples = 0;
    let seen = 0;
    let closeMissed = 0;
    let hiddenButSent = 0;
    let lootShot = false;
    const end = Date.now() + 40000;
    let pickedA = 0;
    let pickedB = 0;
    while (Date.now() < end) {
      await sleep(400);
      const sa = await snap(a);
      const sb = await snap(b);
      pickedA = sa.br?.picked ?? 0;
      pickedB = sb.br?.picked ?? 0;
      if (!lootShot && pickedA > 0) {
        lootShot = true;
        await a.screenshot({ path: `${out}/3-looting.png` });
      }
      if (!sa.me || !sb.me) continue;
      samples++;
      const d = Math.hypot(sa.me.x - sb.me.x, sa.me.z - sb.me.z);
      const sees = sa.visibleRemotes.includes(sb.sessionId);
      if (sees) seen++;
      if (d < 8 && !sees) closeMissed++;
      if (sees && d > 12 && !los(sa.me.x, sa.me.y, sa.me.z, sb.me.x, sb.me.y, sb.me.z)) hiddenButSent++;
      if (pickedA > 0 && pickedB > 0 && samples > 25 && seen > 0) break;
    }
    console.log(JSON.stringify({ samples, aSawB: seen, closeButNotSent: closeMissed, sentWithoutEyeLineOfSight: hiddenButSent, pickedA, pickedB }));
    if (pickedA === 0 || pickedB === 0) throw new Error('a client did not pick up an item');
    if (closeMissed > 1) throw new Error('a close enemy was not sent');

    // Crates: walk A to a closed crate in sight, look at it closed, open it, look inside,
    // then take one item from it through the inventory screen (a Msg.Inv request).
    // B stands still meanwhile, so it does not loot the same crate first.
    await b.evaluate(() => (window as any).__qwakk.face(0, 0, 90000, 0));
    await crateAndInventory(a, (x, y, z, bx, by, bz) => los(x, y, z, bx, by - 0.9, bz));
    await b.evaluate(() => (window as any).__qwakk.face(0, 0, 1, 0));

    // The zone wall (the test server runs the zone four times faster).
    await waitFor(a, 'the zone wall', (s) => s.br?.zoneWallSeen, 60000);
    await sleep(1500);
    // Face the nearest point of the wall for the picture.
    const zs = await snap(a);
    const dx = zs.me.x - zs.zone.x;
    const dz = zs.me.z - zs.zone.z;
    const d = Math.hypot(dx, dz) || 1;
    const wx = zs.zone.x + (dx / d) * zs.zone.r;
    const wz = zs.zone.z + (dz / d) * zs.zone.r;
    await a.evaluate(([x, z]) => (window as any).__qwakk.face(x, z, 2500, 0.12), [wx, wz]);
    await sleep(900);
    await a.screenshot({ path: `${out}/4-zone-wall.png` });

    // B leaves: A is the last duck standing.
    await ctxB.close();
    const won = await waitFor(a, 'A wins', (s) => s.br?.resultShown && s.br?.placement === 1, 20000);
    await sleep(800);
    await a.screenshot({ path: `${out}/5-victory.png` });
    console.log(`victory: placement ${won.br.placement}, kills ${won.kills}`);
    await ctxA.close();
    await browser.close();
    console.log('BR E2E OK');
  } finally {
    cleanup();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
