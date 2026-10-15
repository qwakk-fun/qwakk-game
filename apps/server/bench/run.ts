/**
 * Benchmark orchestrator: for each bot count, start a fresh game server
 * process with stats enabled, connect the bots, and collect server tick time,
 * patch time, CPU and per-client bandwidth. Prints a Markdown table.
 *
 * Usage: npm run bench            (8, 16 and 32 bots, 30 s each)
 *        npm run bench -- 4 8      (custom bot counts)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { runBots } from './bots.ts';

const PORT = 2599;
const MEASURE_SECONDS = 30;
const STATS_MS = 10_000;

interface Snapshot {
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
}

async function startServer(): Promise<{ proc: ChildProcess; snapshots: Snapshot[] }> {
  const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
  const proc = spawn(process.execPath, [entry], {
    env: { ...process.env, PORT: String(PORT), QWAKK_STATS: '1', QWAKK_STATS_MS: String(STATS_MS) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const snapshots: Snapshot[] = [];
  let ready: () => void;
  const readyP = new Promise<void>((r) => (ready = r));
  let buffer = '';
  proc.stdout!.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.includes('server listening')) ready();
      if (line.startsWith('[stats] ')) snapshots.push(JSON.parse(line.slice(8)) as Snapshot);
    }
  });
  await readyP;
  return { proc, snapshots };
}

async function benchOnce(bots: number) {
  const { proc, snapshots } = await startServer();
  // Bots run warmup + measure; the server snapshots every STATS_MS. Only snapshots
  // taken with every bot connected count.
  const result = await runBots(`ws://localhost:${PORT}`, bots, MEASURE_SECONDS, 3);
  proc.kill('SIGINT');
  await once(proc, 'exit');
  const full = snapshots.filter((s) => s.players === bots && s.ticks > 0);
  const use = full.length > 1 ? full.slice(1) : full;
  const avg = (k: keyof Snapshot) => use.reduce((n, s) => n + s[k], 0) / Math.max(1, use.length);
  const max = (k: keyof Snapshot) => use.reduce((n, s) => Math.max(n, s[k]), 0);
  return {
    bots,
    rooms: result.roomIds.length,
    snapshotsUsed: use.length,
    tickAvgMs: avg('tickAvgMs'),
    tickP95Ms: max('tickP95Ms'),
    tickMaxMs: max('tickMaxMs'),
    patchAvgMs: avg('patchAvgMs'),
    patchP95Ms: max('patchP95Ms'),
    patchMaxMs: max('patchMaxMs'),
    cpuPct: avg('cpuPct'),
    rssMb: max('rssMb'),
    downKBps: result.downBytesPerSecPerClient / 1000,
    upKBps: result.upBytesPerSecPerClient / 1000,
    downMsgsPerSec: result.downMsgsPerSecPerClient,
  };
}

const counts = process.argv.slice(2).map(Number).filter((n) => n > 0);
const plan = counts.length > 0 ? counts : [8, 16, 32];
const rows = [];
for (const n of plan) {
  console.error(`[bench] ${n} bots, ${MEASURE_SECONDS} s ...`);
  rows.push(await benchOnce(n));
}

const f = (v: number, d = 2) => v.toFixed(d);
console.log('| Bots | Tick avg / p95 / max (ms) | Patch avg / p95 / max (ms) | Server CPU (% of 1 core) | RSS (MB) | Down per client (KB/s) | Up per client (KB/s) | Patches/s |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) {
  console.log(
    `| ${r.bots} | ${f(r.tickAvgMs, 3)} / ${f(r.tickP95Ms, 3)} / ${f(r.tickMaxMs)} | ${f(r.patchAvgMs, 3)} / ${f(r.patchP95Ms, 3)} / ${f(r.patchMaxMs)} | ${f(r.cpuPct, 1)} | ${r.rssMb} | ${f(r.downKBps)} | ${f(r.upKBps)} | ${f(r.downMsgsPerSec, 1)} |`,
  );
}
console.log('\n' + JSON.stringify(rows));
process.exit(0);
