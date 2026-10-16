/**
 * Battle royale benchmark: the real server on port 2598, N network clients
 * in one `br` room (server bots fill the rest of the 16 seats). The clients
 * jump out of the plane at random times, then run around, fire bursts and
 * press Use. Measures per-client bandwidth (WebSocket payload), how many
 * enemy poses a client actually receives (line-of-sight culling), and the
 * server's tick time, CPU, memory and visibility work.
 *
 * Usage: npm run bench:br            (4 clients, 60 s measured after the drop)
 *        npm run bench:br -- 8 90    (clients, seconds)
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Client, type Room } from '@colyseus/sdk';
import { BR, Button, TICK_RATE } from '@qwakk/shared';
import { IslandState, MatchPhase } from '@qwakk/shared/net';

const PORT = 2598;
const clients = Number(process.argv[2] ?? 4);
const seconds = Number(process.argv[3] ?? 60);

interface Stats {
  players: number;
  ticks: number;
  tickAvgMs: number;
  tickP95Ms: number;
  tickMaxMs: number;
  patchAvgMs: number;
  patchP95Ms: number;
  cpuPct: number;
  rssMb: number;
  visPairs: number;
  visRays: number;
}

interface Counter {
  down: number;
  up: number;
  poseSamples: number;
  poseSum: number;
  othersSum: number;
}

function payloadSize(data: unknown): number {
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (typeof data === 'string') return Buffer.byteLength(data);
  return 0;
}

function instrument(room: Room, c: Counter): void {
  const transport = room.connection.transport as unknown as { ws?: { addEventListener?: (t: string, f: (e: { data: unknown }) => void) => void } };
  transport.ws?.addEventListener?.('message', (e) => void (c.down += payloadSize(e.data)));
  const send = room.connection.send.bind(room.connection);
  room.connection.send = (data) => {
    c.up += payloadSize(data);
    send(data);
  };
}

/** A network player: random jump, then random running, bursts of fire, Use presses. */
function play(room: Room<any, IslandState>): () => void {
  const input = room.input<{ tick: number; mx: number; mz: number; buttons: number; yaw: number; pitch: number; vt: number }>();
  const jumpAfter = 1 + Math.random() * 12;
  let yaw = Math.random() * Math.PI * 2;
  let turn = 0;
  let mx = 0;
  let next = 0;
  let tick = 0;
  let playingSince = -1;
  const timer = setInterval(() => {
    tick++;
    const st = room.state;
    if (st.phase === MatchPhase.Playing && playingSince < 0) playingSince = tick;
    if (tick >= next) {
      next = tick + 20 + Math.floor(Math.random() * 60);
      turn = (Math.random() - 0.5) * 2.5;
      mx = Math.round(Math.random() * 2 - 1);
    }
    yaw += turn / TICK_RATE;
    let buttons = 0;
    const sincePlaying = playingSince < 0 ? -1 : (tick - playingSince) / TICK_RATE;
    if (sincePlaying > jumpAfter && tick % 2 === 0) buttons |= Button.Deploy;
    if (Math.floor(tick / 25) % 4 === 0) buttons |= Button.Fire;
    if (tick % 37 === 0) buttons |= Button.Use;
    if (tick % 3 === 0) buttons |= Button.Sprint;
    const d = input.data;
    d.tick = tick;
    d.mx = mx;
    d.mz = 1;
    d.yaw = ((yaw % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    d.pitch = -0.1;
    d.buttons = buttons;
    d.vt = Math.max(0, Math.round(room.clock.serverNow() - 130));
    input.send();
  }, 1000 / TICK_RATE);
  return () => clearInterval(timer);
}

async function main(): Promise<void> {
  const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', entry], {
    env: { ...process.env, PORT: String(PORT), QWAKK_STATS: '1', QWAKK_STATS_MS: '10000', QWAKK_BR_COUNTDOWN: '4', QWAKK_BR_MIN_HUMANS: String(clients) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const stats: Stats[] = [];
  let navReady = false;
  let buf = '';
  const ready = new Promise<void>((resolve) => {
    proc.stdout!.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.includes('[nav] navmesh ready')) navReady = true;
        if (line.includes('server listening')) resolve();
        if (line.startsWith('[stats] ')) stats.push(JSON.parse(line.slice(8)) as Stats);
      }
    });
  });
  try {
    await ready;
    // Wait for the navmesh (from the cache this is instant; a fresh build takes about a minute).
    for (let i = 0; i < 120 && !navReady; i++) await new Promise((r) => setTimeout(r, 1000));
    const client = new Client(`ws://localhost:${PORT}`);
    const rooms: Room<any, IslandState>[] = [];
    const counters: Counter[] = [];
    const stops: (() => void)[] = [];
    for (let i = 0; i < clients; i++) {
      const room = await client.joinOrCreate(BR.roomName, { name: `bench${i + 1}` }, IslandState);
      const c: Counter = { down: 0, up: 0, poseSamples: 0, poseSum: 0, othersSum: 0 };
      instrument(room, c);
      counters.push(c);
      rooms.push(room);
      stops.push(play(room));
    }
    // Countdown once all are in (4 s), boarding (3 s), the plane and the drop (about a minute).
    console.error(`[bench:br] ${clients} clients in room ${rooms[0]?.roomId}; waiting for the drop ...`);
    await new Promise((r) => setTimeout(r, 70_000));
    for (const c of counters) Object.assign(c, { down: 0, up: 0, poseSamples: 0, poseSum: 0, othersSum: 0 });
    const statsFrom = stats.length;
    const sampler = setInterval(() => {
      rooms.forEach((room, i) => {
        const c = counters[i]!;
        const st = room.state;
        let others = 0;
        for (const [id, p] of st.players) if (id !== room.sessionId && p.alive) others++; // 70 s in, everyone has left the plane
        c.poseSamples++;
        c.poseSum += st.poses.size + st.farPoses.size;
        c.othersSum += others;
      });
    }, 1000);
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, seconds * 1000));
    const elapsed = (performance.now() - t0) / 1000;
    clearInterval(sampler);
    const alive = rooms[0]?.state.alive ?? 0;
    stops.forEach((s) => s());
    await Promise.all(rooms.map((r) => r.leave(true).catch(() => undefined)));
    const use = stats.slice(statsFrom).filter((s) => s.ticks > 0);
    const avg = (k: keyof Stats) => use.reduce((n, s) => n + s[k], 0) / Math.max(1, use.length);
    const max = (k: keyof Stats) => use.reduce((n, s) => Math.max(n, s[k]), 0);
    const down = counters.reduce((n, c) => n + c.down, 0) / clients / elapsed / 1000;
    const up = counters.reduce((n, c) => n + c.up, 0) / clients / elapsed / 1000;
    const poses = counters.reduce((n, c) => n + c.poseSum / Math.max(1, c.poseSamples), 0) / clients;
    const others = counters.reduce((n, c) => n + c.othersSum / Math.max(1, c.poseSamples), 0) / clients;
    const f = (v: number, d = 2) => v.toFixed(d);
    console.log('| Clients + bots | Tick avg / p95 / max (ms) | Patch avg / p95 (ms) | Server CPU (% of 1 core) | RSS (MB) | Down per client (KB/s) | Up per client (KB/s) | Enemy poses received / enemies in the world | Visibility pairs / rays per second |');
    console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    console.log(
      `| ${clients} + ${BR.players - clients} | ${f(avg('tickAvgMs'), 3)} / ${f(max('tickP95Ms'), 3)} / ${f(max('tickMaxMs'))} | ${f(avg('patchAvgMs'), 3)} / ${f(max('patchP95Ms'), 3)} | ${f(avg('cpuPct'), 1)} | ${max('rssMb')} | ${f(down)} | ${f(up)} | ${f(poses, 1)} / ${f(others, 1)} | ${f(avg('visPairs') / 10, 0)} / ${f(avg('visRays') / 10, 0)} |`,
    );
    console.log(`\nmeasured ${f(elapsed, 0)} s after the drop, ${use.length} stats windows, ${alive} ducks alive at the end`);
  } finally {
    proc.kill('SIGINT');
    await once(proc, 'exit');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
