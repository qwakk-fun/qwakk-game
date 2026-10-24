/**
 * Hunt Season frame pacing and network smoothness in headless Chrome: one
 * signed-in duck walks into a run through Duck Plaza's sheet and plays on the
 * dev autopilot; the script measures each stage for a while and prints one
 * table row per stage:
 *
 *   - client frames: every requestAnimationFrame interval (p50 / p95 / p99 /
 *     max, frames over 50 ms), the main thread's long tasks (count, total,
 *     longest), our own CPU time per frame;
 *   - network: state patches per second, bytes per patch, the interval
 *     between the server's patch stamps (tick jitter at the source) and
 *     between their arrivals (what the client sees);
 *   - prediction corrections, and the hunters' drawn motion: frames where a
 *     walking hunter stood still or jumped ahead;
 *   - the server's own tick and patch times for the room (QWAKK_STATS).
 *
 * Stages: the opening of a run at full speed (the autopilot walks out of
 * the castle and cuts into the first packs), then a peak: the duck held (no
 * damage) out in the field with a horde of PEAK hunters (default 44, the
 * four-duck peak) around it, kept topped up while the autopilot cuts.
 *
 * Usage: npm run perf:raid [-- OUTDIR [seconds per stage]]   (build:test first)
 * Env: E2E_SERVER_PORT, E2E_WEB_PORT, E2E_DIST (a bundle built for that server port);
 *      DEV=1 serves the client with the Vite dev server instead (what `npm run dev` runs);
 *      THROTTLE=4 slows the page's CPU four times (a phone or an older laptop);
 *      PROFILE=1 records a CPU profile of the peak and prints the hottest functions
 *      (build the bundle with `--minify false` for readable names).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type CDPSession, type Page } from 'playwright';
import { RaidStage } from '@qwakk/shared';
import { accountSeed, e2eDatabase, openSheet, pickDuck, seedBrowser, signUpApi } from './lib/accounts.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? join(tmpdir(), 'qwakk-shots-raid-perf');
const seconds = Number(process.argv[3] ?? 40);
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 2567);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5173);
const DIST = process.env.E2E_DIST ?? 'dist-test';
const DEV = process.env.DEV === '1';
const API = `http://localhost:${SERVER_PORT}`;
mkdirSync(out, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** In the page before any script: frame intervals, long tasks, and every WebSocket message (size, kind, the patch's server stamp). */
const PROBE = () => {
  const w = window as unknown as { __perf: { frames: number[]; long: number[]; patches: [number, number, number][]; other: number; t0: number; hitches: [number, number][] } };
  w.__perf = { frames: [], long: [], patches: [], other: 0, t0: performance.now(), hitches: [] };
  let last = 0;
  const raf = (t: number): void => {
    if (last) w.__perf.frames.push(t - last);
    // Every frame over two vsyncs, with its time: the hitch timeline.
    if (last && t - last > 34) w.__perf.hitches.push([Math.round(t), Math.round(t - last)]);
    last = t;
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) w.__perf.long.push(e.duration);
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    /* no long task timing */
  }
  const Native = WebSocket;
  class Probe extends Native {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      this.addEventListener('message', (e: MessageEvent) => {
        const d = e.data;
        if (!(d instanceof ArrayBuffer) || d.byteLength < 1) {
          w.__perf.other += typeof d === 'string' ? d.length : 0;
          return;
        }
        const b = new Uint8Array(d);
        // Colyseus: protocol code in bits 0..4; a TIMED patch starts with the server clock (uint32 LE, ms since room start).
        if ((b[0]! & 0x1f) === 15 && (b[0]! & 0x80) !== 0 && b.length >= 5) {
          const sNow = b[1]! | (b[2]! << 8) | (b[3]! << 16) | (b[4]! << 24);
          w.__perf.patches.push([performance.now(), sNow >>> 0, d.byteLength]);
        } else w.__perf.other += d.byteLength;
      });
    }
  }
  (window as unknown as { WebSocket: typeof WebSocket }).WebSocket = Probe as unknown as typeof WebSocket;
};

interface Sample {
  frames: number[];
  long: number[];
  patches: [number, number, number][];
  other: number;
  cpuAvg: number;
  cpuP95: number;
  pred: { reconciles: number; corrected: number; maxErrM: number };
  raid: { hMove: number; hStall: number; hJump: number; hunters: number; stage: number; wave: number };
  calls: number;
  tris: number;
  local: { stallFrames: number; frames: number };
}

const take = (p: Page): Promise<Sample> =>
  p.evaluate(() => {
    const w = window as unknown as { __perf: { frames: number[]; long: number[]; patches: [number, number, number][]; other: number }; __qwakk: any };
    const q = w.__perf;
    const s = w.__qwakk.snapshot();
    const r = w.__qwakk.raid() ?? {};
    const res = { frames: q.frames, long: q.long, patches: q.patches, other: q.other, cpuAvg: s.cpuMsAvg, cpuP95: s.cpuMsP95, pred: s.prediction, raid: { hMove: r.hMove ?? 0, hStall: r.hStall ?? 0, hJump: r.hJump ?? 0, hunters: r.hunters ?? 0, stage: r.stage ?? -1, wave: r.wave ?? 0 }, calls: s.render.drawCalls, tris: s.render.triangles, local: { stallFrames: s.localMotion.stallFrames ?? 0, frames: s.localMotion.frames } };
    q.frames = [];
    q.long = [];
    q.patches = [];
    q.other = 0;
    return res;
  });

const pct = (a: number[], p: number): number => {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
};
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const f1 = (v: number) => v.toFixed(1);

interface ServerSnap { roomId: string; ticks: number; tickAvgMs: number; tickP95Ms: number; tickMaxMs: number; patchAvgMs: number; patchP95Ms: number; cpuPct: number; hunters?: number }

function run(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}): ChildProcess {
  return spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function waitFor(proc: ChildProcess, needle: string, timeoutMs = 240000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${needle}"`)), timeoutMs);
    const on = (c: Buffer) => {
      if (c.toString().includes(needle)) {
        clearTimeout(timer);
        resolve();
      }
    };
    proc.stdout?.on('data', on);
    proc.stderr?.on('data', on);
  });
}

/** Measure one stage: `secs` of play, sampled every 5 s (the page's buffers are drained each time). */
async function stage(p: Page, label: string, secs: number, snaps: ServerSnap[], rows: string[], cdp?: CDPSession): Promise<void> {
  await take(p); // drop what came before
  const pred0 = (await p.evaluate(() => (window as any).__qwakk.snapshot().prediction)) as Sample['pred'];
  const raid0 = (await p.evaluate(() => (window as any).__qwakk.raid())) as Sample['raid'];
  const local0 = (await p.evaluate(() => (window as any).__qwakk.snapshot().localMotion)) as Sample['local'];
  const n0 = snaps.length;
  const all: Sample[] = [];
  if (cdp) await cdp.send('Profiler.start');
  const end = Date.now() + secs * 1000;
  while (Date.now() < end) {
    await sleep(5000);
    all.push(await take(p));
  }
  if (cdp) {
    const { profile } = (await cdp.send('Profiler.stop')) as { profile: CpuProfile };
    writeFileSync(`${out}/raid-${label.replace(/\W+/g, '-')}.cpuprofile`, JSON.stringify(profile));
    console.log(`hottest functions (${label}, self time):\n${hottest(profile)}`);
  }
  await p.screenshot({ path: `${out}/raid-perf-${label.replace(/\W+/g, '-')}.png` });
  const frames = all.flatMap((s) => s.frames);
  const long = all.flatMap((s) => s.long);
  const patches = all.flatMap((s) => s.patches);
  const stampGaps: number[] = [];
  const arriveGaps: number[] = [];
  for (let i = 1; i < patches.length; i++) {
    stampGaps.push(patches[i]![1] - patches[i - 1]![1]);
    arriveGaps.push(patches[i]![0] - patches[i - 1]![0]);
  }
  const bytes = patches.map((x) => x[2]);
  const last = all[all.length - 1]!;
  const corrected = last.pred.corrected - pred0.corrected;
  const hMove = last.raid.hMove - raid0.hMove;
  const srv = snaps.slice(n0).filter((s) => s.ticks > 0);
  const sAvg = avg(srv.map((s) => s.tickAvgMs));
  const sP95 = Math.max(0, ...srv.map((s) => s.tickP95Ms));
  const sMax = Math.max(0, ...srv.map((s) => s.tickMaxMs));
  const pAvg = avg(srv.map((s) => s.patchAvgMs));
  const hunters = Math.round(avg(all.map((s) => s.raid.hunters)));
  const lf = last.local.frames - local0.frames;
  const localStall = lf > 0 ? `${last.local.stallFrames - (local0.stallFrames ?? 0)} of ${lf}` : '-';
  rows.push(
    `| ${label} | ${hunters} | ${f1(pct(frames, 0.5))} / ${f1(pct(frames, 0.95))} / ${f1(pct(frames, 0.99))} / ${f1(Math.max(0, ...frames))} | ${frames.filter((x) => x > 50).length} of ${frames.length} | ${long.length} / ${Math.round(long.reduce((a, b) => a + b, 0))} / ${Math.round(Math.max(0, ...long))} | ${f1(avg(all.map((s) => s.cpuAvg)))} / ${f1(Math.max(...all.map((s) => s.cpuP95)))} | ${f1(patches.length / secs)} / ${Math.round(avg(bytes))} / ${Math.round(pct(bytes, 0.95))} | ${f1(pct(stampGaps, 0.95))} / ${Math.max(0, ...stampGaps)} | ${f1(pct(arriveGaps, 0.95))} / ${f1(Math.max(0, ...arriveGaps))} | ${corrected} | ${localStall} | ${hMove ? ((100 * (last.raid.hStall - raid0.hStall)) / hMove).toFixed(2) : '-'}% / ${hMove ? ((100 * (last.raid.hJump - raid0.hJump)) / hMove).toFixed(2) : '-'}% | ${sAvg.toFixed(2)} / ${sP95.toFixed(2)} / ${sMax.toFixed(1)} | ${pAvg.toFixed(2)} |`,
  );
}

interface CpuProfile {
  nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }[];
  samples: number[];
  timeDeltas: number[];
}

function hottest(p: CpuProfile, n = 25): string {
  const self = new Map<number, number>();
  for (let i = 0; i < p.samples.length; i++) self.set(p.samples[i]!, (self.get(p.samples[i]!) ?? 0) + (p.timeDeltas[i] ?? 0));
  const byName = new Map<string, number>();
  let total = 0;
  for (const node of p.nodes) {
    const t = self.get(node.id) ?? 0;
    total += t;
    const cf = node.callFrame;
    const file = cf.url.split('/').pop() ?? '';
    const key = `${cf.functionName || '(anon)'} ${file}:${cf.lineNumber}`;
    byName.set(key, (byName.get(key) ?? 0) + t);
  }
  return [...byName]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, t]) => `  ${((100 * t) / total).toFixed(1).padStart(5)}%  ${(t / 1000).toFixed(0).padStart(6)} ms  ${k}`)
    .join('\n');
}

async function main(): Promise<void> {
  const db = await e2eDatabase('raidperf');
  const server = run(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], root, {
    PORT: String(SERVER_PORT),
    DATABASE_URL: db.url,
    QWAKK_BOTS: '0',
    QWAKK_RAID_COUNTDOWN: '4',
    QWAKK_TEST_HOOKS: '1',
    QWAKK_STATS: '1',
    QWAKK_STATS_MS: '5000',
  });
  const snaps: ServerSnap[] = [];
  let buf = '';
  server.stdout!.on('data', (c: Buffer) => {
    buf += c.toString();
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.startsWith('[stats] ')) {
        const s = JSON.parse(line.slice(8)) as ServerSnap & { hunters?: number };
        if (s.hunters !== undefined) snaps.push(s);
      }
    }
  });
  const web = DEV
    ? run(process.execPath, [`${root}/node_modules/vite/bin/vite.js`, '--port', String(WEB_PORT), '--strictPort'], `${root}/apps/client`, { VITE_SERVER_PORT: String(SERVER_PORT) })
    : run(process.execPath, [`${root}/node_modules/vite/bin/vite.js`, 'preview', '--outDir', DIST, '--port', String(WEB_PORT), '--strictPort'], `${root}/apps/client`);
  const procs = [server, web];
  const cleanup = () => procs.forEach((p) => p.exitCode === null && p.kill('SIGINT'));
  process.on('exit', cleanup);
  try {
    await Promise.all([waitFor(server, 'pond-keep navmesh ready'), waitFor(web, String(WEB_PORT))]);
    const browser = await chromium.launch({ channel: process.env.E2E_BROWSER === 'chromium' ? undefined : 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] });
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 720 } });
    const s = await signUpApi(API, `perf.raid.${Date.now() % 100000}@example.com`, [['Perfduck', 0]]);
    await seedBrowser(ctx, accountSeed(s));
    await ctx.addInitScript(PROBE);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[page error]', e.message));
    const cdp = process.env.PROFILE === '1' ? await ctx.newCDPSession(page) : undefined;
    if (cdp) await cdp.send('Profiler.enable');
    // THROTTLE=4: a slower CPU (a phone or an older laptop) through the DevTools protocol.
    const throttle = Number(process.env.THROTTLE ?? 1);
    if (throttle > 1) await (cdp ?? (await ctx.newCDPSession(page))).send('Emulation.setCPUThrottlingRate', { rate: throttle });
    await page.goto(`http://localhost:${WEB_PORT}/game/?lang=en&server=ws://localhost:${SERVER_PORT}&hud=0&menu=1&autopilot=raid${process.env.Q ?? ''}`);
    await pickDuck(page, 120_000);
    await openSheet(page, 0);
    await page.locator('.qm-sheet-mode[data-mode="raid"]').click();
    await page.waitForFunction(() => (window as any).__qwakk?.raid() != null, null, { timeout: 120_000 });
    await page.evaluate(() => document.getElementById('overlay')?.classList.add('hidden'));
    // The hitch timeline from the moment the run's room is up: every long frame and what had just appeared on screen.
    const tJoin = await page.evaluate(() => performance.now());
    const seen = new Map<number, number>();
    const events: [number, string][] = [];
    let polling = true;
    let lastKills = 0;
    const poll = (async () => {
      while (polling) {
        const v = await page.evaluate(() => ({ t: performance.now(), h: (window as any).__qwakk.hunters() as { kind: number }[], r: (window as any).__qwakk.raid() })).catch(() => null);
        if (v) {
          for (const h of v.h) if (!seen.has(h.kind)) {
            seen.set(h.kind, v.t);
            events.push([v.t, `kind ${h.kind} first drawn`]);
          }
          if (v.r && v.r.kills > lastKills) {
            if (lastKills === 0) events.push([v.t, 'first defeat drawn']);
            lastKills = v.r.kills;
          }
        }
        await sleep(150);
      }
    })();
    const info = await page.evaluate(() => `backend ${(window as any).__qwakk.snapshot().backend}, ${navigator.hardwareConcurrency} threads`) + (throttle > 1 ? `, CPU throttled ${throttle}x` : '');
    const rows: string[] = [];
    let stopTopUp = (): void => undefined;
    await page.waitForFunction(() => (window as any).__qwakk.raid()?.stage === 2, null, { timeout: 120_000 });
    await stage(page, `opening${DEV ? ' (vite dev)' : ''}`, seconds, snaps, rows);
    console.log(`scene in the opening: ${JSON.stringify(await page.evaluate(() => (window as any).__qwakk.sceneStats()))}`);
    polling = false;
    await poll;
    const hitches = (await page.evaluate(() => (window as any).__perf.hitches.splice(0))) as [number, number][];
    console.log(`hitch timeline (s after joining the run): ${hitches.filter((h) => h[0] >= tJoin).map(([t, d]) => `${((t - tJoin) / 1000).toFixed(1)} s ${d} ms`).join(', ') || 'none'}`);
    console.log(`what appeared: ${events.map(([t, e]) => `${((t - tJoin) / 1000).toFixed(1)} s ${e}`).join(', ')}`);
    // The peak: the duck held (no damage) out in the field, a horde of PEAK hunters around it (the four-duck peak, past a solo run's cap), the autopilot cutting into it.
    const dev = (op: string, wave = 0) => page.evaluate(([o, w]) => (window as any).__qwakk.devRaid(o, w), [op, wave] as const);
    const peak = Number(process.env.PEAK ?? 44);
    await dev('hold');
    await dev('quiet', 1);
    await dev('tpgoal', 24);
    await sleep(1500);
    await dev('horde', peak);
    await page.waitForFunction((n) => ((window as any).__qwakk.raid()?.hunters ?? 0) >= n * 0.8, peak, { timeout: 30_000 }).catch(() => console.log('note: fewer hunters out than asked'));
    // Keep it topped up while measuring (the autopilot cuts them down).
    const topUp = setInterval(() => void page.evaluate(([n]) => {
      const q = (window as any).__qwakk;
      const have = q.raid()?.hunters ?? 0;
      if (have < n * 0.75) q.devRaid('horde', n - have);
    }, [peak] as const).catch(() => undefined), 3000);
    stopTopUp = () => clearInterval(topUp);
    await stage(page, `peak, ${peak} hunters${DEV ? ' (vite dev)' : ''}`, seconds, snaps, rows, cdp);
    console.log(`scene at the peak: ${JSON.stringify(await page.evaluate(() => (window as any).__qwakk.sceneStats()))}`);
    stopTopUp();
    const r = await page.evaluate(() => (window as any).__qwakk.raid());
    if (r.stage !== RaidStage.Fight) console.log(`note: the run is at stage ${r.stage}`);
    console.log(info);
    console.log('| Stage | Hunters drawn | Frame p50 / p95 / p99 / max (ms) | Frames > 50 ms | Long tasks n / total / max (ms) | Our CPU per frame avg / p95 (ms) | Patches/s / bytes avg / p95 | Server stamp gap p95 / max (ms) | Arrival gap p95 / max (ms) | Corrections | Our duck stall frames | Hunter stall / jump frames | Server tick avg / p95 / max (ms) | Patch encode avg (ms) |');
    console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const row of rows) console.log(row);
    console.log(`screenshots and profiles in ${out}`);
    await browser.close();
  } finally {
    cleanup();
    await sleep(300);
    await db.drop().catch(() => {});
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
