/**
 * Screenshots of a real firefight in headless Chrome, for visual review.
 * Starts the server (bots on) and `vite preview` (build the test bundle first: npm run build:test), plays with
 * the `autopilot=fight` dev tool, and saves frames right after the local
 * player's tracers, hit markers and feather bursts.
 *
 * Usage: npm run shots -- /path/to/output/dir [seconds]
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? `${root}/shots`;
const seconds = Number(process.argv[3] ?? 40);
mkdirSync(out, { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], { cwd: root, stdio: 'ignore', env: { ...process.env, PORT: '2567' } });
  const web = spawn(process.execPath, [`${root}/node_modules/vite/bin/vite.js`, 'preview', '--outDir', 'dist-test', '--port', '5173', '--strictPort'], { cwd: `${root}/apps/client`, stdio: 'ignore' });
  try {
    await sleep(2500);
    const browser = await chromium.launch({ channel: process.env.E2E_BROWSER === 'chromium' ? undefined : 'chrome', headless: true });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await page.goto('http://localhost:5173/game/?autopilot=fight&hud=0');
    await page.waitForFunction(() => (window as any).__qwakk?.snapshot().players >= 2, null, { timeout: 30000 });
    await sleep(3000);
    const saved: string[] = [];
    let lastShotAt = 0;
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end && saved.length < 8) {
      await sleep(60);
      const c = await page.evaluate(() => (window as any).__qwakk.snapshot().combat);
      const marker = c.now - c.lastMarkerAt < 90;
      const feathers = c.now - c.lastFeatherAt < 250;
      const tracer = c.now - c.lastTracerAt < 60;
      if ((marker || (feathers && tracer)) && Date.now() - lastShotAt > 1500) {
        const file = `${out}/firefight-${saved.length + 1}${marker ? '-marker' : ''}.png`;
        await page.screenshot({ path: file });
        saved.push(file);
        lastShotAt = Date.now();
      }
    }
    const s = await page.evaluate(() => (window as any).__qwakk.snapshot());
    console.log(JSON.stringify({ saved, combat: s.combat, totalKills: s.kills, backend: s.backend }, null, 2));
    await browser.close();
  } finally {
    server.kill('SIGINT');
    web.kill('SIGINT');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
