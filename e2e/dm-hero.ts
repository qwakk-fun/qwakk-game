/**
 * Kill stacks and the caped hero in a real browser against a real room on
 * the deathmatch map (bots off). Combat and the hero pick are triggered
 * inside this test process only (no production endpoint). Checks: the public
 * stack and hero state, the announcements, the coarse ping (grid only, never
 * to the hero, every 5 s), the cape transfer on a kill, hero health, and
 * flight in the browser with zero prediction corrections. Screenshots of the
 * hero with its cape (standing and in flight) and the stack auras.
 *
 * Usage: npm run build:test && npm run e2e:dm-hero -- [/output/dir]
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { Server, matchMaker, type Client as ServerClient } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client } from '@colyseus/sdk';
import { Button, DM_HERO, groundHeightAt, HERO_FLIGHT, isHero, killStacks, ROOM } from '@qwakk/shared';
import { IslandState, Msg } from '@qwakk/shared/net';
import { IslandRoom } from '../apps/server/src/IslandRoom.ts';
import type { JoinAuth } from '../apps/server/src/gameRoom.ts';
import type { BotLike, Seat } from '../apps/server/src/arena.ts';

class TestRoom extends IslandRoom {
  override async onAuth(_client: ServerClient, options: { name?: string } = {}): Promise<JoinAuth> {
    return { playerId: null, name: options.name ?? 'Duck', tag: '1234', signed: false };
  }
}

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? '/tmp/qwakk-dm-hero';
mkdirSync(out, { recursive: true });
const http = createServer();
const server = new Server({ gracefullyShutdown: false, transport: new WebSocketTransport({ server: http }) });
server.define(ROOM.name, TestRoom, { bots: false, mapId: 'canard-quarter' });
await server.listen(0);
const roomInfo = await matchMaker.createRoom(ROOM.name, {});
const room = matchMaker.getLocalRoomById(roomInfo.roomId) as TestRoom;
const endpoint = `ws://localhost:${(http.address() as AddressInfo).port}`;
const webPort = Number(process.env.E2E_WEB_PORT ?? 5189);
const web = spawn(process.execPath, [`${root}/node_modules/vite/bin/vite.js`, 'preview', '--outDir', 'dist-test', '--port', String(webPort), '--strictPort'], { cwd: `${root}/apps/client`, stdio: ['ignore', 'pipe', 'pipe'] });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER === 'chromium' ? undefined : 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text()); });
// Two headless players: the first hero (later the one who loses the cape) and an observer.
const peer = await new Client(endpoint).joinById(roomInfo.roomId, { name: 'Target' }, IslandState);
const watcher = await new Client(endpoint).joinById(roomInfo.roomId, { name: 'Watcher' }, IslandState);
type Ping = { pid: number; x: number; z: number; at: number };
const peerPings: Ping[] = [];
const watcherPings: Ping[] = [];
for (const [c, list] of [[peer, peerPings], [watcher, watcherPings]] as const) {
  c.onMessage('*', () => {});
  c.onMessage(Msg.DmHeroPing, (d: number[]) => list.push({ pid: d[0]!, x: d[1]!, z: d[2]!, at: Date.now() }));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const wait = async (label: string, predicate: () => boolean, ms = 10000) => {
  const end = Date.now() + ms;
  while (!predicate()) { if (Date.now() > end) throw new Error(`timeout: ${label}`); await sleep(50); }
};
const combat = room.dm as unknown as { kill(k: Seat, v: Seat, weapon: number, head: boolean): void };
/** Put a seat on the ground at (x, z), facing yaw (server state; the owner's client snaps to it). */
const place = (s: Seat, x: number, z: number, yaw = 0) => {
  const y = groundHeightAt(room.dm.world, x, 30, z);
  Object.assign(s.sim, { x, y, z, vx: 0, vy: 0, vz: 0, yaw, grounded: 0 });
};

try {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('vite startup timeout')), 10000);
    web.stdout!.on('data', (chunk: Buffer) => { if (chunk.toString().includes(String(webPort))) { clearTimeout(timeout); resolve(); } });
  });
  await page.goto(`http://localhost:${webPort}/game/?mode=dm&server=${encodeURIComponent(endpoint)}&name=HeroDuck&lang=en&hud=0`);
  await page.waitForFunction(() => (window as any).__qwakk?.snapshot().players === 3, null, { timeout: 60000 });
  await page.evaluate(() => document.getElementById('overlay')?.classList.add('hidden'));
  const id = await page.evaluate(() => (window as any).__qwakk.snapshot().sessionId as string);
  const me = room.dm.seats.get(id)!, target = room.dm.seats.get(peer.sessionId)!, other = room.dm.seats.get(watcher.sessionId)!;
  // No random pick during the test: the hero comes from this process.
  (room.dm.hero as unknown as { nextPick: number }).nextPick = Number.MAX_SAFE_INTEGER;
  const { x: ax, z: az } = room.dm.world.map.arena;

  // Kill stacks: three kills, public on the player state, a meter and a toast for the owner.
  for (let i = 0; i < 3; i++) { room.dm.spawn(other); combat.kill(me, other, 0, false); }
  await wait('public stacks', () => (peer.state.players.get(id)?.dmBuff ?? 0) === 3);
  await page.locator('.dmh-stacks .dmh-pip.on').nth(2).waitFor();
  if (killStacks(me.sim) !== 3) throw new Error('server stacks');
  console.log('PASS: kill stacks granted, public, HUD meter');

  // The hero: the peer, standing in front of us.
  room.dm.spawn(other);
  // Facing away from us, so the cape shows.
  place(target, ax, az, 0.5);
  place(me, ax, az + 5.5, 0);
  me.protect = 0; target.protect = 0;
  room.dm.hero.crown(room.dm.currentTick, target, null);
  await page.locator('.dmh-banner').filter({ hasText: 'Target is the hero!' }).waitFor();
  await wait('watcher ping', () => watcherPings.length >= 1);
  await page.locator('.dmh-compass').waitFor({ state: 'visible' });
  await page.evaluate(([x, z]) => (window as any).__qwakk.face(x, z, 60000, -0.05), [ax, az]);
  await sleep(1200);
  await page.screenshot({ path: `${out}/hero-standing.png` });
  if (target.sim.hp !== DM_HERO.health) throw new Error('hero health');
  console.log('PASS: hero chosen, announced, cape and gold aura drawn');

  // The ping: coarse grid, every 5 s, never to the hero itself.
  await wait('two more pings', () => watcherPings.length >= 3, 12000);
  for (const p of watcherPings) {
    if (p.x % DM_HERO.pingGrid !== 0 || p.z % DM_HERO.pingGrid !== 0) throw new Error(`ping not on the grid: ${p.x}, ${p.z}`);
    if (p.pid !== target.pid) throw new Error('ping for the wrong duck');
  }
  const gap = (watcherPings[2]!.at - watcherPings[1]!.at) / 1000;
  if (Math.abs(gap - DM_HERO.pingEverySeconds) > 0.6) throw new Error(`ping cadence ${gap}s`);
  if (peerPings.length !== 0) throw new Error('the hero got its own ping');
  console.log(`PASS: hero ping coarse (${watcherPings.map((p) => `${p.x},${p.z}`).join(' ')}), every ${gap.toFixed(1)} s, not to the hero`);

  // Take the cape.
  combat.kill(me, target, 0, false);
  await page.locator('.dmh-banner').filter({ hasText: 'You took the cape!' }).waitFor();
  if (!isHero(me.sim) || me.sim.hp !== DM_HERO.health || me.sim.dmEnergy !== HERO_FLIGHT.energyTicks) throw new Error('cape transfer');
  await wait('peer sees the new hero', () => ((peer.state.players.get(id)?.dmBuff ?? 0) & 8) === 8);
  await page.locator('.dmh-fly').waitFor({ state: 'visible' });
  const pingsBefore = peerPings.length;
  await wait('ping to the old hero now', () => peerPings.length > pingsBefore, 7000);
  console.log('PASS: cape transfer on the kill, hero health and energy, the old hero now gets pings');

  // Fly: hold Jump with forward, in the browser, through the real input path.
  room.dm.spawn(target);
  place(me, ax, az + 8, 0);
  await sleep(800);
  await page.evaluate(([x, z]) => (window as any).__qwakk.face(x, z, 60000, 0.12), [ax, az - 30]);
  await sleep(400);
  await page.evaluate(() => (window as any).__qwakk.resetStats());
  const y0 = me.sim.y;
  await page.evaluate((jump) => (window as any).__qwakk.press(jump, 2600, 0.6), Button.Jump);
  await sleep(1500);
  await page.screenshot({ path: `${out}/hero-flight.png` });
  const climbed = me.sim.y - y0;
  await sleep(1400);
  await page.screenshot({ path: `${out}/hero-glide.png` });
  await wait('landed', () => me.sim.grounded === 1, 15000);
  await sleep(300);
  await page.screenshot({ path: `${out}/hero-landed.png` });
  const snap = await page.evaluate(() => (window as any).__qwakk.snapshot());
  if (climbed < 3) throw new Error(`hero did not fly (climbed ${climbed.toFixed(2)} m)`);
  if (me.sim.dmEnergy >= HERO_FLIGHT.energyTicks) throw new Error('flight did not spend energy');
  console.log(`PASS: flight in the browser: climbed ${climbed.toFixed(1)} m; prediction reconciles ${snap.prediction.reconciles}, corrected ${snap.prediction.corrected}, max error ${snap.prediction.maxErrM.toFixed(4)} m`);
  if (snap.prediction.corrected > 0) throw new Error('prediction corrections while flying');

  // A stacked duck seen by others: the peer with five stacks (embers), in front of us.
  room.dm.spawn(target);
  for (let i = 0; i < 5; i++) { room.dm.spawn(other); combat.kill(target, other, 0, false); }
  place(target, ax + 1.5, az, Math.PI);
  place(me, ax - 1, az + 5, 0);
  room.dm.spawn(other);
  place(other, ax - 2.5, az - 1, Math.PI);
  await sleep(800);
  await page.evaluate(([x, z]) => (window as any).__qwakk.face(x, z, 60000, -0.05), [ax, az]);
  await sleep(1200);
  await page.screenshot({ path: `${out}/stacks-seen.png` });
  if (killStacks(target.sim) !== 5) throw new Error('five stacks');

  // Another hero in flight, seen from the side: a scripted bot (this process only) flying circles.
  const flyer: BotLike = {
    think: (_self, _others, tick) => ({ seq: 0, tick, mx: 0, mz: 1, buttons: tick % 90 < 60 ? Button.Jump : 0, yaw: Math.fround(tick * 0.03), pitch: 0 }),
    respawned: () => {},
    damagedFrom: () => {},
  };
  const internals = room.dm as unknown as { addSeat(id: string, name: string, bot: BotLike): Seat };
  const bot = internals.addSeat('flyer', 'Flyer', flyer);
  (room as unknown as { syncSeats(): void }).syncSeats();
  // It takes the cape from us the normal way.
  combat.kill(bot, me, 0, false);
  if (!isHero(bot.sim) || isHero(me.sim)) throw new Error('cape to the bot');
  await wait('our respawn', () => me.sim.alive === 1, 8000);
  place(bot, ax + 8, az, 0);
  place(me, ax + 1, az + 15, 0);
  bot.protect = 0;
  await sleep(600);
  await page.evaluate(([x, z]) => (window as any).__qwakk.face(x, z, 60000, 0.25), [ax + 1, az]);
  await wait('bot hero flying', () => bot.sim.y - me.sim.y > 3, 10000);
  await sleep(500);
  await page.screenshot({ path: `${out}/hero-flight-seen.png` });
  await sleep(900);
  await page.screenshot({ path: `${out}/hero-flight-seen-2.png` });
  console.log(`PASS: another hero in flight seen by us (${(bot.sim.y - me.sim.y).toFixed(1)} m up)`);
  await page.setViewportSize({ width: 844, height: 390 });
  await sleep(500);
  await page.screenshot({ path: `${out}/hud-small.png` });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`DM HERO E2E OK, screenshots: ${out}`);
} catch (err) {
  await page.screenshot({ path: `${out}/failed.png` }).catch(() => {});
  console.error('page errors:', errors.join('\n'));
  throw err;
} finally {
  await context.close();
  await browser.close();
  await peer.leave().catch(() => {});
  await watcher.leave().catch(() => {});
  web.kill('SIGINT');
  await server.gracefullyShutdown(false);
}
