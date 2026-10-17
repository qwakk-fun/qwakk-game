/** Reproducible visibility comparison using the shipped shaders, terrain textures and hedge model. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

declare global {
  interface Window {
    __characters?: { ready: boolean; shot(background: string, distance: number, character: number, helmet?: number): Promise<unknown> };
  }
}
const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? '/private/tmp/qwakk-characters';
mkdirSync(out, { recursive: true });
const port = 5187;
const web = spawn(process.execPath, [`${root}/node_modules/vite/bin/vite.js`, '--port', String(port), '--strictPort'], { cwd: `${root}/apps/client`, stdio: 'pipe' });
const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Vite startup timed out')), 10000);
    web.stdout.on('data', (b: Buffer) => { if (b.toString().includes(String(port))) { clearTimeout(timer); resolve(); } });
    web.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Vite exited ${code}`)); });
});
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] });
try {
  await ready;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/game/mapview.html?characters=1`);
  await page.waitForFunction(() => window.__characters?.ready, null, { timeout: 60000 });
  const rows: { background: string; distance: number; classic: number; sarge: number; ratio: number }[] = [];
  for (const background of ['grass', 'hedge', 'cobble']) for (const distance of [10, 25, 50]) {
    const frames: string[] = [];
    for (const character of [-1, 0, 1, 2]) {
      await page.evaluate(async ([bg, d, c]) => window.__characters!.shot(String(bg), Number(d), Number(c)), [background, distance, character]);
      const png = await page.screenshot({ path: `${out}/${background}-${distance}-${character}.png` });
      frames.push(png.toString('base64'));
    }
    // Total RGB distance from the identical background, including coverage.
    // This is a repeatable visibility proxy, not a human detection study.
    const values = await page.evaluate(async (images) => {
      const decode = async (b64: string): Promise<Uint8ClampedArray> => {
        const image = new Image(); image.src = `data:image/png;base64,${b64}`; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const [base, classic, sarge] = await Promise.all(images.slice(0, 3).map(decode));
      return [classic!, sarge!].map((pixels) => {
        let sum = 0;
        for (let i = 0; i < pixels.length; i += 4) sum += Math.hypot(pixels[i]! - base![i]!, pixels[i + 1]! - base![i + 1]!, pixels[i + 2]! - base![i + 2]!);
        return sum;
      });
    }, frames);
    const classic = values[0]!; const sarge = values[1]!;
    assert.ok(classic > 0, `${background}/${distance}: target must be visible`);
    rows.push({ background, distance, classic: Math.round(classic), sarge: Math.round(sarge), ratio: Number((sarge / classic).toFixed(3)) });
  }
  for (const helmet of [1, 2]) {
    await page.evaluate(async (level) => window.__characters!.shot('grass', 5, 1, level), helmet);
    await page.screenshot({ path: `${out}/helmet-${helmet}.png` });
  }
  writeFileSync(`${out}/contrast.json`, JSON.stringify(rows, null, 2));
  for (const row of rows) assert.ok(row.ratio >= 1, `${row.background}/${row.distance}: Toski contrast ${row.ratio} below Qwakk`);
  assert.deepEqual(errors, []);
  console.log(`character review: ${rows.length} backgrounds/distances passed, Toski/Qwakk contrast ${Math.min(...rows.map((r) => r.ratio))} to ${Math.max(...rows.map((r) => r.ratio))}`);
} finally {
  await browser.close();
  if (web.exitCode === null) web.kill('SIGINT');
}
