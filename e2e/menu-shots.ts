/**
 * Screenshots of the main menu at the sizes people open it at: desktop
 * 1440 x 900, tablet 1024 x 768, phone portrait 390 x 844 and phone landscape
 * 844 x 390 (the phones and the tablet with touch and a coarse pointer). Runs
 * the real server and `vite preview` of the test bundle (npm run build:test
 * first) with one battle royale room open, so the live list has a row.
 *
 * Checks along the way: no sideways scroll at any size, every button and
 * field on the Play tab is at least 44 px tall on touch screens, and Play is
 * on. Saves `<size>-<tab>.png` (the viewport) and `<size>-play-scrollN.png`
 * (the Play tab paged down) to OUTDIR. Usage: npm run shots:menu [-- OUTDIR]
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, type Room } from '@colyseus/sdk';
import { chromium, type BrowserContextOptions, type Page } from 'playwright';
import { seedBrowser } from './lib/accounts.ts';
import { BR } from '@qwakk/shared';
import { IslandState } from '@qwakk/shared/net';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? join(tmpdir(), 'qwakk-shots-menu');
mkdirSync(out, { recursive: true });
// The menu's API calls go to port 2567 in test builds (net/endpoint.ts), so the server runs there.
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 2567);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5173);
const server_ = `ws://localhost:${SERVER_PORT}`;

const SIZES: { name: string; opts: BrowserContextOptions }[] = [
  { name: 'desktop-1440x900', opts: { viewport: { width: 1440, height: 900 } } },
  { name: 'tablet-1024x768', opts: { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  { name: 'phone-portrait-390x844', opts: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  { name: 'phone-landscape-844x390', opts: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function run(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}): ChildProcess {
  return spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function waitForOutput(proc: ChildProcess, needle: string, timeoutMs = 30000): Promise<void> {
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

/** Controls on the Play tab shorter than 44 px (touch screens only). */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('#qm-panel-play button, #qm-panel-play input, .qm-tabs button')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || el.closest('[hidden]')) continue;
      if (r.height < 43.5) bad.push(`${el.className || el.tagName} "${(el.textContent ?? '').trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return bad;
  });
}

async function main(): Promise<void> {
  if (!existsSync(`${root}/apps/client/dist-test/index.html`)) throw new Error('Build the test client first: npm run build:test');
  const server = run(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], root, {
    PORT: String(SERVER_PORT),
    QWAKK_BOTS: '0',
    QWAKK_BR_MIN_HUMANS: '3',
    QWAKK_BR_SEED: '7',
  });
  const web = run(process.execPath, [`${root}/node_modules/vite/bin/vite.js`, 'preview', '--outDir', process.env.E2E_DIST ?? 'dist-test', '--port', String(WEB_PORT), '--strictPort'], `${root}/apps/client`);
  const procs = [server, web];
  const cleanup = () => procs.forEach((p) => p.exitCode === null && p.kill('SIGINT'));
  process.on('exit', cleanup);
  const rooms: Room[] = [];
  const problems: string[] = [];
  try {
    await Promise.all([waitForOutput(server, 'server listening'), waitForOutput(web, String(WEB_PORT))]);
    const b = await new Client(server_).create<IslandState>(BR.roomName, { name: 'NodeB', team: 2 }, IslandState);
    b.onMessage('*', () => {});
    rooms.push(b);
    const browser = await chromium.launch({
      ...((process.env.E2E_BROWSER ?? 'chrome') === 'chrome' ? { channel: 'chrome' } : {}),
      headless: true,
      args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
    });
    for (const size of SIZES) {
      const ctx = await browser.newContext({ ...size.opts, locale: 'en-US' });
      await seedBrowser(ctx, { guest: true }); // the guest menu: name, look and Play steps
      const page = await ctx.newPage();
      page.on('pageerror', (e) => problems.push(`[${size.name}] page error: ${e.message}`));
      // 503: the leaderboard without a database (the meta API says it is unavailable; the tab shows that).
      page.on('console', (m) => m.type() === 'error' && !/404|503/.test(m.text()) && problems.push(`[${size.name}] console: ${m.text()}`));
      await page.goto(`http://localhost:${WEB_PORT}/game/?lang=en&hud=0&menu=1`);
      await page.locator(`.qm-room[data-room="${b.roomId}"]`).waitFor({ timeout: 20000 });
      // The 3D duck fades in after the menu paints; keep the image if it does not come.
      await page.locator('.qm-art-duck.is-3d').waitFor({ timeout: 15000 }).catch(() => console.log(`[${size.name}] no 3D duck, image shown`));
      await sleep(1200);
      const vw = size.opts.viewport!.width;
      const scrollW = await page.evaluate(() => document.querySelector('#menu')!.scrollWidth);
      if (scrollW > vw + 1) problems.push(`[${size.name}] the menu scrolls sideways (${scrollW}px)`);
      if (await page.locator('.qm-btn-play').isDisabled()) problems.push(`[${size.name}] Play is off`);
      if (size.opts.hasTouch) for (const s of await smallTargets(page)) problems.push(`[${size.name}] small touch target: ${s}`);
      await page.screenshot({ path: `${out}/${size.name}-play.png` });
      // Pick the other duck: the card, the stage (2D image and the 3D model) and the saved pick follow.
      const pick = page.locator('.qm-char[data-character="mallard"]');
      await pick.scrollIntoViewIfNeeded();
      await pick.click();
      await page.evaluate(() => document.querySelector('#menu')!.scrollTo(0, 0));
      await sleep(2500);
      const picked = await page.evaluate(() => ({
        checked: document.querySelector('.qm-char[data-character="mallard"]')?.getAttribute('aria-checked'),
        saved: localStorage.getItem('qwakk.character'),
        image: document.querySelector<HTMLImageElement>('.qm-art-duck img')?.getAttribute('src') ?? '',
        plate: document.querySelector('.qm-plate-char')?.textContent ?? '',
      }));
      if (picked.checked !== 'true' || picked.saved !== 'mallard' || !picked.image.includes('mallard')) problems.push(`[${size.name}] picking the mallard did not stick: ${JSON.stringify(picked)}`);
      await page.screenshot({ path: `${out}/${size.name}-play-mallard.png` });
      if (size.name.startsWith('desktop')) {
        // The pick survives a reload (localStorage).
        await page.reload();
        await page.locator('.qm-char[data-character="mallard"][aria-checked="true"]').waitFor({ timeout: 10000 });
      }
      await page.locator('.qm-char[data-character="classic"]').click();
      await sleep(400);
      // The menu scrolls inside #menu (a fixed layer), so page down through it.
      for (let i = 1; i <= 4; i++) {
        const moved = await page.evaluate(() => {
          const m = document.querySelector('#menu')!;
          const before = m.scrollTop;
          m.scrollTop += Math.round(innerHeight * 0.8);
          return m.scrollTop !== before;
        });
        if (!moved) break;
        await sleep(250);
        await page.screenshot({ path: `${out}/${size.name}-play-scroll${i}.png` });
      }
      await page.evaluate(() => document.querySelector('#menu')!.scrollTo(0, 0));
      for (const tab of ['leaderboard', 'settings', 'howto']) {
        await page.locator(`#qm-tab-${tab}`).click();
        await sleep(500);
        await page.screenshot({ path: `${out}/${size.name}-${tab}.png` });
      }
      await page.locator('#qm-tab-play').click();
      if (size.name.startsWith('desktop')) {
        // A party: the code, the member list and the leader's hint.
        await page.locator('.qm-party button', { hasText: 'Create party' }).click();
        await page.locator('.qm-party-codetext').waitFor({ timeout: 20000 });
        await sleep(600);
        await page.screenshot({ path: `${out}/${size.name}-party.png` });
      }
      console.log(`${size.name}: ok (scroll width ${scrollW})`);
      await ctx.close();
    }
    await browser.close();
    if (problems.length) {
      for (const p of problems) console.error(p);
      throw new Error(`${problems.length} problem(s)`);
    }
    console.log(`menu shots in ${out}`);
  } finally {
    for (const r of rooms) await r.leave().catch(() => {});
    cleanup();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
