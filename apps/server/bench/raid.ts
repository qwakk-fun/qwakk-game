/**
 * Hunt Season benchmark (`npm run bench:raid`):
 *
 *  1. headless: four bot ducks hold the tower through waves 13 to 15 (up to
 *     RAID.maxLive hunters alive), and a forced worst case of 30 hunters at
 *     once: the raid's own tick cost;
 *  2. networked: a server process (port 2597, test hooks on) with one full
 *     raid room of 4 network clients sending random inputs at wave 13 (ducks
 *     held: no damage, so the wave keeps going), alone and next to a
 *     deathmatch room of 1 client plus its server bots: tick, patch, CPU and
 *     bandwidth per client.
 *
 * Usage: npm run bench:raid
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Client, type Room } from '@colyseus/sdk';
import { Button, HunterKind, MATCH, RAID, ROOM, TICK_RATE } from '@qwakk/shared';
import { IslandState } from '@qwakk/shared/net';
import { headlessRaid, summarize } from './raidHeadless.ts';
import { sightStats } from '../src/raid/sight.ts';

const PORT = 2597;
const MEASURE_S = 30;
const STATS_MS = 10_000;
const f = (v: number, d = 3) => v.toFixed(d);

async function headless(): Promise<string[]> {
  const rows: string[] = [];
  {
    const h = await headlessRaid({ ducks: 4, rules: { hunterDamageScale: 0.2, towerHp: 20000 } });
    h.raid.beginTick(0, 0);
    h.raid.skipTo(13);
    const rays0 = sightStats.rays;
    const r = h.run(120, (x) => x.over);
    const s = summarize(r.times);
    rows.push(`| Waves 13 to 15, 4 bot ducks, 120 s | ${f(s.avg)} / ${f(s.p95)} / ${f(s.max, 2)} | ${r.maxAlive} | ${f((sightStats.rays - rays0) / r.ticks, 1)} |`);
  }
  {
    const h = await headlessRaid({ ducks: 4, rules: { hunterDamageScale: 0.2, towerHp: 20000, maxLive: 30 } });
    h.raid.beginTick(0, 0);
    h.raid.skipTo(14);
    const kinds = [HunterKind.Rifleman, HunterKind.Rifleman, HunterKind.Trapper, HunterKind.Decoy, HunterKind.Dog, HunterKind.Dog];
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      h.raid.hunts.spawnForTest(kinds[i % kinds.length]!, Math.cos(a) * 55, Math.sin(a) * 55);
    }
    const rays0 = sightStats.rays;
    const r = h.run(30);
    const s = summarize(r.times);
    rows.push(`| 30 hunters at once, 4 bot ducks, 30 s | ${f(s.avg)} / ${f(s.p95)} / ${f(s.max, 2)} | ${r.maxAlive} | ${f((sightStats.rays - rays0) / r.ticks, 1)} |`);
  }
  return rows;
}

interface Snap { roomId: string; players: number; ticks: number; tickAvgMs: number; tickP95Ms: number; tickMaxMs: number; patchAvgMs: number; patchP95Ms: number; cpuPct: number; rssMb: number; hunters?: number }

async function startServer(): Promise<{ proc: ChildProcess; snaps: Snap[] }> {
  const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', entry], {
    env: { ...process.env, PORT: String(PORT), QWAKK_STATS: '1', QWAKK_STATS_MS: String(STATS_MS), QWAKK_TEST_HOOKS: '1', QWAKK_RAID_COUNTDOWN: '3', DATABASE_URL: '', NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const snaps: Snap[] = [];
  let listening = false;
  let nav = false;
  let ready: () => void;
  const p = new Promise<void>((r) => (ready = r));
  let buf = '';
  proc.stdout!.on('data', (c: Buffer) => {
    buf += c.toString();
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.includes('server listening')) listening = true;
      if (line.includes(`[nav] ${RAID.mapId} navmesh`)) nav = true;
      if (listening && nav) ready();
      if (line.startsWith('[stats] ')) snaps.push(JSON.parse(line.slice(8)) as Snap);
    }
  });
  await p;
  return { proc, snaps };
}

/** A network duck sending random inputs (moves, turns, fires a third of the time), counting its downstream bytes. */
function driver(room: Room<unknown, IslandState>): { stop(): Promise<void>; bytes(): number } {
  let bytes = 0;
  room.onMessage('*', () => undefined);
  const ws = (room.connection.transport as unknown as { ws?: { addEventListener?: (t: string, f: (e: { data: unknown }) => void) => void } }).ws;
  ws?.addEventListener?.('message', (e) => {
    const d = e.data as ArrayBuffer | string;
    bytes += typeof d === 'string' ? d.length : d.byteLength;
  });
  const input = room.input<{ tick: number; mx: number; mz: number; buttons: number; yaw: number; pitch: number; vt: number }>();
  let tick = 0;
  let yaw = Math.random() * 6;
  const timer = setInterval(() => {
    tick++;
    yaw += Math.sin(tick / 40) * 0.05;
    const d = input.data;
    d.tick = tick;
    d.mx = Math.sin(tick / 30);
    d.mz = Math.cos(tick / 50) > 0 ? 1 : 0;
    d.yaw = ((yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
    d.pitch = -0.05;
    d.buttons = Math.floor(tick / 20) % 3 === 0 ? Button.Fire : 0;
    d.vt = Math.max(0, Math.round(room.clock.serverNow() - 130));
    input.send();
  }, 1000 / TICK_RATE);
  return { stop: async () => { clearInterval(timer); await room.leave(true).catch(() => undefined); }, bytes: () => bytes };
}

async function networked(withDm: boolean): Promise<string> {
  const { proc, snaps } = await startServer();
  const url = `ws://localhost:${PORT}`;
  const client = new Client(url);
  const first = await client.joinOrCreate<IslandState>(RAID.roomName, {}, IslandState);
  const rooms = [first];
  for (let i = 1; i < RAID.maxDucks; i++) rooms.push(await client.joinById<IslandState>(first.roomId, {}, IslandState));
  const drivers = rooms.map(driver);
  let dm: { stop(): Promise<void>; bytes(): number } | null = null;
  if (withDm) dm = driver(await client.join<IslandState>(ROOM.name, {}, IslandState));
  await new Promise((r) => setTimeout(r, 4500));
  first.send('dev:raid', { op: 'hold' });
  first.send('dev:raid', { op: 'skip', wave: 13 });
  await new Promise((r) => setTimeout(r, 15_000));
  const b0 = drivers.map((d) => d.bytes());
  const n0 = snaps.length;
  await new Promise((r) => setTimeout(r, MEASURE_S * 1000));
  const kbps = drivers.reduce((n, d, i) => n + (d.bytes() - b0[i]!), 0) / drivers.length / MEASURE_S / 1000;
  const hunters = first.state.hunters.size;
  for (const d of drivers) await d.stop();
  await dm?.stop();
  proc.kill('SIGINT');
  await once(proc, 'exit');
  const raid = snaps.slice(n0).filter((s) => s.roomId === first.roomId && s.ticks > 0);
  const avg = (k: keyof Snap) => raid.reduce((n, x) => n + Number(x[k] ?? 0), 0) / Math.max(1, raid.length);
  const max = (k: keyof Snap) => raid.reduce((n, x) => Math.max(n, Number(x[k] ?? 0)), 0);
  const label = withDm ? `Raid (4 clients, wave 13) + deathmatch (1 + ${MATCH.players - 1} bots)` : 'Raid (4 clients, wave 13)';
  return `| ${label} | ${f(avg('tickAvgMs'))} / ${f(max('tickP95Ms'))} / ${f(max('tickMaxMs'), 2)} | ${f(avg('patchAvgMs'))} / ${f(max('patchP95Ms'))} | ${f(avg('cpuPct'), 1)} | ${max('rssMb')} | ${f(kbps, 2)} | ${Math.round(avg('hunters'))} (${hunters} at the end) |`;
}

const head = await headless();
console.log('| Headless run | Raid tick avg / p95 / max (ms) | Most hunters alive | Sight rays per tick |');
console.log('| --- | --- | --- | --- |');
for (const r of head) console.log(r);
console.log('');
const net = [await networked(false), await networked(true)];
console.log('| Server with | Raid room tick avg / p95 / max (ms) | Patch avg / p95 (ms) | Server CPU (% of 1 core) | RSS (MB) | Down per client (KB/s) | Hunters alive (avg) |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const r of net) console.log(r);
process.exit(0);
