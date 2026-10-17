/**
 * The admin dashboard's numbers: players and connections, every game room
 * with its phase and tick time, and the process (memory, CPU, event loop,
 * uptime, version). Read on demand (the panel polls every few seconds); it
 * costs a walk over the rooms and nothing per tick.
 */
import { readFileSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { liveRooms, type RoomInfo } from '../ops/rooms.ts';
import { publicStatus } from '../ops/notice.ts';

const VERSION = (() => {
  try {
    return (JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')) as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

let lastCpu = process.cpuUsage();
let lastAt = performance.now();

export interface OverviewSources {
  /** Clients per room name over every Colyseus room (game rooms, the lobby, parties). */
  connections(): Promise<{ name: string; clients: number }[]>;
  dbState(): string;
  persistent(): boolean;
}

export async function overview(src: OverviewSources): Promise<unknown> {
  const rooms: RoomInfo[] = [...liveRooms].map((r) => r.roomInfo()).sort((a, b) => a.kind.localeCompare(b.kind) || a.roomId.localeCompare(b.roomId));
  let conns: { name: string; clients: number }[] = [];
  try {
    conns = await src.connections();
  } catch {
    conns = [];
  }
  const byName = new Map<string, number>();
  for (const c of conns) byName.set(c.name, (byName.get(c.name) ?? 0) + c.clients);
  const ticking = rooms.filter((r) => r.tick.samples > 0 && r.phase !== 'idle');
  const now = performance.now();
  const cpu = process.cpuUsage(lastCpu);
  const cpuPct = ((cpu.user + cpu.system) / 1000 / Math.max(1, now - lastAt)) * 100;
  lastCpu = process.cpuUsage();
  lastAt = now;
  const mem = process.memoryUsage();
  const mb = (n: number): number => Math.round((n / 1048576) * 10) / 10;
  const status = publicStatus();
  // Event loop delay over the time since the last read (the panel polls every few seconds).
  const loopP99 = Math.round(loopDelay.percentile(99) / 1e4) / 100;
  loopDelay.reset();
  return {
    at: new Date().toISOString(),
    players: {
      inGame: rooms.reduce((n, r) => n + r.humans, 0),
      spectators: rooms.reduce((n, r) => n + r.spectators, 0),
      bots: rooms.reduce((n, r) => n + r.bots, 0),
      connections: conns.reduce((n, c) => n + c.clients, 0),
      byRoomType: Object.fromEntries(byName),
    },
    rooms,
    server: {
      tickAvgMs: ticking.length ? Math.round((ticking.reduce((n, r) => n + r.tick.avg, 0) / ticking.length) * 1000) / 1000 : 0,
      tickP95Ms: ticking.reduce((n, r) => Math.max(n, r.tick.p95), 0),
      tickMaxMs: ticking.reduce((n, r) => Math.max(n, r.tick.max), 0),
      cpuPct: Math.round(cpuPct * 10) / 10,
      rssMb: mb(mem.rss),
      heapUsedMb: mb(mem.heapUsed),
      heapTotalMb: mb(mem.heapTotal),
      loopDelayP99Ms: loopP99,
      uptimeS: Math.round(process.uptime()),
      version: VERSION,
      commit: (process.env.QWAKK_COMMIT || process.env.CAPROVER_GIT_COMMIT_SHA || 'unknown').slice(0, 12),
      node: process.version,
      db: src.dbState(),
      persistent: src.persistent(),
    },
    status,
  };
}
