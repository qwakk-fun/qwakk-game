/**
 * Map rendering benchmark in headless Chrome: opens the dev-only map viewer
 * (build the test bundle first: npm run build:test), flies its camera path
 * (plane pass, glide over the village, street walk, a turn at the village
 * square, 16 ducks in the square) and prints frame time, CPU time per frame,
 * draw calls and triangles per segment. Saves a screenshot per segment.
 *
 * Usage: npm run perf:map [-- OUTDIR] [-- --quality=low] [-- --webgl]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = 5181;
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--'));
const quality = args.includes('--quality=low') ? 'low' : 'high';
const webgl = args.includes('--webgl');
/** Extra viewer options, e.g. --query=ducks=0&shadows=0 */
const extra = args.find((a) => a.startsWith('--query='))?.slice(8) ?? '';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  if (!existsSync(`${root}/apps/client/dist-test/mapview.html`)) throw new Error('Build the test client first: npm run build:test');
  if (out) mkdirSync(out, { recursive: true });
  const web = spawn(process.execPath, [`${root}/node_modules/vite/bin/vite.js`, 'preview', '--outDir', process.env.E2E_DIST ?? 'dist-test', '--port', String(PORT), '--strictPort'], { cwd: `${root}/apps/client`, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('vite preview did not start')), 20000);
      web.stdout!.on('data', (c: Buffer) => {
        if (c.toString().includes(String(PORT))) {
          clearTimeout(t);
          resolve();
        }
      });
    });
    const useChrome = (process.env.E2E_BROWSER ?? 'chrome') === 'chrome';
    const browser = await chromium.launch({
      ...(useChrome ? { channel: 'chrome' } : {}),
      headless: true,
      args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
    });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()));
    await page.goto(`http://localhost:${PORT}/game/mapview.html?quality=${quality}${webgl ? '&webgl=1' : ''}&hud=0${extra ? `&${extra}` : ''}`);
    await page.waitForFunction(() => (window as any).__mapview?.ready === true, null, { timeout: 60000 });
    let shot = '';
    for (;;) {
      await sleep(250);
      const s = await page.evaluate(() => ({ done: (window as any).__mapview.done as boolean, segment: (window as any).__mapview.segment as string }));
      if (out && s.segment && s.segment !== shot) {
        await sleep(1800);
        shot = s.segment;
        await page.screenshot({ path: `${out}/mapview-${shot}.png` });
      }
      if (s.done) break;
    }
    const results = await page.evaluate(() => (window as any).__mapview.results);
    const backend = await page.evaluate(() => ('gpu' in navigator ? 'WebGPU available' : 'no WebGPU'));
    console.log(`quality ${quality}, ${webgl ? 'WebGL2 forced' : backend}${extra ? `, ${extra}` : ''}`);
    console.log('| Segment | Frame avg / p95 (ms) | CPU per frame avg / p95 (ms) | Draw calls avg / max | Triangles avg / max |');
    console.log('| --- | --- | --- | --- | --- |');
    for (const r of results) {
      console.log(`| ${r.name} | ${r.frameMsAvg} / ${r.frameMsP95} | ${r.cpuMsAvg} / ${r.cpuMsP95} | ${r.drawCallsAvg} / ${r.drawCallsMax} | ${r.trianglesAvg} / ${r.trianglesMax} |`);
    }
    await browser.close();
  } finally {
    web.kill('SIGINT');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
