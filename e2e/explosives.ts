/**
 * Deathmatch explosives in the real game, for visual review: two browser
 * ducks on the deathmatch map, an in-process server (test-only auth, no bots).
 * Duck A holds G (the throw arc preview), lets go (a grenade lands by duck B
 * and explodes), then gets the rocket launcher (set on the server, as the
 * pickup would) and fires a rocket past B. Frames from both ducks go to the
 * output directory; it fails when the blasts or the projectiles never show.
 *
 * Usage: npm run build:test && node e2e/explosives.ts /path/to/output/dir
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { Server, matchMaker, type Client as ServerClient } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { BULLET_QUERY_GROUPS, Button, EXPLOSIVE, groundHeightAt, MATCH, ROOM, setRockets } from '@qwakk/shared';
import { IslandRoom } from '../apps/server/src/IslandRoom.ts';
import type { JoinAuth } from '../apps/server/src/gameRoom.ts';
import { throwPitch } from '../apps/server/src/dmBotExplosives.ts';

class TestRoom extends IslandRoom {
  override async onAuth(_client: ServerClient, options: { name?: string } = {}): Promise<JoinAuth> {
    return { playerId: null, name: options.name ?? 'Duck', tag: '1234', signed: false };
  }
}

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? '/tmp/qwakk-explosives';
mkdirSync(out, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const http = createServer();
const server = new Server({ gracefullyShutdown: false, transport: new WebSocketTransport({ server: http }) });
server.define(ROOM.name, TestRoom, { bots: false, mapId: process.env.QWAKK_DM_MAP ?? MATCH.mapId });
await server.listen(0);
const roomInfo = await matchMaker.createRoom(ROOM.name, {});
const room = matchMaker.getLocalRoomById(roomInfo.roomId) as TestRoom;
const endpoint = `ws://localhost:${(http.address() as AddressInfo).port}`;
const webPort = Number(process.env.E2E_WEB_PORT ?? 5191);
const web = spawn(process.execPath, [`${root}/node_modules/vite/bin/vite.js`, 'preview', '--outDir', 'dist-test', '--port', String(webPort), '--strictPort'], { cwd: `${root}/apps/client`, stdio: ['ignore', 'pipe', 'pipe'] });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER === 'chromium' ? undefined : 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] });
const errors: string[] = [];

async function open(name: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) errors.push(`${name}: ${m.text()}`);
  });
  await page.goto(`http://localhost:${webPort}/game/?server=${encodeURIComponent(endpoint)}&autopilot=1&name=${name}&hud=0`);
  return page;
}

const stats = (p: Page) => p.evaluate(() => (window as any).__qwakk.explosives());
const shot = async (p: Page, file: string) => {
  await p.screenshot({ path: `${out}/${file}` });
  return `${out}/${file}`;
};

/** A spot on the map with a long clear, flat line of fire: A there, B down the line. */
function pickSpots(): { a: [number, number, number]; b: [number, number, number]; yaw: number } {
  const sim = room.dm.world;
  const pts = sim.map.arenaSpawns.length ? sim.map.arenaSpawns : sim.map.spawns;
  for (const p of pts) {
    const y = groundHeightAt(sim, p[0], p[1] + 0.3, p[2]);
    for (let k = 0; k < 24; k++) {
      const yaw = (k / 24) * Math.PI * 2;
      const dx = -Math.sin(yaw);
      const dz = -Math.cos(yaw);
      let ok = true;
      for (const h of [0.5, 1.4]) {
        const hit = sim.world.castRay(new sim.rapier.Ray({ x: p[0], y: y + h, z: p[2] }, { x: dx, y: 0, z: dz }), 32, true, undefined, BULLET_QUERY_GROUPS);
        if (hit) ok = false;
      }
      if (!ok) continue;
      const bx = p[0] + dx * 13;
      const bz = p[2] + dz * 13;
      const by = groundHeightAt(sim, bx, y + 2, bz);
      if (Math.abs(by - y) > 0.6) continue;
      return { a: [p[0], y, p[2]], b: [bx, by, bz], yaw };
    }
  }
  throw new Error('no open line of fire found on this map');
}

const saved: string[] = [];
try {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('vite startup timeout')), 15000);
    web.stdout!.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes(String(webPort))) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  const A = await open('Alpha');
  const B = await open('Beta');
  for (const p of [A, B]) await p.waitForFunction(() => (window as any).__qwakk?.snapshot().players === 2, null, { timeout: 60000 });
  for (const p of [A, B]) await p.evaluate(() => document.getElementById('overlay')?.classList.add('hidden'));
  const idA = await A.evaluate(() => (window as any).__qwakk.snapshot().sessionId as string);
  const idB = await B.evaluate(() => (window as any).__qwakk.snapshot().sessionId as string);
  const sa = room.dm.seats.get(idA)!;
  const sb = room.dm.seats.get(idB)!;
  const spots = pickSpots();
  // Stop both autopilots first (they would walk the ducks off their spots).
  for (const p of [A, B]) await p.evaluate(() => (window as any).__qwakk.face(0, 0, 120000, 0));
  const put = () => {
    Object.assign(sa.sim, { x: spots.a[0], y: spots.a[1], z: spots.a[2], vx: 0, vy: 0, vz: 0 });
    Object.assign(sb.sim, { x: spots.b[0] + 1.2, y: spots.b[1], z: spots.b[2], vx: 0, vy: 0, vz: 0 });
    sa.protect = 0;
    sb.protect = 0;
    sb.sim.hp = 100;
  };
  put();
  await sleep(800);
  // The throw: aim the lob at B's feet.
  const dist = Math.hypot(spots.b[0] - spots.a[0], spots.b[2] - spots.a[2]);
  // Short of B (between the two ducks), so both see the blast in front of them; B is still inside its radius.
  const pitch = throwPitch(dist - 4.5, spots.b[1] - spots.a[1] - EXPLOSIVE.grenade.handUp) ?? 0.3;
  await A.evaluate(([x, z, p]) => (window as any).__qwakk.face(x, z, 60000, p), [spots.b[0], spots.b[2], pitch]);
  await B.evaluate(([x, z]) => (window as any).__qwakk.face(x, z, 60000, -0.05), [spots.a[0], spots.a[2]]);
  await sleep(600);
  const where = async () => ({
    server: { a: [sa.sim.x, sa.sim.y, sa.sim.z], b: [sb.sim.x, sb.sim.y, sb.sim.z] },
    clientA: await A.evaluate(() => (window as any).__qwakk.snapshot().me),
    clientB: await B.evaluate(() => (window as any).__qwakk.snapshot().me),
  });
  console.log('before throw', JSON.stringify(await where()));
  const before = await stats(A);
  await A.evaluate((b) => (window as any).__qwakk.press(b, 650), Button.Grenade);
  await sleep(350);
  const holding = await stats(A);
  saved.push(await shot(A, 'grenade-preview.png'));
  if (!holding.preview) throw new Error('no throw arc preview while G was held');
  // Wait for the blast on A's screen, then grab both views while the fireball is up.
  const end = Date.now() + 6000;
  let boomA = before.booms;
  while (Date.now() < end && boomA === before.booms) {
    await sleep(20);
    boomA = (await stats(A)).booms;
  }
  if (boomA === before.booms) throw new Error('the grenade never exploded on screen');
  saved.push(await shot(A, 'grenade-boom-thrower.png'));
  saved.push(await shot(B, 'grenade-boom-near.png'));
  await sleep(150);
  saved.push(await shot(A, 'grenade-boom-thrower-2.png'));
  await sleep(1200);
  saved.push(await shot(A, 'grenade-after.png'));
  const afterGrenade = { a: await stats(A), b: await stats(B), bHp: sb.sim.hp, bAlive: sb.sim.alive };

  // The rocket: the launcher as the pickup would give it, raised with 3, fired past B.
  await sleep(3500); // B respawns if the grenade got it
  put();
  await sleep(800);
  setRockets(sa.sim, 3);
  // Aim at the ground a little short of B and to its side: the rocket bursts in view, next to B.
  await A.evaluate(([x, z, p]) => (window as any).__qwakk.face(x, z, 60000, p), [spots.b[0] - 2, spots.b[2], -Math.atan2(1.9, dist - 2)]);
  await B.evaluate(([x, z]) => (window as any).__qwakk.face(x, z, 60000, -0.05), [spots.a[0], spots.a[2]]);
  await sleep(300);
  await A.evaluate((b) => (window as any).__qwakk.press(b, 120), Button.Slot3);
  await sleep(900);
  saved.push(await shot(A, 'rocket-launcher-up.png'));
  const r0 = await stats(A);
  await A.evaluate((b) => (window as any).__qwakk.press(b, 120), Button.Fire);
  await sleep(110);
  saved.push(await shot(A, 'rocket-flight-1.png'));
  saved.push(await shot(B, 'rocket-flight-incoming.png'));
  await sleep(70);
  saved.push(await shot(A, 'rocket-flight-2.png'));
  const rEnd = Date.now() + 4000;
  let rb = r0.booms;
  while (Date.now() < rEnd && rb === r0.booms) {
    await sleep(20);
    rb = (await stats(A)).booms;
  }
  if (rb === r0.booms) throw new Error('the rocket never exploded on screen');
  saved.push(await shot(A, 'rocket-boom.png'));
  saved.push(await shot(B, 'rocket-boom-near.png'));
  await sleep(1500);
  saved.push(await shot(A, 'rocket-smoke-scorch.png'));
  const final = { a: await stats(A), b: await stats(B), pred: await A.evaluate(() => (window as any).__qwakk.snapshot().prediction) };
  if (final.a.localThrows < 2) throw new Error(`expected 2 predicted throws on A, got ${final.a.localThrows}`);
  console.log(JSON.stringify({ spots, afterGrenade, final, errors, saved }, null, 2));
  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  console.log('PASS: grenade preview, throw and blast; rocket launch, trail and blast');
} finally {
  await browser.close();
  web.kill('SIGINT');
  await server.gracefullyShutdown(false).catch(() => {});
  http.close();
}
process.exit(0);
