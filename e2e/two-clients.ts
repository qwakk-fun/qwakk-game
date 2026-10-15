/**
 * Two-client smoke test in a real headless browser.
 *
 * Starts the game server and `vite preview` (build the test bundle first: npm run build:test),
 * opens two pages that join the same room with the autopilot on, and checks
 * that each page receives the other's positions and draws them smoothly.
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
import { initPhysics, simSelfTestHash } from '@qwakk/shared';

const root = fileURLToPath(new URL('..', import.meta.url));
const SERVER_PORT = 2567;
const WEB_PORT = 5173;

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

async function main(): Promise<void> {
  if (!existsSync(`${root}/apps/client/dist-test/index.html`)) throw new Error('Build the test client first: npm run build:test');
  const server = run(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], root, { PORT: String(SERVER_PORT), QWAKK_BOTS: '0' });
  const web = run(process.execPath, [`${root}/node_modules/vite/bin/vite.js`, 'preview', '--outDir', 'dist-test', '--port', String(WEB_PORT), '--strictPort'], `${root}/apps/client`);
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
      const url = (name: string) => `http://localhost:${WEB_PORT}/game/?autopilot=1&name=${name}&${query}`;
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
      await a.waitForFunction(() => (window as any).__qwakk?.snapshot().players === 2, null, { timeout: 30000 });
      await b.waitForFunction(() => (window as any).__qwakk?.snapshot().players === 2, null, { timeout: 30000 });
      if (label === 'no added latency') {
        // Same sim, same inputs: Node and the browser must agree bit for bit.
        await initPhysics();
        const nodeHash = simSelfTestHash();
        const browserHash = await a.evaluate(() => (window as any).__qwakk.simSelfTestHash() as string);
        console.log(`sim determinism: node ${nodeHash} / browser ${browserHash}`);
        if (nodeHash !== browserHash) throw new Error('sim is not deterministic between Node and the browser');
      }
      await sleep(4000); // let the clock and the interpolation buffer settle
      for (const p of [a, b]) await p.evaluate(() => (window as any).__qwakk.resetStats());
      const trail: number[][] = [];
      const sa0 = await snap(a);
      for (let i = 0; i < seconds * 2; i++) {
        await sleep(500);
        const sa = await snap(a);
        const sb = await snap(b);
        const bInA = sa.remotes[sb.sessionId];
        if (bInA) trail.push([bInA.x, bInA.z]);
      }
      const sa = await snap(a);
      const sb = await snap(b);
      const bInA = sa.remotes[sb.sessionId];
      const aInB = sb.remotes[sa.sessionId];
      if (!bInA || !aInB) throw new Error(`${label}: a client does not see the other`);
      let moved = 0;
      for (let i = 1; i < trail.length; i++) moved += Math.hypot(trail[i]![0]! - trail[i - 1]![0]!, trail[i]![1]! - trail[i - 1]![1]!);
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
        A: view(sa, bInA),
        B: view(sb, aInB),
      };
      console.log(JSON.stringify(result, null, 2));
      await ctxA.close();
      await ctxB.close();
      if (moved < 5 || trail.length === 0) throw new Error(`${label}: A did not see B move`);
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
