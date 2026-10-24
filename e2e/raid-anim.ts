/**
 * Hunt Season animation smoothness in headless Chrome: one signed-in duck in
 * a run, held (no damage) out in the field with no packs, driven through a
 * few moves while every frame of its drawn skeleton is recorded
 * (`animTraceStart`/`animTraceStop` on the test hook): running with the
 * katana, a light combo while running, a combo standing, sprinting with a
 * combo. Per move it prints the frame times and the "pops": frames where a
 * bone (hands, feet, hips, head; in the duck's own frame) jumps much further
 * than in the frames around it (a clip restarting, a blend snapping, legs
 * switching gait). Saves a short frame sequence of the running combo
 * (DevTools screencast) to OUTDIR.
 *
 * Usage: npm run anim:raid [-- OUTDIR]   (build:test first)
 * Env: E2E_SERVER_PORT, E2E_WEB_PORT, E2E_DIST (a bundle built for that server port);
 *      DEV=1 serves the client with the Vite dev server (what `npm run dev` runs);
 *      THROTTLE=4 slows the page's CPU four times.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { Button } from '@qwakk/shared';
import { accountSeed, e2eDatabase, openSheet, pickDuck, seedBrowser, signUpApi } from './lib/accounts.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? join(tmpdir(), 'qwakk-shots-raid-anim');
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 2567);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5173);
const DIST = process.env.E2E_DIST ?? 'dist-test';
const DEV = process.env.DEV === '1';
const API = `http://localhost:${SERVER_PORT}`;
mkdirSync(out, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

interface Trace {
  names: string[];
  frames: { t: number; act: number; v: number; bones: number[] }[];
}

const pct = (a: number[], p: number): number => {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
};

/** Frames where a bone moved over 3.5 cm and over 3 times the median of the 6 frames around it. */
function pops(tr: Trace, bone: number): number {
  const d: number[] = [];
  const f = tr.frames;
  for (let i = 1; i < f.length; i++) {
    const a = f[i - 1]!.bones;
    const b = f[i]!.bones;
    d.push(Math.hypot(b[bone * 3]! - a[bone * 3]!, b[bone * 3 + 1]! - a[bone * 3 + 1]!, b[bone * 3 + 2]! - a[bone * 3 + 2]!));
  }
  let n = 0;
  for (let i = 3; i < d.length - 3; i++) {
    const around = [d[i - 3]!, d[i - 2]!, d[i - 1]!, d[i + 1]!, d[i + 2]!, d[i + 3]!].sort((x, y) => x - y);
    const med = (around[2]! + around[3]!) / 2;
    if (d[i]! > 0.035 && d[i]! > 3 * med) n++;
  }
  return n;
}

function report(label: string, tr: Trace): string {
  const f = tr.frames;
  const dts = f.slice(1).map((x, i) => x.t - f[i]!.t);
  const secs = (f[f.length - 1]!.t - f[0]!.t) / 1000;
  const idx = (n: string) => tr.names.indexOf(n);
  const hands = pops(tr, idx('RightHand')) + pops(tr, idx('LeftHand'));
  const feet = pops(tr, idx('LeftFoot')) + pops(tr, idx('RightFoot'));
  const body = pops(tr, idx('Hips')) + pops(tr, idx('Head'));
  let acts = 0;
  for (let i = 1; i < f.length; i++) if (f[i]!.act !== f[i - 1]!.act) acts++;
  const speed = f.reduce((a, x) => a + x.v, 0) / Math.max(1, f.length);
  const per = (n: number) => (n / Math.max(0.1, secs)).toFixed(2);
  return `| ${label} | ${f.length} | ${pct(dts, 0.5).toFixed(1)} / ${pct(dts, 0.95).toFixed(1)} / ${Math.max(0, ...dts).toFixed(1)} | ${speed.toFixed(1)} | ${acts} | ${per(hands)} | ${per(feet)} | ${per(body)} |`;
}

async function main(): Promise<void> {
  const db = await e2eDatabase('raidanim');
  const server = run(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], root, {
    PORT: String(SERVER_PORT),
    DATABASE_URL: db.url,
    QWAKK_BOTS: '0',
    QWAKK_RAID_COUNTDOWN: '4',
    QWAKK_TEST_HOOKS: '1',
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
    const s = await signUpApi(API, `anim.raid.${Date.now() % 100000}@example.com`, [['Animduck', 0]]);
    await seedBrowser(ctx, accountSeed(s));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[page error]', e.message));
    const cdp = await ctx.newCDPSession(page);
    const throttle = Number(process.env.THROTTLE ?? 1);
    if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    await page.goto(`http://localhost:${WEB_PORT}/game/?lang=en&server=ws://localhost:${SERVER_PORT}&hud=0&menu=1&autopilot=raid`);
    await pickDuck(page, 120_000);
    await openSheet(page, 0);
    await page.locator('.qm-sheet-mode[data-mode="raid"]').click();
    await page.waitForFunction(() => (window as any).__qwakk?.raid() != null, null, { timeout: 120_000 });
    await page.evaluate(() => document.getElementById('overlay')?.classList.add('hidden'));
    await page.waitForFunction(() => (window as any).__qwakk.raid()?.stage === 2, null, { timeout: 120_000 });
    const dev = (op: string, wave = 0) => page.evaluate(([o, w]) => (window as any).__qwakk.devRaid(o, w), [op, wave] as const);
    // Out in the open field, held, nobody around.
    await dev('hold');
    await dev('quiet', 1);
    await dev('freeze', 1);
    await dev('resetgoal');
    await sleep(3000);
    const rows: string[] = [];
    const move = async (label: string, mz: number, buttons: number, fireEvery: number, secs: number, shots?: string): Promise<void> => {
      await dev('tpgoal', 40);
      await dev('resetgoal');
      await page.evaluate((ms) => (window as any).__qwakk.hold(ms), secs * 1000 + 3000);
      await sleep(800);
      await page.evaluate(() => (window as any).__qwakk.animTraceStart());
      // In the page: the move held, Fire tapped for one tick every `fireEvery` ms (0: never).
      await page.evaluate(([mz, buttons, every, secs, fire]) => {
        const q = (window as any).__qwakk;
        const t0 = performance.now();
        const id = setInterval(() => {
          const t = performance.now() - t0;
          if (t > secs * 1000) return clearInterval(id);
          const tap = every > 0 && t % every < 40;
          q.press(buttons | (tap ? fire : 0), 45, mz);
        }, 15);
      }, [mz, buttons, fireEvery, secs, Button.Fire] as const);
      if (shots) {
        // A short frame sequence, as Chrome painted it.
        let n = 0;
        const onFrame = (e: { data: string; sessionId: number }) => {
          if (n < 60) writeFileSync(`${out}/${shots}-${String(n++).padStart(2, '0')}.jpg`, Buffer.from(e.data, 'base64'));
          void cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => undefined);
        };
        cdp.on('Page.screencastFrame', onFrame);
        await sleep(1200);
        await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 960, maxHeight: 540, everyNthFrame: 1 });
        await sleep(1500);
        await cdp.send('Page.stopScreencast');
        cdp.off('Page.screencastFrame', onFrame);
        await sleep(secs * 1000 - 2700);
      } else await sleep(secs * 1000);
      const tr = (await page.evaluate(() => (window as any).__qwakk.animTraceStop())) as Trace;
      rows.push(report(label, tr));
      writeFileSync(`${out}/trace-${label.replace(/\W+/g, '-')}.json`, JSON.stringify(tr));
    };
    await move('run, katana out', 1, 0, 0, 5);
    await move('run + light combo taps', 1, 0, 190, 6, 'run-combo');
    await move('stand + light combo taps', 0, 0, 190, 6, 'stand-combo');
    await move('sprint + light combo taps', 1, Button.Sprint, 190, 6);
    const pred = await page.evaluate(() => (window as any).__qwakk.snapshot().prediction);
    console.log(`backend ${await page.evaluate(() => (window as any).__qwakk.snapshot().backend)}${throttle > 1 ? `, CPU throttled ${throttle}x` : ''}${DEV ? ', vite dev server' : ''}; corrections ${pred.corrected} of ${pred.reconciles}`);
    console.log('| Move | Frames | Frame p50 / p95 / max (ms) | Drawn speed (m/s) | Act changes | Hand pops /s | Foot pops /s | Hips and head pops /s |');
    console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of rows) console.log(r);
    console.log(`frames and traces in ${out}`);
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
