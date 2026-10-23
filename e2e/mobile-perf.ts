/**
 * Phone frame time under emulation: headless Chrome as a landscape phone
 * (844 x 390, device scale 3, touch, coarse pointer) with the CPU throttled
 * 4x through the DevTools protocol. Plays a deathmatch (24 ducks, bots) on
 * autopilot, then a battle royale (plane, drop, on foot in the village) and
 * prints frame time, our CPU time per frame, draw calls and triangles per
 * stage. The GPU is the desktop's, so this measures the main thread side of a
 * phone frame; real phones still need a check on the device.
 *
 * Usage: npm run perf:mobile [-- OUTDIR [seconds]]   (build:test first)
 * Env: THROTTLE=4 (CPU slowdown), Q='&quality=high' (extra URL options).
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? join(tmpdir(), 'qwakk-shots-mobile-perf');
const seconds = Number(process.argv[3] ?? 70);
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 2567);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5173);
const throttle = Number(process.env.THROTTLE ?? 4);
mkdirSync(out, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const STAGES = ['on foot', 'plane', 'freefall', 'glide'];

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], {
  cwd: root,
  stdio: 'ignore',
  env: { ...process.env, PORT: String(SERVER_PORT), QWAKK_BR_COUNTDOWN: '4', QWAKK_BR_MIN_HUMANS: '1', QWAKK_BR_SEED: '7', QWAKK_ZONE_SCALE: '0.5' },
});
const web = spawn(process.execPath, [`${root}/node_modules/vite/bin/vite.js`, 'preview', '--outDir', process.env.E2E_DIST ?? 'dist-test', '--port', String(WEB_PORT), '--strictPort'], { cwd: `${root}/apps/client`, stdio: 'ignore' });

type Row = { n: number; cpu: number[]; cpu95: number[]; frame: number[]; calls: number[]; tris: number[] };
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const max = (a: number[]) => a.reduce((x, y) => Math.max(x, y), 0);

async function measure(page: Page, label: string, secs: number, rows: Map<string, Row>): Promise<void> {
  const t0 = Date.now();
  let lastStage = '';
  while (Date.now() - t0 < secs * 1000) {
    await sleep(1000);
    const s = await page.evaluate(() => (window as any).__qwakk?.snapshot() ?? null);
    if (!s || !s.mine || (label === 'br' && s.phase === 2)) continue;
    const stage = label === 'dm' ? 'deathmatch' : `royale ${STAGES[s.mine.mode] ?? '?'}`;
    if (!rows.has(stage)) rows.set(stage, { n: 0, cpu: [], cpu95: [], frame: [], calls: [], tris: [] });
    const r = rows.get(stage)!;
    // The first seconds of a stage warm up shaders and LODs.
    if (stage !== lastStage) {
      lastStage = stage;
      await page.screenshot({ path: `${out}/mobile-perf-${stage.replace(/ /g, '-')}.png` });
      continue;
    }
    r.n++;
    r.cpu.push(s.cpuMsAvg);
    r.cpu95.push(s.cpuMsP95);
    r.frame.push(s.frameMsAvg);
    r.calls.push(s.render.drawCalls);
    r.tris.push(s.render.triangles);
  }
}

try {
  await sleep(4000);
  const browser = await chromium.launch({ channel: process.env.E2E_BROWSER === 'chromium' ? undefined : 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] });
  const rows = new Map<string, Row>();
  let info = '';
  for (const mode of ['dm', 'br'] as const) {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[page error]', e.message));
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    const q = mode === 'dm' ? 'mode=dm&autopilot=1' : 'mode=br&autopilot=br&aptarget=40,-192';
    await page.goto(`http://localhost:${WEB_PORT}/game/?server=ws://localhost:${SERVER_PORT}&${q}&name=Phone&hud=0${process.env.Q ?? ''}`);
    await page.waitForFunction(() => (window as any).__qwakk?.snapshot().players >= 1, null, { timeout: 120000 });
    info ||= await page.evaluate(() => `dpr ${devicePixelRatio}, canvas ${(document.getElementById('game') as HTMLCanvasElement).width}x${(document.getElementById('game') as HTMLCanvasElement).height}, coarse ${matchMedia('(pointer: coarse)').matches}, backend ${(window as any).__qwakk.snapshot().backend}`);
    await measure(page, mode, mode === 'dm' ? Math.min(30, seconds) : seconds, rows);
    await ctx.close();
  }
  console.log(`CPU throttle ${throttle}x, ${info}${process.env.Q ? `, options ${process.env.Q}` : ''}`);
  console.log('| Stage | Samples | Frame avg (ms) | CPU per frame avg / p95 max (ms) | Draw calls avg / max | Triangles avg / max |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const [stage, r] of rows) {
    if (r.n === 0) continue;
    console.log(`| ${stage} | ${r.n} | ${avg(r.frame).toFixed(1)} | ${avg(r.cpu).toFixed(2)} / ${max(r.cpu95).toFixed(2)} | ${avg(r.calls).toFixed(0)} / ${max(r.calls)} | ${Math.round(avg(r.tris) / 1000)}k / ${Math.round(max(r.tris) / 1000)}k |`);
  }
  await browser.close();
} finally {
  server.kill('SIGINT');
  web.kill('SIGINT');
}
process.exit(0);
