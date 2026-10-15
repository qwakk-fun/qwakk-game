/**
 * Lightweight tick and patch timing for the benchmark and for ops logging.
 * Enabled with QWAKK_STATS=1; prints one JSON line per interval.
 */

export interface StatsSnapshot {
  roomId: string;
  players: number;
  ticks: number;
  tickAvgMs: number;
  tickP95Ms: number;
  tickMaxMs: number;
  patchAvgMs: number;
  patchP95Ms: number;
  patchMaxMs: number;
  /** Whole-process CPU (user + system) as % of one core over the interval. */
  cpuPct: number;
  rssMb: number;
}

function summarize(samples: number[]): { avg: number; p95: number; max: number } {
  if (samples.length === 0) return { avg: 0, p95: 0, max: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
  return { avg: sum / sorted.length, p95, max: sorted[sorted.length - 1] ?? 0 };
}

const round = (v: number): number => Math.round(v * 1000) / 1000;

export class RoomStats {
  private ticks: number[] = [];
  private patches: number[] = [];
  private cpu = process.cpuUsage();
  private wall = performance.now();
  private timer: NodeJS.Timeout | null = null;

  private readonly roomId: string;
  private readonly playerCount: () => number;

  constructor(roomId: string, playerCount: () => number) {
    this.roomId = roomId;
    this.playerCount = playerCount;
  }

  recordTick(ms: number): void {
    this.ticks.push(ms);
  }

  recordPatch(ms: number): void {
    this.patches.push(ms);
  }

  start(intervalMs: number, sink: (s: StatsSnapshot) => void): void {
    this.reset();
    this.timer = setInterval(() => sink(this.snapshot()), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  snapshot(): StatsSnapshot {
    const t = summarize(this.ticks);
    const p = summarize(this.patches);
    const now = performance.now();
    const cpu = process.cpuUsage(this.cpu);
    const cpuPct = ((cpu.user + cpu.system) / 1000 / (now - this.wall)) * 100;
    const snap: StatsSnapshot = {
      roomId: this.roomId,
      players: this.playerCount(),
      ticks: this.ticks.length,
      tickAvgMs: round(t.avg),
      tickP95Ms: round(t.p95),
      tickMaxMs: round(t.max),
      patchAvgMs: round(p.avg),
      patchP95Ms: round(p.p95),
      patchMaxMs: round(p.max),
      cpuPct: Math.round(cpuPct * 10) / 10,
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
    };
    this.reset();
    return snap;
  }

  private reset(): void {
    this.ticks = [];
    this.patches = [];
    this.cpu = process.cpuUsage();
    this.wall = performance.now();
  }
}
