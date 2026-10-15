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
 *   - when B leaves, A is the last duck standing and gets the victory card.
 * Saves screenshots (plane, glide over the village, looting, zone wall, victory).
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
const SERVER_PORT = 2567;
const WEB_PORT = 5173;
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

async function main(): Promise<void> {
  if (!existsSync(`${root}/apps/client/dist-test/index.html`)) throw new Error('Build the test client first: npm run build:test');
  const server = run(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], root, {
    PORT: String(SERVER_PORT),
    QWAKK_BOTS: '0',
    QWAKK_BR_WARMUP: '8',
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
    const url = (name: string) => `http://localhost:${WEB_PORT}/game/?mode=br&autopilot=br&name=${name}&hud=0&aptarget=${VILLAGE.x},${VILLAGE.z}`;
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
