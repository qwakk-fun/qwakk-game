/**
 * Touch controls end to end on an emulated phone: headless Chrome in
 * landscape (844 x 390, device scale 3, isMobile, hasTouch, coarse pointer),
 * the real server and `vite preview` of the test bundle (npm run build:test
 * first). Fingers are real touch events (DevTools Input.dispatchTouchEvent),
 * which the page sees as touch pointer events, several at once.
 *
 *   Menu: signed in (battle royale needs an account; a throwaway database),
 *   the phone taps Play on the character select; Play is on for a phone, the
 *   menu fits landscape and portrait.
 *   Deathmatch from the menu, tap to play: the stick moves the duck (the
 *   server's position changes), a drag on the right turns it (the server's
 *   yaw follows), Fire shoots (the server's magazine drops) while the stick
 *   and a look drag are held, Reload reloads. Portrait shows the rotate
 *   screen. Pause, leave, then a battle royale from the menu: the Jump out
 *   button leaves the plane (the server's mode goes to freefall) and Glide
 *   opens the glider.
 *
 * Saves screenshots to OUTDIR. Usage: npm run e2e:mobile [-- OUTDIR]
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type CDPSession, type Page } from 'playwright';
import { Mode } from '@qwakk/shared';
import { accountSeed, e2eDatabase, seedBrowser, signUpApi } from './lib/accounts.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? join(tmpdir(), 'qwakk-shots-mobile');
mkdirSync(out, { recursive: true });
// The menu's API calls go to port 2567 in test builds (net/endpoint.ts), so the server runs there.
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 2567);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5173);
const W = 844;
const H = 390;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Snap = any;
const snap = (p: Page): Promise<Snap> => p.evaluate(() => (window as any).__qwakk?.snapshot() ?? null);

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

async function until<T>(label: string, get: () => Promise<T>, test: (v: T) => boolean, timeoutMs = 30000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await get();
    if (test(v)) return v;
    if (Date.now() > end) throw new Error(`timeout: ${label} (${JSON.stringify(v)?.slice(0, 600)})`);
    await sleep(150);
  }
}

/**
 * Real touch input through DevTools: every event lists all fingers still
 * down, as a touch screen reports them. A finger lifts with a move event
 * that leaves it out (the last one with touchEnd).
 */
class Fingers {
  private readonly pts = new Map<number, { x: number; y: number }>();
  private readonly cdp: CDPSession;
  constructor(cdp: CDPSession) {
    this.cdp = cdp;
  }
  private async send(type: 'touchStart' | 'touchMove' | 'touchEnd'): Promise<void> {
    const touchPoints = [...this.pts].map(([id, p]) => ({ id, x: p.x, y: p.y, radiusX: 6, radiusY: 6, force: 1 }));
    await this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  }
  async down(id: number, x: number, y: number): Promise<void> {
    this.pts.set(id, { x, y });
    await this.send('touchStart');
  }
  async move(id: number, x: number, y: number): Promise<void> {
    this.pts.set(id, { x, y });
    await this.send('touchMove');
  }
  /** Drag in small steps, like a thumb. */
  async drag(id: number, dx: number, dy: number, steps = 10, stepMs = 16): Promise<void> {
    const p = this.pts.get(id)!;
    const x0 = p.x;
    const y0 = p.y;
    for (let i = 1; i <= steps; i++) {
      await this.move(id, x0 + (dx * i) / steps, y0 + (dy * i) / steps);
      await sleep(stepMs);
    }
  }
  async up(id: number): Promise<void> {
    this.pts.delete(id);
    await this.send(this.pts.size === 0 ? 'touchEnd' : 'touchMove');
  }
  async tap(x: number, y: number, holdMs = 60): Promise<void> {
    const id = 90 + Math.floor(Math.random() * 9);
    await this.down(id, x, y);
    await sleep(holdMs);
    await this.up(id);
  }
}

async function center(p: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await p.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} is not on screen`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const visible = (p: Page, selector: string): Promise<boolean> => p.locator(selector).isVisible();

/** No two of these boxes overlap (the touch HUD must not cover itself or the crosshair). */
async function overlaps(p: Page, selectors: string[]): Promise<string[]> {
  return p.evaluate((sels) => {
    const boxes: { s: string; r: DOMRect }[] = [];
    for (const s of sels) {
      for (const el of document.querySelectorAll(s)) {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') boxes.push({ s, r });
      }
    }
    const bad: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!.r;
        const b = boxes[j]!.r;
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) bad.push(`${boxes[i]!.s} x ${boxes[j]!.s}`);
      }
    }
    return bad;
  }, selectors);
}

const HUD_PARTS = ['.tc-btn:not([hidden])', '.ghud-hp', '.ghud-ammo', '.team-panel:not([hidden])', '.br-topright', '.br-compass', '.ghud-top'];

async function main(): Promise<void> {
  if (!existsSync(`${root}/apps/client/dist-test/index.html`)) throw new Error('Build the test client first: npm run build:test');
  const db = await e2eDatabase('mobile');
  const server = run(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], root, {
    PORT: String(SERVER_PORT),
    DATABASE_URL: db.url,
    QWAKK_TEST_HOOKS: '1',
    QWAKK_BOTS: '0',
    QWAKK_DM_SPAWN_RADIUS: '21',
    QWAKK_BR_MIN_HUMANS: '1',
    QWAKK_BR_COUNTDOWN: '4',
    QWAKK_BR_SEED: '7',
  });
  const web = run(process.execPath, [`${root}/node_modules/vite/bin/vite.js`, 'preview', '--outDir', process.env.E2E_DIST ?? 'dist-test', '--port', String(WEB_PORT), '--strictPort'], `${root}/apps/client`);
  const procs = [server, web];
  const cleanup = () => procs.forEach((p) => p.exitCode === null && p.kill('SIGINT'));
  process.on('exit', cleanup);
  try {
    await Promise.all([waitForOutput(server, 'server listening'), waitForOutput(web, String(WEB_PORT))]);
    const useChrome = (process.env.E2E_BROWSER ?? 'chrome') === 'chrome';
    const browser = await chromium.launch({ ...(useChrome ? { channel: 'chrome' } : {}), headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] });
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: W, height: H }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await seedBrowser(ctx, accountSeed(await signUpApi(`http://localhost:${SERVER_PORT}`, 'e2e.phone@example.com', [['TouchDuck', 0]])));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[phone] page error:', e.message));
    page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.error('[phone] console:', m.text()));
    const cdp = await ctx.newCDPSession(page);
    const f = new Fingers(cdp);

    // Menu: a phone can play.
    await page.goto(`http://localhost:${WEB_PORT}/game/?lang=en&hud=0&menu=1`);
    await page.locator('.qd-play:not([disabled])').tap({ timeout: 30000 });
    await page.locator('#menu[data-screen="main"]').waitFor();
    await sleep(1500); // the menu's entrance animation
    const coarse = await page.evaluate(() => ({ coarse: matchMedia('(pointer: coarse)').matches, fine: matchMedia('(any-pointer: fine)').matches, touch: navigator.maxTouchPoints }));
    console.log(`phone: ${JSON.stringify(coarse)}`);
    if (!coarse.coarse || coarse.fine) throw new Error('the emulated phone does not report a coarse pointer only');
    if (await page.locator('.qm-btn-play').isDisabled()) throw new Error('Play is off on a phone');
    if (!(await visible(page, '.qm-mobile'))) throw new Error('no phone note in the menu');
    await page.screenshot({ path: `${out}/1-menu-landscape.png` });
    const scrollW = await page.evaluate(() => document.querySelector('#menu')!.scrollWidth);
    if (scrollW > W + 1) throw new Error(`the menu scrolls sideways in landscape (${scrollW}px)`);
    await page.setViewportSize({ width: H, height: W });
    await sleep(300);
    await page.screenshot({ path: `${out}/2-menu-portrait.png` });
    const scrollWp = await page.evaluate(() => document.querySelector('#menu')!.scrollWidth);
    if (scrollWp > H + 1) throw new Error(`the menu scrolls sideways in portrait (${scrollWp}px)`);
    await page.setViewportSize({ width: W, height: H });
    await sleep(300);
    await page.locator('#qm-tab-howto').tap();
    await sleep(500);
    await page.screenshot({ path: `${out}/2b-menu-howto-touch.png`, fullPage: true });
    await page.locator('#qm-tab-play').tap();
    await sleep(300);

    // Deathmatch from the menu, then tap to play.
    await page.locator('.qm-btn[data-mode="dm"]').tap();
    await until('in the deathmatch', () => snap(page), (s) => s?.mode === 0 && s.players >= 1 && s.server?.alive === 1, 60000);
    await until('tap to play card', () => page.locator('#status').innerText(), (t) => t.includes('Tap to play'), 10000);
    await page.screenshot({ path: `${out}/3-dm-tap-to-play.png` });
    const card = await center(page, '#overlay .card');
    await f.tap(card.x, card.y);
    await until('touch controls on', () => page.evaluate(() => document.body.classList.contains('touch-ui') && !document.querySelector('.tc')!.hasAttribute('hidden')), (v) => v, 5000);
    if (await visible(page, '#overlay')) throw new Error('the pause card stayed up after the tap');
    await sleep(2500); // spawn protection and the first patches

    // Move: stick forward for 2 s, the server's position changes.
    const s0 = await snap(page);
    await f.down(1, 160, 290);
    await f.drag(1, 0, -70, 8);
    await sleep(2000);
    await page.screenshot({ path: `${out}/4-dm-touch-hud-moving.png` });
    const s1 = await snap(page);
    await f.up(1);
    const moved = Math.hypot(s1.server.x - s0.server.x, s1.server.z - s0.server.z);
    console.log(`stick: the server moved the duck ${moved.toFixed(2)} m in 2 s`);
    if (moved < 4) throw new Error('the stick did not move the duck on the server');

    // Turn: a drag on the right side.
    await sleep(300);
    const t0 = await snap(page);
    await f.down(2, 560, 200);
    await f.drag(2, 120, 0, 12);
    await f.up(2);
    await sleep(500);
    const t1 = await snap(page);
    const turned = Math.atan2(Math.sin(t0.controls.yaw - t1.controls.yaw), Math.cos(t0.controls.yaw - t1.controls.yaw));
    const serverYawGap = Math.abs(Math.atan2(Math.sin(t1.server.yaw - t1.controls.yaw), Math.cos(t1.server.yaw - t1.controls.yaw)));
    console.log(`look: turned ${turned.toFixed(3)} rad right, server yaw within ${serverYawGap.toFixed(3)} rad`);
    if (turned < 0.3) throw new Error('a right-side drag did not turn the camera');
    if (serverYawGap > 0.05) throw new Error('the server yaw did not follow the drag');

    // Everything at once: stick held, a look drag and Fire held. The server's magazine drops.
    const fire = await center(page, '.tc-fire:not(.tc-fire-l)');
    const m0 = await snap(page);
    const mag0 = m0.server.weapon === 0 ? m0.server.mag0 : m0.server.mag1;
    await f.down(3, 160, 290);
    await f.move(3, 210, 290); // strafe right
    await f.down(4, fire.x, fire.y);
    await f.down(5, 520, 250);
    await f.drag(5, -60, 0, 10, 30);
    await sleep(900);
    const m1 = await snap(page);
    await page.screenshot({ path: `${out}/5-dm-fire-move-look.png` });
    await f.up(5);
    await f.up(4);
    await f.up(3);
    const mag1 = m1.server.weapon === 0 ? m1.server.mag0 : m1.server.mag1;
    const strafed = Math.hypot(m1.server.x - m0.server.x, m1.server.z - m0.server.z);
    const turnedLeft = Math.atan2(Math.sin(m1.controls.yaw - m0.controls.yaw), Math.cos(m1.controls.yaw - m0.controls.yaw));
    console.log(`multi-touch: magazine ${mag0} -> ${mag1} on the server, moved ${strafed.toFixed(2)} m, turned ${turnedLeft.toFixed(3)} rad, ${m1.combat.shotsFired - m0.combat.shotsFired} shots shown`);
    if (!(mag1 < mag0)) throw new Error('Fire did not shoot (server magazine unchanged)');
    if (strafed < 1) throw new Error('the stick stopped working while firing');
    if (turnedLeft < 0.1) throw new Error('look stopped working while firing');

    // Reload: the server reloads (a reload timer runs or the magazine refills).
    await sleep(400);
    const reload = await center(page, '.tc-reload');
    await f.tap(reload.x, reload.y);
    const r = await until('server reload', () => snap(page), (s) => s.server.reload > 0 || (s.server.weapon === 0 ? s.server.mag0 : s.server.mag1) > mag1, 3000);
    console.log(`reload: server reload timer ${r.server.reload}`);
    const bad = await overlaps(page, HUD_PARTS);
    if (bad.length) throw new Error(`deathmatch touch HUD overlaps: ${bad.join(', ')}`);
    await sleep(1500);
    await page.screenshot({ path: `${out}/6-dm-touch-hud.png` });

    // Portrait: the rotate screen.
    await page.setViewportSize({ width: H, height: W });
    await sleep(400);
    if (!(await visible(page, '#rotate'))) throw new Error('no rotate screen in portrait');
    await page.screenshot({ path: `${out}/7-portrait-rotate.png` });
    await page.setViewportSize({ width: W, height: H });
    await sleep(400);
    if (await visible(page, '#rotate')) throw new Error('the rotate screen stayed in landscape');

    // Pause and leave, back to the menu.
    const pause = await center(page, '.tc-pause');
    await f.tap(pause.x, pause.y);
    await until('pause card', () => visible(page, '#leave'), (v) => v, 3000);
    await sleep(600);
    if (!(await visible(page, '#leave'))) throw new Error('the pause tap fell through and closed the pause card');
    await page.screenshot({ path: `${out}/8-paused.png` });
    const leave = await center(page, '#leave');
    await f.tap(leave.x, leave.y);
    await until('menu again', () => visible(page, '#menu'), (v) => v, 10000);
    if (await page.evaluate(() => document.body.classList.contains('touch-game'))) throw new Error('the menu kept the touch game state');

    // Battle royale from the menu: jump out and glide with the touch buttons.
    await page.locator('.qm-btn-play').tap();
    await until('in a battle royale', () => snap(page), (s) => s?.mode === 1 && s.players >= 1, 60000);
    await until('tap to play card', () => page.locator('#status').innerText(), (t) => t.includes('Tap to play'), 10000);
    const card2 = await center(page, '#overlay .card');
    await f.tap(card2.x, card2.y);
    await until('touch controls on', () => page.evaluate(() => !document.querySelector('.tc')!.hasAttribute('hidden')), (v) => v, 5000);
    await sleep(800);
    await page.screenshot({ path: `${out}/9-br-waiting-room.png` });
    const badBr = await overlaps(page, [...HUD_PARTS, '.br-lobby:not([hidden])', '.br-banner:not([hidden])']);
    if (badBr.length) throw new Error(`battle royale waiting room HUD overlaps: ${badBr.join(', ')}`);
    await until('aboard the plane', () => snap(page), (s) => s.server?.mode === Mode.Plane && s.phase !== 2, 60000);
    await until('Jump out button', () => visible(page, '.tc-deploy'), (v) => v, 90000);
    await page.screenshot({ path: `${out}/10-br-plane.png` });
    const deploy = await center(page, '.tc-deploy');
    await f.tap(deploy.x, deploy.y);
    await until('freefall on the server', () => snap(page), (s) => s.server.mode === Mode.Freefall, 5000);
    console.log('battle royale: jumped out with the touch button');
    await sleep(600);
    await page.screenshot({ path: `${out}/11-br-freefall.png` });
    await until('Glide button', () => visible(page, '.tc-deploy'), (v) => v, 5000);
    await sleep(300);
    const glide = await center(page, '.tc-deploy');
    await f.tap(glide.x, glide.y);
    await until('gliding on the server', () => snap(page), (s) => s.server.mode === Mode.Glide, 5000);
    console.log('battle royale: opened the glider with the touch button');
    // Steer down with the stick and land.
    await f.down(6, 160, 290);
    await f.drag(6, 0, -60, 6);
    await until('landed', () => snap(page), (s) => s.server.mode === Mode.Ground, 90000);
    await f.up(6);
    await sleep(1500);
    await page.screenshot({ path: `${out}/12-br-on-foot.png` });
    const badFoot = await overlaps(page, HUD_PARTS);
    if (badFoot.length) throw new Error(`battle royale touch HUD overlaps: ${badFoot.join(', ')}`);
    // The map opens and closes by touch.
    const map = await center(page, '.tc-map');
    await f.tap(map.x, map.y);
    await until('map open', () => visible(page, '.br-map'), (v) => v, 3000);
    await page.screenshot({ path: `${out}/13-br-map.png` });
    await sleep(500);
    await f.tap(W / 2, H / 2);
    await until('map closed', () => visible(page, '.br-map'), (v) => !v, 3000);
    // The inventory screen by touch, closed with its button.
    await until('Bag button', () => visible(page, '.tc-bag'), (v) => v, 3000);
    const bag = await center(page, '.tc-bag');
    await f.tap(bag.x, bag.y);
    await until('inventory open', () => visible(page, '.br-invscreen'), (v) => v, 3000);
    await page.screenshot({ path: `${out}/14-br-inventory.png` });
    await sleep(500); // the tap that opened it does not close it (TOUCH.clickGuardMs)
    const close = await center(page, '.br-inv-close');
    await f.tap(close.x, close.y);
    await until('inventory closed', () => visible(page, '.br-invscreen'), (v) => !v, 3000);
    console.log(`mobile touch e2e passed; screenshots in ${out}`);
    await ctx.close();
    await browser.close();
  } finally {
    cleanup();
    await sleep(300);
    await db.drop().catch(() => {});
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
