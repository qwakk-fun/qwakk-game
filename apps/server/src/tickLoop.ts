/**
 * Fixed-rate loop with exact tick deadlines.
 *
 * Why not Colyseus `setFixedTimestep`: it drives its accumulator from
 * `setInterval(1000 / 30)`, and Node truncates that delay to 33 ms. The loop
 * then runs 0 steps on one wake-up in a hundred and 2 steps after any late
 * wake-up. Patches are stamped with the real send time, so a patch holding 0
 * or 2 ticks of motion shows up on clients as a visible hitch in remote
 * players. Here every wake-up is aimed at the next tick's exact deadline, so
 * nearly every wake-up runs exactly one tick, followed by one patch.
 */
export class TickLoop {
  private readonly stepMs: number;
  private readonly onTicks: (firstTick: number, count: number) => void;
  private readonly maxCatchUp: number;
  private origin = 0;
  private tick = 0;
  private timer: NodeJS.Timeout | null = null;

  /**
   * @param rateHz ticks per second
   * @param onTicks called once per wake-up with the ticks due (usually 1)
   * @param maxCatchUp after a stall longer than this many ticks, skip ahead instead of fast-forwarding
   */
  constructor(rateHz: number, onTicks: (firstTick: number, count: number) => void, maxCatchUp = 5) {
    this.stepMs = 1000 / rateHz;
    this.onTicks = onTicks;
    this.maxCatchUp = maxCatchUp;
  }

  start(): void {
    this.origin = performance.now();
    this.tick = 0;
    this.schedule();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    const deadline = this.origin + (this.tick + 1) * this.stepMs;
    // Round up: Node truncates fractional delays, and waking early wastes a wake-up.
    const delay = Math.max(1, Math.ceil(deadline - performance.now()));
    this.timer = setTimeout(this.run, delay);
  }

  private readonly run = (): void => {
    const now = performance.now();
    let due = Math.floor((now - this.origin) / this.stepMs) - this.tick;
    if (due > this.maxCatchUp) {
      // Long stall (GC, host hiccup): do not fast-forward the world. Re-anchor.
      this.origin += (due - 1) * this.stepMs;
      due = 1;
    }
    if (due > 0) {
      const first = this.tick;
      this.tick += due;
      this.onTicks(first, due);
    }
    if (this.timer !== null) this.schedule();
  };
}
