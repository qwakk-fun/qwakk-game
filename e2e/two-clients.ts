/**
 * Two-client smoke test in a real headless browser.
 *
 * Starts the game server and `vite preview` (build the test bundle first: npm run build:test),
 * opens two pages that join the same deathmatch room (Quick Play: the room
 * with the most humans) with the autopilot on, and checks that each page
 * receives the other's positions and draws them smoothly. The deathmatch map
 * (MATCH.mapId) culls enemy poses by line of sight, so the test spawns both
 * ducks near the square (QWAKK_DM_SPAWN_RADIUS) and checks the culling too:
 * a close duck is always sent, and how often a sent duck had no eye line of
 * sight is reported (the culling is conservative on purpose). Node and Chrome
 * must also build the same map (terrain and collider hash) and run the same
 * sim scenario on it.
 * Runs once without added latency, once at 120 ms round trip with jitter, and
 * once with loss (report only). Prints prediction and smoothness numbers, and
 * checks that the shared sim gives bit-identical results in Node and Chrome.
 * Then repeats with 120 ms simulated round trip (+/- 10 ms jitter) on both
 * clients and reports prediction corrections.
 *
 * Usage: npm run e2e            (uses installed Google Chrome, headless)
 *        E2E_BROWSER=chromium npm run e2e   (Playwright's bundled Chromium)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { createSimWorld, initPhysics, mapDefHash, OPAQUE_QUERY_GROUPS, simSelfTestHash, simSelfTestHashOn } from '@qwakk/shared';
import { dmMapId, loadMap } from '../apps/server/src/maps.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 2567);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5173);

type Snapshot = {
  sessionId: string;
  backend: string;
  fps: number;
  frameMsAvg: number;
  frameMsMax: number;
  pingMs: number;
  serverTick: number;
  players: number;
  me: { x: number; y: number; z: number; grounded: number } | null;
  visibleRemotes: string[];
  remotes: Record<string, { x: number; y: number; z: number; drawnMaxSpeed: number; snapFrames: number; frames: number }>;
  prediction: { reconciles: number; corrected: number; lastErrM: number; maxErrM: number; avgErrM: number; driftEma: number; driftPeak: number };
  pendingInputs: number;
  localMotion: { drawnMaxSpeed: number; snapFrames: number; frames: number };
};

function run(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}): ChildProcess {
  return spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function waitForOutput(proc: ChildProcess, needle: string, timeoutMs = 20000): Promise<void> {
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const snap = (p: Page) => p.evaluate(() => (window as unknown as { __qwakk: { snapshot(): Snapshot } }).__qwakk.snapshot());

/** The deathmatch map in Node, for the map hash and the line-of-sight report. */
const dmMap = loadMap(dmMapId());
let losSim: ReturnType<typeof createSimWorld> | null = null;
function los(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean {
  losSim ??= createSimWorld(dmMap.def);
  const sim = losSim;
  const dx = b.x - a.x;
  const dy = b.y + 0.9 - (a.y + 1.55);
  const dz = b.z - a.z;
  const d = Math.hypot(dx, dy, dz);
  const hit = sim.world.castRay(new sim.rapier.Ray({ x: a.x, y: a.y + 1.55, z: a.z }, { x: dx / d, y: dy / d, z: dz / d }), d, false, undefined, OPAQUE_QUERY_GROUPS);
  return !hit || hit.timeOfImpact > d - 0.3;
}

async function main(): Promise<void> {
  if (!existsSync(`${root}/apps/client/dist-test/index.html`)) throw new Error('Build the test client first: npm run build:test');
  const server = run(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], root, { PORT: String(SERVER_PORT), QWAKK_BOTS: '0', QWAKK_DM_SPAWN_RADIUS: '21' });
  const web = run(process.execPath, [`${root}/node_modules/vite/bin/vite.js`, 'preview', '--outDir', process.env.E2E_DIST ?? 'dist-test', '--port', String(WEB_PORT), '--strictPort'], `${root}/apps/client`);
  const procs = [server, web];
  const cleanup = () => procs.forEach((p) => p.exitCode === null && p.kill('SIGINT'));
  process.on('exit', cleanup);
  try {
    await Promise.all([waitForOutput(server, 'server listening'), waitForOutput(web, String(WEB_PORT))]);

    const useChrome = (process.env.E2E_BROWSER ?? 'chrome') === 'chrome';
    const browser = await chromium.launch({
      ...(useChrome ? { channel: 'chrome' } : {}),
      headless: true,
      args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
    });
    async function phase(label: string, seconds: number, query: string, strict = true) {
      const url = (name: string) => `http://localhost:${WEB_PORT}/game/?server=ws://localhost:${SERVER_PORT}&autopilot=1&name=${name}&${query}`;
      const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const a = await ctxA.newPage();
      const b = await ctxB.newPage();
      for (const [n, p] of [['A', a], ['B', b]] as const) {
        p.on('pageerror', (e) => console.error(`[${n}] page error:`, e.message));
        p.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.error(`[${n}] console:`, m.text()));
      }
      // A first, so B's Quick Play finds A's room as the one with the most humans.
      await a.goto(url('DuckA'));
      await a.waitForFunction(() => (window as any).__qwakk?.snapshot().players >= 1, null, { timeout: 60000 });
      await b.goto(url('DuckB'));
      await a.waitForFunction(() => (window as any).__qwakk?.snapshot().players === 2, null, { timeout: 60000 });
      await b.waitForFunction(() => (window as any).__qwakk?.snapshot().players === 2, null, { timeout: 60000 });
      if (label === 'no added latency') {
        // Same sim, same inputs: Node and the browser must agree bit for bit.
        await initPhysics();
        const nodeHash = simSelfTestHash();
        const browserHash = await a.evaluate(() => (window as any).__qwakk.simSelfTestHash() as string);
        console.log(`sim determinism: node ${nodeHash} / browser ${browserHash}`);
        if (nodeHash !== browserHash) throw new Error('sim is not deterministic between Node and the browser');
        const mapId = (await snap(a) as unknown as { mapId: string }).mapId;
        if (mapId !== dmMapId()) throw new Error(`the deathmatch plays ${mapId}, expected ${dmMapId()}`);
        if (mapId !== 'greybox') {
          const nodeMap = mapDefHash(dmMap.def);
          const nodeSim = simSelfTestHashOn(dmMap.def, 200);
          const browserMap = await a.evaluate(() => (window as any).__qwakk.mapDefHash() as string);
          const browserSim = await a.evaluate(() => (window as any).__qwakk.mapSelfTestHash() as string);
          console.log(`map ${mapId}: node ${nodeMap} / browser ${browserMap}; sim on the map: node ${nodeSim} / browser ${browserSim}`);
          if (nodeMap !== browserMap || nodeSim !== browserSim) throw new Error('map or sim differs between Node and the browser');
        }
      }
      await sleep(4000); // let the clock and the interpolation buffer settle
      for (const p of [a, b]) await p.evaluate(() => (window as any).__qwakk.resetStats());
      const trail: (number[] | null)[] = [];
      const cull = { samples: 0, seen: 0, closeMissed: 0, sentWithoutEyeLineOfSight: 0 };
      const sa0 = await snap(a);
      for (let i = 0; i < seconds * 2; i++) {
        await sleep(500);
        const sa = await snap(a);
        const sb = await snap(b);
        const sees = sa.visibleRemotes.includes(sb.sessionId);
        const bInA = sees ? sa.remotes[sb.sessionId] : undefined;
        trail.push(bInA ? [bInA.x, bInA.z] : null);
        if (!sa.me || !sb.me) continue;
        cull.samples++;
        if (sees) cull.seen++;
        const d = Math.hypot(sa.me.x - sb.me.x, sa.me.z - sb.me.z);
        if (d < 8 && !sees) cull.closeMissed++;
        if (sees && d > 12 && !los(sa.me, sb.me)) cull.sentWithoutEyeLineOfSight++;
      }
      const sa = await snap(a);
      const sb = await snap(b);
      const bInA = sa.remotes[sb.sessionId];
      const aInB = sb.remotes[sa.sessionId];
      if (!bInA || !aInB) throw new Error(`${label}: a client has no player entry for the other`);
      // Only consecutive samples where B was drawn count (a culled duck is not drawn).
      let moved = 0;
      for (let i = 1; i < trail.length; i++) {
        const p = trail[i];
        const q = trail[i - 1];
        if (p && q) moved += Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!);
      }
      const view = (s: Snapshot, other: Snapshot['remotes'][string]) => ({
        fps: +s.fps.toFixed(1),
        frameMsAvg: +s.frameMsAvg.toFixed(2),
        frameMsMax: +s.frameMsMax.toFixed(1),
        pingMs: Math.round(s.pingMs),
        inputsInFlight: s.pendingInputs,
        reconciles: s.prediction.reconciles,
        correctedReconciles: s.prediction.corrected,
        predErrAvgCm: +(s.prediction.avgErrM * 100).toFixed(2),
        predErrMaxCm: +(s.prediction.maxErrM * 100).toFixed(2),
        localDrawnMaxSpeed: +s.localMotion.drawnMaxSpeed.toFixed(2),
        localSnapFrames: s.localMotion.snapFrames,
        remoteDrawnMaxSpeed: +other.drawnMaxSpeed.toFixed(2),
        remoteSnapFrames: other.snapFrames,
        frames: s.localMotion.frames,
      });
      const result = {
        phase: label,
        backend: sa.backend,
        serverTicksPerSec: +((sa.serverTick - sa0.serverTick) / (seconds + 0.5)).toFixed(1),
        aSawBMoveMeters: +moved.toFixed(1),
        culling: cull,
        A: view(sa, bInA),
        B: view(sb, aInB),
      };
      console.log(JSON.stringify(result, null, 2));
      await ctxA.close();
      await ctxB.close();
      if (moved < 5 || trail.length === 0) throw new Error(`${label}: A did not see B move`);
      if (cull.closeMissed > 1) throw new Error(`${label}: a close duck was not sent (${JSON.stringify(cull)})`);
      // A drawn speed far above sprint speed means a visible snap. Allow a couple of frames.
      if (strict) for (const v of [result.A, result.B]) {
        if (v.localSnapFrames > 2 || v.remoteSnapFrames > 3) throw new Error(`${label}: motion not smooth (${JSON.stringify(v)})`);
      }
      return result;
    }

    await phase('no added latency', 15, 'lat=0');
    await phase('120 ms rtt, +/-10 ms jitter', 15, 'lat=120&jit=20');
    // Report only: TCP loss shows up as stalls, which can starve the server of
    // inputs and force real corrections. Useful to see how big they get.
    await phase('150 ms rtt, +/-15 ms jitter, 2% loss (report only)', 15, 'lat=150&jit=30&loss=0.02', false);
    await browser.close();
    console.log('E2E OK');
  } finally {
    cleanup();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
