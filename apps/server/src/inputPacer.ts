/**
 * Decides, per player and per tick, which steps the server simulates. Pure
 * logic over a queue, so it is unit tested without a network (test/inputPacer.test.ts).
 *
 * Rules:
 * 1. One simulated step per consumed input, so the client's prediction lines up.
 *    Never take an input from the queue that is neither simulated nor matched
 *    to a stand-in step (taking acks it).
 * 2. Credit: +1 per tick (capped), -1 per simulated step, including stand-ins.
 *    Nobody averages more than one step per tick.
 * 3. Stand-in steps: if no input has arrived for `graceTicks`, the server
 *    steps the player itself (repeating the last input for a short while,
 *    then standing still), so a stalled or lag-switching client cannot hang
 *    in mid-air. Each stand-in adds one unit of debt (capped).
 * 4. Debt is paid only by LATE inputs: inputs produced during the stall that
 *    arrive afterwards (TCP flush). Each late input is acked without a step,
 *    because a stand-in already took its place. The first input that is not
 *    late (the client paused instead of stalling, so there is no backlog)
 *    forgives the remaining debt. Inputs Colyseus drops on buffer overflow
 *    also pay debt.
 *
 * Convergence: debt is capped, and while inputs keep arriving no stand-ins are
 * added (the starve counter resets on any arrival) and every arrival either
 * lowers the debt by one or clears it. So after a resume the debt reaches 0
 * within one burst, and from then on every input is simulated at one per tick.
 */

/** The part of the Colyseus input accessor the pacer needs. */
export interface InputQueue<I> {
  readonly size: number;
  /** Inputs consumed so far, including ones dropped on buffer overflow. */
  readonly consumedCount: number;
  next(): I | undefined;
}

export interface PacedInput {
  /** The client's estimate of the server tick when it sampled this input. */
  tick: number;
}

export interface PacerOptions {
  stepMs: number;
  creditCap: number;
  graceTicks: number;
  repeatTicks: number;
  maxDebt: number;
  lateMarginMs: number;
}

export type StandIn = 'repeat' | 'idle';

export class InputPacer<I extends PacedInput> {
  credit: number;
  debt = 0;
  /** Consecutive ticks with nothing in the queue. */
  starved = 0;
  /** False until the first input is simulated (client still loading). */
  active = false;
  /** Typical input age on arrival (ms), tracking the low end. NaN until known. */
  lagMs = Number.NaN;
  /** Counters for diagnostics and stats. */
  readonly counts = { simulated: 0, standIns: 0, lateMatched: 0, overflowDropped: 0, forgiven: 0 };
  private consumed = 0;
  private readonly o: PacerOptions;

  constructor(options: PacerOptions) {
    this.o = options;
    this.credit = options.creditCap;
  }

  /**
   * Run one tick. Calls `step(input)` for each real input to simulate and
   * `standIn(kind)` for a server-made step. `nowMs` is the server clock in the
   * same timebase as the input `tick` field (ms since room start).
   */
  tick(queue: InputQueue<I>, nowMs: number, step: (input: I) => void, standIn: (kind: StandIn) => void): void {
    const o = this.o;
    this.credit = Math.min(this.credit + 1, o.creditCap);

    // Inputs the framework dropped on overflow were acked without a step.
    const overflow = queue.consumedCount - this.consumed;
    if (overflow > 0) {
      this.counts.overflowDropped += overflow;
      this.debt = Math.max(0, this.debt - overflow);
    }

    if (queue.size > 0) this.starved = 0;

    let stepped = false;
    while (this.credit >= 1) {
      const input = queue.next();
      if (input === undefined) break;
      const age = nowMs - input.tick * o.stepMs;
      if (this.debt > 0) {
        if (this.isLate(age)) {
          this.debt -= 1; // a stand-in already covered this one
          this.counts.lateMatched += 1;
          continue;
        }
        this.debt = 0; // fresh input after a pause: nothing to match
        this.counts.forgiven += 1;
      }
      this.trackLag(age);
      step(input);
      this.counts.simulated += 1;
      this.credit -= 1;
      this.active = true;
      stepped = true;
    }
    this.consumed = queue.consumedCount;

    if (!stepped && queue.size === 0 && this.active) {
      this.starved += 1;
      if (this.starved > o.graceTicks && this.credit >= 1) {
        standIn(this.starved <= o.graceTicks + o.repeatTicks ? 'repeat' : 'idle');
        this.counts.standIns += 1;
        this.credit -= 1;
        this.debt = Math.min(this.debt + 1, o.maxDebt);
      }
    }
  }

  private isLate(ageMs: number): boolean {
    const base = Number.isNaN(this.lagMs) ? 0 : this.lagMs;
    return ageMs > base + this.o.lateMarginMs;
  }

  /** Follow the floor of the input age: fall fast, rise slowly, ignore spikes. */
  private trackLag(ageMs: number): void {
    const a = Math.max(0, Math.min(ageMs, 2000));
    if (Number.isNaN(this.lagMs)) this.lagMs = a;
    else this.lagMs += (a - this.lagMs) * (a < this.lagMs ? 0.3 : 0.02);
  }
}
