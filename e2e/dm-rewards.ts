/** Real game + WebSocket smoke test. Synthetic combat is injected only in this test process. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { Server, matchMaker, type Client as ServerClient } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client } from '@colyseus/sdk';
import { DmPower, groundHeightAt, ROOM, type DmReward, type DmKillcam } from '@qwakk/shared';
import { IslandState, MatchPhase, Msg } from '@qwakk/shared/net';
import { IslandRoom } from '../apps/server/src/IslandRoom.ts';
import type { JoinAuth } from '../apps/server/src/gameRoom.ts';
import type { Seat } from '../apps/server/src/arena.ts';

class TestRoom extends IslandRoom {
  override async onAuth(_client: ServerClient, options: { name?: string } = {}): Promise<JoinAuth> {
    return { playerId: null, name: options.name ?? 'Duck', tag: '1234', signed: false, account: true };
  }
}

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? '/tmp/qwakk-dm-rewards';
mkdirSync(out, { recursive: true });
const http = createServer();
const server = new Server({ gracefullyShutdown: false, transport: new WebSocketTransport({ server: http }) });
server.define(ROOM.name, TestRoom, { bots: false, mapId: 'greybox' });
await server.listen(0);
const roomInfo = await matchMaker.createRoom(ROOM.name, {});
const room = matchMaker.getLocalRoomById(roomInfo.roomId) as TestRoom;
const endpoint = `ws://localhost:${(http.address() as AddressInfo).port}`;
const webPort = 5187;
const web = spawn(process.execPath, [`${root}/node_modules/vite/bin/vite.js`, 'preview', '--outDir', process.env.E2E_DIST ?? 'dist-test', '--port', String(webPort), '--strictPort'], { cwd: `${root}/apps/client`, stdio: ['ignore', 'pipe', 'pipe'] });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text()); });
const peer = await new Client(endpoint).joinById(roomInfo.roomId, { name: 'Target' }, IslandState);
const peerRewards: DmReward[] = [];
const peerReplays: DmKillcam[] = [];
peer.onMessage('*', () => {});
peer.onMessage(Msg.DmKillcam, (r: DmKillcam) => peerReplays.push(r));
peer.onMessage(Msg.DmReward, (r: DmReward) => peerRewards.push(r));
const wait = async (label: string, predicate: () => boolean, ms = 10000) => {
  const end = Date.now() + ms;
  while (!predicate()) { if (Date.now() > end) throw new Error(`timeout: ${label}`); await new Promise((r) => setTimeout(r, 50)); }
};

try {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('vite startup timeout')), 10000);
    web.stdout!.on('data', (chunk: Buffer) => { if (chunk.toString().includes(String(webPort))) { clearTimeout(timeout); resolve(); } });
  });
  await page.goto(`http://localhost:${webPort}/game/?server=${encodeURIComponent(endpoint)}&autopilot=1&name=TestDuck&lang=tr&hud=0`);
  await page.waitForFunction(() => (window as any).__qwakk?.snapshot().players === 2, null, { timeout: 60000 });
  await page.evaluate(() => { (window as any).__qwakk.face(0, 0, 120000); document.getElementById('overlay')?.classList.add('hidden'); });
  const id = await page.evaluate(() => (window as any).__qwakk.snapshot().sessionId as string);
  const me = room.dm.seats.get(id)!, victim = room.dm.seats.get(peer.sessionId)!;
  // Production code has no force-kill message; only this process can call the protected hook.
  const combat = room.dm as unknown as { kill(k: Seat, v: Seat, weapon: number, head: boolean): void };
  for (let i = 0; i < 3; i++) { room.dm.spawn(victim); combat.kill(me, victim, 0, i === 2); }
  await page.locator('.dm-reward.streak').filter({ hasText: '3 ÖLDÜRME SERİSİ' }).waitFor();
  await wait('public points', () => peer.state.players.get(id)?.dmPoints === 400);
  if (peerRewards.length) throw new Error('private rewards leaked to another player');
  await page.screenshot({ path: `${out}/streak-desktop.png` });
  console.log('PASS: streak/headshot reward and private delivery');

  await wait('victim-only killcam', () => peerReplays.length === 3);
  if (peerReplays.some(r => r.killerId !== id || r.victimId !== peer.sessionId)) throw new Error('wrong killcam actors');
  // Record the killer's current life, including when outside the victim's view.
  room.dm.spawn(victim);
  await page.waitForTimeout(1000);
  const replaysBefore = peerReplays.length;
  combat.kill(victim, me, 0, false);
  await page.locator('.dm-replay').filter({ hasText: 'Ölüm kamerası · Target' }).waitFor({ state: 'visible' });
  await page.screenshot({ path: `${out}/death-replay.png` });
  await page.keyboard.press('Space');
  await page.locator('.dm-replay').waitFor({ state: 'hidden' });
  await wait('respawn', () => me.sim.alive === 1);
  if (peerReplays.length !== replaysBefore) throw new Error('killcam leaked to the killer');
  console.log('PASS: killer-view replay, private delivery, skip, and normal respawn');

  const toward = Math.hypot(me.sim.x, me.sim.z) || 1;
  const px = me.sim.x - 4 * me.sim.x / toward, pz = me.sim.z - 4 * me.sim.z / toward;
  const py = groundHeightAt(room.dm.world, px, me.sim.y + 3, pz) + 0.8;
  room.dm.powerups.pickups.set('899', { id: '899', kind: DmPower.Jump, x: px, y: py, z: pz, expires: room.dm.currentTick + 900 });
  await wait('public pickup mesh state', () => peer.state.dmPickups.has('899'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/pickup-world.png` });
  room.dm.powerups.pickups.delete('899');
  me.protect = 0;
  room.dm.powerups.pickups.set('900', { id: '900', kind: DmPower.Speed, x: me.sim.x, y: me.sim.y + 0.8, z: me.sim.z, expires: room.dm.currentTick + 900 });
  await page.locator('.dm-reward.power').filter({ hasText: 'Hız takviyesi' }).waitFor();
  await page.screenshot({ path: `${out}/powerup.png` });
  if (peer.state.players.get(id)?.dmPower === DmPower.Speed) throw new Error('owner-only buff leaked');
  room.dm.spawn(victim); combat.kill(me, victim, 0, false);
  await page.locator('.dm-reward').filter({ hasText: 'İntikam' }).waitFor();
  console.log('PASS: pickup, owner visibility, revenge');

  // Force only the round clock; normal room logic builds the frozen MVP state.
  room.dm.stats.get(me.id)!.shots = 20;
  room.dm.stats.get(me.id)!.hits = 12;
  room.dm.ticksLeft = 1;
  await page.locator('.dm-mvp').waitFor({ state: 'visible' });
  await page.locator('.dm-mvp').filter({ hasText: '60%' }).waitFor();
  await page.screenshot({ path: `${out}/mvp-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/mvp-mobile.png` });
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('mobile horizontal overflow');
  console.log('PASS: frozen MVP, accuracy, desktop/mobile layout');
  await wait('next round', () => room.dm.phase === 'playing', 15000);
  await page.locator('.dm-mvp').waitFor({ state: 'hidden' });
  if (room.dm.stats.get(me.id)?.points !== 0 || room.dm.results.length) throw new Error('round did not reset');
  await page.setViewportSize({ width: 1280, height: 800 });
  // A real 60-second rotation, with current server ticks and human input still running.
  await wait('weapon rotation', () => room.dm.rotationWeapon === 1, 65000);
  await page.locator('.dm-status').filter({ hasText: 'Tabanca' }).waitFor();
  await page.screenshot({ path: `${out}/rotation.png` });
  if (me.sim.arms !== 2 || victim.sim.arms !== 2) throw new Error('rotation did not apply to all seats');
  if (peer.state.phase !== MatchPhase.Playing) throw new Error('peer state out of sync');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`DEATHMATCH REWARDS E2E OK — screenshots: ${out}`);
} finally {
  await context.close();
  await browser.close();
  await peer.leave().catch(() => {});
  web.kill('SIGINT');
  await server.gracefullyShutdown(false);
}
