/**
 * Screenshots of a real firefight in headless Chrome, for visual review.
 * Starts the server (bots on) and `vite preview` (build the test bundle first: npm run build:test), plays with
 * the `autopilot=fight` dev tool, and saves frames right after the local
 * player's tracers, hit markers and feather bursts. Then gun handling: hip
 * fire vs aim down sights from the player's camera and the reload at its
 * magazine moments (rifle and pistol), in a quiet room with a second player
 * who watches from the front (`*-seen.png`).
 *
 * Usage: npm run shots -- /path/to/output/dir [seconds]
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { Button } from '@qwakk/shared';

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
    await browser.close();
    server.kill('SIGINT');
    await sleep(1500);
    // Gun handling in a quiet room: a battle royale warm-up (open village square, damage off, no bots).
    // Duck A aims and reloads, duck B watches it from the front.
    quiet = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], { cwd: root, stdio: 'ignore', env: { ...process.env, PORT: '2567', QWAKK_BOTS: '0', QWAKK_BR_WARMUP: '900' } });
    await sleep(2500);
    const handling = await gunHandling(out);
    console.log(JSON.stringify({ saved, handling, combat: s.combat, totalKills: s.kills, backend: s.backend }, null, 2));
  } finally {
    server.kill('SIGINT');
    quiet?.kill('SIGINT');
    web.kill('SIGINT');
  }
}

let quiet: ReturnType<typeof spawn> | null = null;

const hook = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__qwakk[f as string](...(a as unknown[])), [fn, args] as const);

async function me(page: Page): Promise<{ x: number; z: number; alive: number; grounded: number }> {
  return (await hook(page, 'snapshot')).me;
}

/**
 * Hip vs aim down sights from A's camera, then A's reload at its magazine
 * moments (rifle and pistol), each also seen from B, who stands in front of A.
 */
async function gunHandling(out: string): Promise<Record<string, unknown>[]> {
  const browser = await chromium.launch({ channel: process.env.E2E_BROWSER === 'chromium' ? undefined : 'chrome', headless: true });
  const open = async () => {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await page.goto('http://localhost:5173/game/?mode=br&autopilot=fight&hud=0');
    await page.waitForFunction(() => (window as any).__qwakk?.snapshot().me?.grounded === 1, null, { timeout: 30000 });
    await hook(page, 'face', 0, 0, 120000, -0.05);
    return page;
  };
  const a = await open();
  const b = await open();
  await sleep(1500);
  // A walks up to B (facing it), then both face each other about 5 m apart.
  for (let i = 0; i < 60; i++) {
    const pa = await me(a);
    const pb = await me(b);
    const d = Math.hypot(pa.x - pb.x, pa.z - pb.z);
    await hook(a, 'face', pb.x, pb.z, 120000, -0.05);
    if (d < 5) break;
    // Both walk toward each other.
    await hook(b, 'face', pa.x, pa.z, 120000, -0.05);
    await hook(a, 'press', 0, 250, 1);
    await hook(b, 'press', 0, 250, 1);
    await sleep(250);
  }
  await sleep(400);
  const pa = await me(a);
  const pb = await me(b);
  // A looks past B's side, turning its right flank (where the reload happens) toward B. B aims down
  // sights with A right of the crosshair, clear of B's own duck.
  const dx = pb.x - pa.x;
  const dz = pb.z - pa.z;
  const aLook = { x: pb.x + dx * 3 - dz * 2.5, z: pb.z + dz * 3 + dx * 2.5 };
  await hook(a, 'face', aLook.x, aLook.z, 120000, -0.12);
  await hook(b, 'face', pa.x - dz * 0.25, pa.z + dx * 0.25, 120000, -0.2);
  await hook(b, 'press', Button.Aim, 120000);
  const notes: Record<string, unknown>[] = [{ apart: Number(Math.hypot(pa.x - pb.x, pa.z - pb.z).toFixed(2)) }];
  const shot = async (name: string) => {
    const p = await hook(a, 'avatarProbe');
    await a.screenshot({ path: `${out}/${name}.png` });
    await b.screenshot({ path: `${out}/${name}-seen.png` });
    notes.push({ name, mag: p.magState, aim: p.aim, cameraAim: Number(p.cameraAim.toFixed(2)), reload: p.reload, rounds: p.mag });
  };
  for (const [weapon, slot, moments] of [
    ['rifle', Button.Slot1, [0.2, 0.55, 1.0, 1.3, 1.75, 2.4]],
    ['pistol', Button.Slot2, [0.05, 0.3, 0.6, 0.95, 1.7]],
  ] as const) {
    await hook(a, 'press', slot, 120);
    await sleep(900);
    await shot(`${weapon}-hip`);
    await hook(a, 'press', Button.Aim, 1300);
    await sleep(700);
    await shot(`${weapon}-ads`);
    await sleep(800);
    // One shot into the ground in front of A so the magazine is not full, then the reload.
    await hook(a, 'face', aLook.x, aLook.z, 120000, -0.6);
    await sleep(100);
    await hook(a, 'press', Button.Fire, 70);
    await sleep(300);
    await hook(a, 'face', aLook.x, aLook.z, 120000, -0.12);
    await hook(a, 'press', Button.Reload, 70);
    const t0 = Date.now();
    for (const t of moments) {
      await sleep(Math.max(0, t * 1000 - (Date.now() - t0)));
      await shot(`${weapon}-reload-${t.toFixed(2)}s`);
    }
  }
  await browser.close();
  return notes;
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
