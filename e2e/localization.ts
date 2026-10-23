/** Turkish/English menu, character load recovery, persistence and an actual Turkish deathmatch HUD. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { seedBrowser } from './lib/accounts.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? '/private/tmp/qwakk-localization';
mkdirSync(out, { recursive: true });
const procs: ChildProcess[] = [];
async function start(args: string[], cwd: string, needle: string, env: Record<string, string>): Promise<void> {
  const proc = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: 'pipe' });
  procs.push(proc);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup: ${needle}`)), 30000);
    proc.stdout!.on('data', (b: Buffer) => { if (b.toString().includes(needle)) { clearTimeout(timer); resolve(); } });
    proc.once('exit', (code) => { clearTimeout(timer); reject(new Error(`process exited ${code}`)); });
  });
}
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] });
try {
  await start(['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], root, 'server listening', { PORT: '2590', QWAKK_BOTS: '0' });
  await start([`${root}/node_modules/vite/bin/vite.js`, '--port', '5192', '--strictPort'], `${root}/apps/client`, '5192', { VITE_GAME_SERVER: 'ws://localhost:2590' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'tr-TR' });
  await seedBrowser(ctx, { guest: true }); // the guest menu (name and look steps)
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:5192/game/?menu=1&hud=0');
  await page.locator('#qm-tab-play', { hasText: 'Oyna' }).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'tr');
  await page.locator('.qm-art-duck.is-3d').waitFor({ timeout: 20000 });
  // A missing model must leave the selected card and static portrait in sync.
  await page.route('**/models/duck_mallard.glb', (route) => route.abort());
  await page.locator('.qm-char[data-character=mallard]').click();
  await page.waitForFunction(() => !document.querySelector('.qm-art-duck')?.classList.contains('is-3d'));
  assert.equal(await page.locator('.qm-char[data-character=mallard]').getAttribute('aria-checked'), 'true');
  assert.match(await page.locator('.qm-art-duck img').getAttribute('src') ?? '', /mallard/);
  await page.locator('.qm-char[data-character=classic]').click();
  await page.locator('.qm-art-duck.is-3d').waitFor();
  await page.unroute('**/models/duck_mallard.glb');
  await page.locator('.qm-char[data-character=mallard]').click();
  await page.locator('.qm-art-duck.is-3d').waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${out}/desktop-turkish.png`, fullPage: true, animations: 'disabled' });
  await page.locator('.qm-language').selectOption('en');
  await page.locator('#qm-tab-play', { hasText: 'Play' }).waitFor();
  await page.reload();
  await page.locator('#qm-tab-play', { hasText: 'Play' }).waitFor();
  assert.equal(await page.locator('.qm-char[data-character=mallard]').getAttribute('aria-checked'), 'true');
  await page.locator('.qm-language').selectOption('tr');
  await page.locator('#qm-tab-play', { hasText: 'Oyna' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.querySelector('#menu')!.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: `${out}/phone-turkish.png`, fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#qm-name').fill('TurkishDuck');
  await page.locator('[data-mode=dm]').click();
  await page.locator('#status', { hasText: 'Oynamak için tıkla' }).waitFor({ timeout: 60000 });
  await page.locator('#overlay').click();
  await page.locator('.ghud-wname', { hasText: 'Tüfek' }).waitFor({ timeout: 20000 });
  await page.waitForFunction(() => {
    const snapshot = (window as unknown as { __qwakk?: { snapshot(): { myCharacter: number; localMotion: { frames: number } } } }).__qwakk?.snapshot();
    return snapshot?.myCharacter === 1 && snapshot.localMotion.frames > 90;
  }, null, { timeout: 15000 });
  await page.screenshot({ path: `${out}/game-turkish.png` });
  assert.deepEqual(errors, []);
  console.log('localization e2e: browser language, language switch/reload, character persistence, failed model portrait/retry, mobile layout and Turkish game HUD passed');
} finally {
  await browser.close();
  for (const proc of procs) if (proc.exitCode === null) proc.kill('SIGINT');
}
