/**
 * Deathmatch benchmark orchestrator: for each scenario, start a fresh game
 * server process (port 2599) with stats enabled, connect network clients to
 * one or more of the static deathmatch rooms, and collect server tick time,
 * patch time, CPU and per-client bandwidth. Prints a Markdown table.
 *
 * Scenarios (default): a full room of network clients (ROOM.maxClients, 32);
 * 1 client plus server bots (MATCH.players) in one room; the same two with all three rooms full at once.
 * Network clients send random inputs (move, sprint, crouch, jump, fire a third
 * of the time); server bots are the real navmesh bots.
 *
 * Usage: npm run bench                       (the four scenarios, 30 s each)
 *        npm run bench -- 8 16 32            (custom client counts in one room, no server bots)
 *        npm run bench -- --no-interest      (every player at full rate: the baseline)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { MATCH, ROOM } from '@qwakk/shared';
import { DM_ROOM_CATALOG } from '@qwakk/shared/lobby';
import { runBots } from './bots.ts';
import { dmMapId } from '../src/maps.ts';

const DM_MAP: string = dmMapId();

const PORT = 2599;

const MEASURE_SECONDS = 30;
const STATS_MS = 10_000;

interface Snapshot {
  roomId: string;
  players: number;
  ticks: number;
  tickAvgMs: number;
  tickP95Ms: number;
  tickMaxMs: number;
  patchAvgMs: number;
  patchP95Ms: number;
  patchMaxMs: number;
  cpuPct: number;
  rssMb: number;
  visRays?: number;
}

interface Scenario {
  /** Network clients per room. */
  clients: number;
  rooms: number;
  serverBots: boolean;
}

async function startServer(serverBots: boolean): Promise<{ proc: ChildProcess; snapshots: Snapshot[] }> {
  const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', entry], {
    env: { ...process.env, PORT: String(PORT), QWAKK_STATS: '1', QWAKK_STATS_MS: String(STATS_MS), QWAKK_BOTS: serverBots ? '1' : '0', QWAKK_MAX_CLIENTS: '64', QWAKK_DM_ROOMS: String(DM_ROOM_CATALOG.length), QWAKK_INTEREST: INTEREST_ON ? '1' : '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const snapshots: Snapshot[] = [];
  let listening = false;
  let navReady = false;
  let ready: () => void;
  const readyP = new Promise<void>((r) => (ready = r));
  let buffer = '';
  proc.stdout!.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.includes('server listening')) listening = true;
      // Server bots need their navmesh (from the cache, or built on start).
      if (line.includes(`[nav] ${DM_MAP} navmesh`)) navReady = true;
      if (listening && (navReady || DM_MAP === 'greybox')) ready();
      if (line.startsWith('[stats] ')) snapshots.push(JSON.parse(line.slice(8)) as Snapshot);
    }
  });
  await readyP;
  return { proc, snapshots };
}

async function benchOnce(s: Scenario) {
  const { proc, snapshots } = await startServer(s.serverBots);
  const rooms: string[] = DM_ROOM_CATALOG.slice(0, s.rooms).map((r) => r.id);
  const result = await runBots(`ws://localhost:${PORT}`, s.clients * s.rooms, MEASURE_SECONDS, 3, rooms);
  proc.kill('SIGINT');
  await once(proc, 'exit');
  const players = s.serverBots ? Math.max(MATCH.players, s.clients) : s.clients;
  // Only snapshots of the measured rooms, taken with every client connected, count (skip the first interval).
  const full = snapshots.filter((x) => rooms.includes(x.roomId) && x.players === players && x.ticks > 0);
  const perRoom = new Map<string, Snapshot[]>();
  for (const x of full) perRoom.set(x.roomId, [...(perRoom.get(x.roomId) ?? []), x]);
  const use = [...perRoom.values()].flatMap((list) => (list.length > 1 ? list.slice(1) : list));
  const avg = (k: keyof Snapshot) => use.reduce((n, x) => n + Number(x[k] ?? 0), 0) / Math.max(1, use.length);
  const max = (k: keyof Snapshot) => use.reduce((n, x) => Math.max(n, Number(x[k] ?? 0)), 0);
  return {
    ...s,
    players,
    roomsSeen: result.roomIds.length,
    snapshotsUsed: use.length,
    tickAvgMs: avg('tickAvgMs'),
    tickP95Ms: max('tickP95Ms'),
    tickMaxMs: max('tickMaxMs'),
    patchAvgMs: avg('patchAvgMs'),
    patchP95Ms: max('patchP95Ms'),
    patchMaxMs: max('patchMaxMs'),
    // Whole-process CPU: the same number on every room's line.
    cpuPct: avg('cpuPct'),
    rssMb: max('rssMb'),
    raysPerSec: (avg('visRays') * s.rooms) / (STATS_MS / 1000),
    downKBps: result.downBytesPerSecPerClient / 1000,
    upKBps: result.upBytesPerSecPerClient / 1000,
    downMsgsPerSec: result.downMsgsPerSecPerClient,
    posesHeld: result.posesHeld,
    othersInRoom: result.othersInRoom,
  };
}

const INTEREST_ON = !process.argv.includes('--no-interest');
/** The worst case: every human seat taken (more than MATCH.players, so no bots). */
const FULL_ROOM = Math.max(MATCH.players, ROOM.maxClients);
const counts = process.argv.slice(2).map(Number).filter((n) => n > 0);
const plan: Scenario[] =
  counts.length > 0
    ? counts.map((n) => ({ clients: n, rooms: 1, serverBots: false }))
    : [
        { clients: FULL_ROOM, rooms: 1, serverBots: false },
        { clients: 1, rooms: 1, serverBots: true },
        { clients: FULL_ROOM, rooms: DM_ROOM_CATALOG.length, serverBots: false },
        { clients: 1, rooms: DM_ROOM_CATALOG.length, serverBots: true },
      ];
const rows = [];
for (const s of plan) {
  console.error(`[bench] ${s.rooms} room(s) x ${s.clients} client(s)${s.serverBots ? ' + server bots' : ''}, ${MEASURE_SECONDS} s ...`);
  rows.push(await benchOnce(s));
}

const f = (v: number, d = 2) => v.toFixed(d);
console.log('| Rooms x (clients + bots) | Tick avg / p95 / max per room (ms) | Patch avg / p95 / max (ms) | Server CPU (% of 1 core) | RSS (MB) | Down per client (KB/s) | Up per client (KB/s) | Messages/s | Poses held / others | Visibility rays/s |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) {
  const who = `${r.rooms} x (${r.clients} + ${r.players - r.clients})`;
  console.log(
    `| ${who} | ${f(r.tickAvgMs, 3)} / ${f(r.tickP95Ms, 3)} / ${f(r.tickMaxMs)} | ${f(r.patchAvgMs, 3)} / ${f(r.patchP95Ms, 3)} / ${f(r.patchMaxMs)} | ${f(r.cpuPct, 1)} | ${r.rssMb} | ${f(r.downKBps)} | ${f(r.upKBps)} | ${f(r.downMsgsPerSec, 1)} | ${f(r.posesHeld, 1)} / ${f(r.othersInRoom, 1)} | ${Math.round(r.raysPerSec)} |`,
  );
}
console.log('\n' + JSON.stringify(rows));
process.exit(0);
