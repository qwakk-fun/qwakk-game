import { describe, expect, it } from 'vitest';
import { NET, TICK_RATE } from '@qwakk/shared';
import { InputPacer, type InputQueue, type StandIn } from '../src/inputPacer.ts';

const STEP_MS = 1000 / TICK_RATE;

interface In {
  tick: number;
  id: number;
}

/** Mirrors the Colyseus input buffer: FIFO, drops (and acks) the oldest past its size. */
class FakeQueue implements InputQueue<In> {
  items: In[] = [];
  consumedCount = 0;
  private readonly max: number;
  constructor(max = NET.maxInputBuffer) {
    this.max = max;
  }
  push(i: In): void {
    this.items.push(i);
    while (this.items.length > this.max) {
      this.items.shift();
      this.consumedCount += 1;
    }
  }
  get size(): number {
    return this.items.length;
  }
  next(): In | undefined {
    const i = this.items.shift();
    if (i) this.consumedCount += 1;
    return i;
  }
}

function makePacer(): InputPacer<In> {
  return new InputPacer<In>({
    stepMs: STEP_MS,
    creditCap: NET.maxInputCredit,
    graceTicks: NET.starveGraceTicks,
    repeatTicks: NET.standInRepeatTicks,
    maxDebt: NET.maxStandInDebt,
    lateMarginMs: NET.lateMarginMs,
  });
}

/**
 * Simulates one client and the server tick by tick. `plan(t)` says what the
 * client does at tick t: 'send' (produce and deliver), 'pause' (produce
 * nothing, a hidden tab), 'hold' (produce but hold back, a TCP stall).
 * Delivery has `latencyTicks` one-way delay.
 */
function run(ticks: number, plan: (t: number) => 'send' | 'pause' | 'hold', latencyTicks = 2) {
  const q = new FakeQueue();
  const pacer = makePacer();
  const inFlight: { at: number; input: In }[] = [];
  const held: In[] = [];
  let nextId = 0;
  const perTick: { real: number; standIns: StandIn[]; debt: number }[] = [];
  for (let t = 0; t < ticks; t++) {
    const mode = plan(t);
    if (mode !== 'pause') {
      const input = { tick: t, id: nextId++ };
      if (mode === 'hold') held.push(input);
      else {
        for (const h of held.splice(0)) inFlight.push({ at: t + latencyTicks, input: h });
        inFlight.push({ at: t + latencyTicks, input });
      }
    }
    while (inFlight.length > 0 && inFlight[0]!.at <= t) q.push(inFlight.shift()!.input);
    let real = 0;
    const standIns: StandIn[] = [];
    pacer.tick(
      q,
      t * STEP_MS,
      () => real++,
      (k) => standIns.push(k),
    );
    perTick.push({ real, standIns, debt: pacer.debt });
  }
  return { perTick, pacer, queue: q };
}

/** Ticks after `from` until the player is back to exactly one real step per tick for a whole second. */
function recoveryTicks(perTick: { real: number; standIns: StandIn[] }[], from: number): number {
  for (let t = from; t < perTick.length - TICK_RATE; t++) {
    let steady = true;
    for (let k = t; k < t + TICK_RATE; k++) if (perTick[k]!.real !== 1 || perTick[k]!.standIns.length > 0) steady = false;
    if (steady) return t - from;
  }
  return Number.POSITIVE_INFINITY;
}

describe('InputPacer', () => {
  it('steady play: one real step per tick, no stand-ins', () => {
    const { perTick } = run(300, () => 'send');
    const after = perTick.slice(10);
    expect(after.every((p) => p.real === 1 && p.standIns.length === 0)).toBe(true);
  });

  for (const [label, gap] of [
    ['short pause (0.4 s)', 12],
    ['long pause (5 s)', 150],
  ] as const) {
    it(`${label}: stand-ins during the gap, back to normal right after`, () => {
      const start = 60;
      const { perTick, pacer } = run(start + gap + 120, (t) => (t >= start && t < start + gap ? 'pause' : 'send'));
      const gapTicks = perTick.slice(start, start + gap);
      expect(gapTicks.filter((p) => p.standIns.length > 0).length).toBeGreaterThan(0);
      const resumed = start + gap + 2; // first input lands after the one-way delay
      expect(recoveryTicks(perTick, resumed)).toBeLessThanOrEqual(2);
      expect(pacer.debt).toBe(0);
    });
  }

  for (const [label, stall] of [
    ['short stall then burst (0.4 s)', 12],
    ['1 s stall then burst', 30],
    ['4.5 s stall then burst (buffer overflows)', 135],
  ] as const) {
    it(`${label}: late inputs match the stand-ins, then normal within 1 s`, () => {
      const start = 60;
      const { perTick, pacer } = run(start + stall + 150, (t) => (t >= start && t < start + stall ? 'hold' : 'send'));
      const flushed = start + stall + 2;
      expect(recoveryTicks(perTick, flushed)).toBeLessThanOrEqual(TICK_RATE);
      expect(pacer.debt).toBe(0);
      // Never more simulated steps than ticks plus the burst allowance.
      const total = perTick.reduce((n, p) => n + p.real + p.standIns.length, 0);
      expect(total).toBeLessThanOrEqual(perTick.length + NET.maxInputCredit);
    });
  }

  it('a client sending twice per tick still gets one step per tick on average', () => {
    const q = new FakeQueue();
    const pacer = makePacer();
    let steps = 0;
    for (let t = 0; t < 600; t++) {
      q.push({ tick: t, id: 2 * t });
      q.push({ tick: t, id: 2 * t + 1 });
      pacer.tick(q, t * STEP_MS, () => steps++, () => steps++);
    }
    expect(steps).toBeLessThanOrEqual(600 + NET.maxInputCredit);
  });

  it('random gaps and stalls always converge and never exceed the step budget', () => {
    let seed = 12345;
    const rand = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 4294967296;
    };
    const events: { start: number; len: number; kind: 'pause' | 'hold' }[] = [];
    let t = 60;
    while (t < 9000) {
      const len = 1 + Math.floor(rand() * 200);
      events.push({ start: t, len, kind: rand() < 0.5 ? 'pause' : 'hold' });
      t += len + 60 + Math.floor(rand() * 120);
    }
    const plan = (tick: number) => {
      for (const e of events) if (tick >= e.start && tick < e.start + e.len) return e.kind;
      return 'send' as const;
    };
    const { perTick } = run(t + 120, plan);
    for (const e of events) expect(recoveryTicks(perTick, e.start + e.len + 2)).toBeLessThanOrEqual(TICK_RATE);
    const total = perTick.reduce((n, p) => n + p.real + p.standIns.length, 0);
    expect(total).toBeLessThanOrEqual(perTick.length + NET.maxInputCredit);
  });
});
