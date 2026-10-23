/**
 * Battle royale frame time and draw calls in headless Chrome: one autopilot
 * client (aimed at the village) in a full 16-duck match with server bots.
 * Samples once a second and prints a table per stage (plane, freefall,
 * glide, on foot). Headless Chrome is vsync capped at 60 fps, so the CPU time
 * of our own frame is the useful number; draw calls and triangles come from
 * the renderer. Saves a few frames.
 *
 * Usage: npm run perf:br [-- OUTDIR [seconds]]   (build:test first)
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? join(tmpdir(), 'qwakk-shots-br-perf');
const seconds = Number(process.argv[3] ?? 90);
mkdirSync(out, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const STAGES = ['on foot', 'plane', 'freefall', 'glide'];

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], {
  cwd: root,
  stdio: 'ignore',
  env: { ...process.env, PORT: '2567', QWAKK_BR_COUNTDOWN: '4', QWAKK_BR_MIN_HUMANS: '1', QWAKK_BR_SEED: '7', QWAKK_ZONE_SCALE: '0.5' },
});
const web = spawn(process.execPath, [`${root}/node_modules/vite/bin/vite.js`, 'preview', '--outDir', process.env.E2E_DIST ?? 'dist-test', '--port', '5173', '--strictPort'], { cwd: `${root}/apps/client`, stdio: 'ignore' });
try {
  await sleep(4000);
  const browser = await chromium.launch({ channel: process.env.E2E_BROWSER === 'chromium' ? undefined : 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  await page.goto(`http://localhost:5173/game/?mode=br&autopilot=br&name=Perf&hud=0&aptarget=40,-192${process.env.Q ?? ''}`);
  await page.waitForFunction(() => (window as any).__qwakk?.snapshot().players >= 1, null, { timeout: 60000 });
  const rows = new Map<string, { n: number; cpu: number[]; cpu95: number[]; frame: number[]; calls: number[]; tris: number[]; ducks: number[] }>();
  const t0 = Date.now();
  let shots = 0;
  let lastStage = '';
  while (Date.now() - t0 < seconds * 1000) {
    await sleep(1000);
    const s = await page.evaluate(() => (window as any).__qwakk.snapshot());
    if (s.phase === 2 || !s.mine) continue; // warm-up
    const stage = s.mine.hp > 0 || s.me?.alive ? (STAGES[s.mine.mode] ?? '?') : 'dead';
    if (!rows.has(stage)) rows.set(stage, { n: 0, cpu: [], cpu95: [], frame: [], calls: [], tris: [], ducks: [] });
    const r = rows.get(stage)!;
    r.n++;
    r.cpu.push(s.cpuMsAvg);
    r.cpu95.push(s.cpuMsP95);
    r.frame.push(s.frameMsAvg);
    r.calls.push(s.render.drawCalls);
    r.tris.push(s.render.triangles);
    r.ducks.push(s.visibleRemotes.length);
    if (stage !== lastStage || (stage === 'on foot' && shots < 6 && r.n % 10 === 0)) {
      await page.screenshot({ path: `${out}/perf-${String(shots++).padStart(2, '0')}-${stage.replace(' ', '-')}.png` });
      lastStage = stage;
    }
  }
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const max = (a: number[]) => a.reduce((x, y) => Math.max(x, y), 0);
  console.log('| Stage | Samples | Frame avg (ms) | CPU per frame avg / p95 (ms) | Draw calls avg / max | Triangles avg / max | Enemy ducks drawn avg / max |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  for (const [stage, r] of rows) {
    console.log(`| ${stage} | ${r.n} | ${avg(r.frame).toFixed(1)} | ${avg(r.cpu).toFixed(2)} / ${max(r.cpu95).toFixed(2)} | ${avg(r.calls).toFixed(0)} / ${max(r.calls)} | ${Math.round(avg(r.tris) / 1000)}k / ${Math.round(max(r.tris) / 1000)}k | ${avg(r.ducks).toFixed(1)} / ${max(r.ducks)} |`);
  }
  await browser.close();
} finally {
  server.kill('SIGINT');
  web.kill('SIGINT');
}
process.exit(0);
