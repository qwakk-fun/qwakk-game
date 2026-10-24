/**
 * Duck Plaza benchmark (`npm run bench:hub`): a server process (port 2594,
 * stats on, no database) with one full hub room of 40 network clients
 * (HUB.maxClients) walking, sprinting and jumping around with random inputs,
 * quacking and chatting now and then. Measured over 30 s after a warm-up:
 * the hub room's tick and patch time, the server's CPU and memory, the
 * bandwidth down per client and how many other ducks a client holds a pose
 * for (near and far). Runs twice: everyone crowding the spawn square, and
 * everyone spread over the whole plaza.
 *
 * Compare with `npm run bench` (a full deathmatch room, README Server
 * benchmark): the plaza has no combat, no bots and no line-of-sight culling.
 *
 * Usage: npm run bench:hub [-- CLIENTS]
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Client, type Room } from '@colyseus/sdk';
import { Button, TICK_RATE } from '@qwakk/shared';
import { Msg } from '@qwakk/shared/net';
import { HUB, HubEmote, HubMsg } from '@qwakk/shared/hub';
import { HubState } from '@qwakk/shared/hub/schema';

const PORT = 2594;
const CLIENTS = Number(process.argv[2] ?? HUB.maxClients);
const WARMUP_S = 8;
const MEASURE_S = 30;
const STATS_MS = 10_000;
const f = (v: number, d = 3) => v.toFixed(d);

interface Snap { roomId: string; players: number; ticks: number; tickAvgMs: number; tickP95Ms: number; tickMaxMs: number; patchAvgMs: number; patchP95Ms: number; cpuPct: number; rssMb: number; hubPairs?: number }

async function startServer(): Promise<{ proc: ChildProcess; snaps: Snap[] }> {
  const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', entry], {
    env: { ...process.env, PORT: String(PORT), QWAKK_STATS: '1', QWAKK_STATS_MS: String(STATS_MS), QWAKK_BOTS: '0', DATABASE_URL: '', NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const snaps: Snap[] = [];
  let ready: () => void;
  const p = new Promise<void>((r) => (ready = r));
  let listening = false;
  let navs = 0;
  let buf = '';
  proc.stdout!.on('data', (c: Buffer) => {
    buf += c.toString();
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.includes('server listening')) listening = true;
      // The deathmatch and battle royale navmeshes load at start: measure after, so their build does not count.
      if (line.includes('navmesh ready')) navs++;
      if (listening && navs >= 2) ready();
      if (line.startsWith('[stats] ')) snaps.push(JSON.parse(line.slice(8)) as Snap);
    }
  });
  await p;
  return { proc, snaps };
}

/** A network duck: walks a wandering path (`spread`: heads out over the whole plaza first), sprints, jumps, quacks and chats now and then. */
function driver(room: Room<unknown, HubState>, i: number, spread: boolean): { stop(): Promise<void>; bytes(): number; poses(): number } {
  let bytes = 0;
  room.onMessage('*', () => undefined);
  const ws = (room.connection.transport as unknown as { ws?: { addEventListener?: (t: string, cb: (e: { data: unknown }) => void) => void } }).ws;
  ws?.addEventListener?.('message', (e) => {
    const d = e.data as ArrayBuffer | string;
    bytes += typeof d === 'string' ? d.length : d.byteLength;
  });
  const input = room.input<{ tick: number; mx: number; mz: number; buttons: number; yaw: number; pitch: number; vt: number }>();
  let tick = 0;
  // Spread: everyone walks out in its own direction first; crowd: everyone mills around the spawn square.
  let yaw = spread ? (i / CLIENTS) * Math.PI * 2 : Math.random() * 6;
  const timer = setInterval(() => {
    tick++;
    if (!spread || tick > 30 * 6) yaw += Math.sin((tick + i * 17) / 45) * 0.06;
    const d = input.data;
    d.tick = tick;
    d.mx = spread && tick < 30 * 6 ? 0 : Math.sin((tick + i * 13) / 37) * 0.6;
    d.mz = spread || Math.cos((tick + i * 7) / 53) > -0.3 ? 1 : 0;
    d.yaw = ((yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
    d.pitch = -0.1;
    d.buttons = (tick % 90 === i % 90 ? Button.Jump : 0) | (Math.floor((tick + i * 11) / 60) % 3 === 0 ? Button.Sprint : 0);
    d.vt = 0;
    input.send();
    if (tick % 150 === (i * 7) % 150) room.send(HubMsg.Emote, [HubEmote.Quack]);
    if (tick % 300 === (i * 23) % 300) room.send(Msg.Chat, `quack from duck ${i}`);
  }, 1000 / TICK_RATE);
  return {
    stop: async () => {
      clearInterval(timer);
      await room.leave(true).catch(() => undefined);
    },
    bytes: () => bytes,
    poses: () => room.state.poses.size + room.state.farPoses.size,
  };
}

async function run(spread: boolean): Promise<string> {
  const { proc, snaps } = await startServer();
  const client = new Client(`ws://localhost:${PORT}`);
  const rooms: Room<unknown, HubState>[] = [];
  for (let i = 0; i < CLIENTS; i++) rooms.push(await client.joinOrCreate<HubState>(HUB.roomName, {}, HubState));
  const ids = new Set(rooms.map((r) => r.roomId));
  if (ids.size !== 1) throw new Error(`the clients landed in ${ids.size} hub rooms`);
  const drivers = rooms.map((r, i) => driver(r, i, spread));
  await new Promise((r) => setTimeout(r, WARMUP_S * 1000));
  const b0 = drivers.map((d) => d.bytes());
  const n0 = snaps.length;
  let poseSum = 0;
  let poseN = 0;
  const sampler = setInterval(() => {
    for (const d of drivers) poseSum += d.poses();
    poseN += drivers.length;
  }, 1000);
  await new Promise((r) => setTimeout(r, MEASURE_S * 1000));
  clearInterval(sampler);
  const kbps = drivers.reduce((n, d, i) => n + (d.bytes() - b0[i]!), 0) / drivers.length / MEASURE_S / 1000;
  for (const d of drivers) await d.stop();
  proc.kill('SIGINT');
  await once(proc, 'exit');
  const hub = snaps.slice(n0).filter((s) => s.roomId === rooms[0]!.roomId && s.ticks > 0);
  const avg = (k: keyof Snap) => hub.reduce((n, x) => n + Number(x[k] ?? 0), 0) / Math.max(1, hub.length);
  const max = (k: keyof Snap) => hub.reduce((n, x) => Math.max(n, Number(x[k] ?? 0)), 0);
  const label = `${CLIENTS} clients, ${spread ? 'spread over the plaza' : 'crowding the spawn square'}`;
  return `| ${label} | ${f(avg('tickAvgMs'))} / ${f(max('tickP95Ms'))} / ${f(max('tickMaxMs'), 2)} | ${f(avg('patchAvgMs'))} / ${f(max('patchP95Ms'))} | ${f(avg('cpuPct'), 1)} | ${max('rssMb')} | ${f(kbps, 2)} | ${f(poseSum / Math.max(1, poseN), 1)} of ${CLIENTS - 1} |`;
}

const rows = [await run(false), await run(true)];
console.log('| Hub room | Tick avg / p95 / max (ms) | Patch avg / p95 (ms) | Server CPU (% of 1 core) | RSS (MB) | Down per client (KB/s) | Poses held per client |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) console.log(r);
process.exit(0);
