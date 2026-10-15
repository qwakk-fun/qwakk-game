/**
 * Dev-only network simulator: adds latency, jitter and loss to one room's
 * WebSocket, both directions. Values are round trip and split evenly.
 *
 * WebSocket runs on TCP, so a lost packet is never dropped: TCP resends it
 * and everything behind it waits (head-of-line blocking). "Loss" here models
 * exactly that: a lost message is delivered one extra round trip late and
 * holds back the messages after it. Delivery order is always preserved,
 * because the Colyseus delta decoder must see patches in order.
 *
 * Same hook points as the Colyseus SDK debug panel (`@colyseus/sdk/debug`),
 * which offers latency and jitter only.
 */
import type { Room } from '@colyseus/sdk';

export interface NetSimSettings {
  latencyMs: number;
  jitterMs: number;
  loss: number;
}

/**
 * One direction of the fake link: a FIFO with a delivery time per message and
 * a single timer for the head. Delivery order is guaranteed. (Scheduling one
 * setTimeout per message is not enough: browsers round each delay to whole
 * milliseconds, which can swap two messages due within the same millisecond.
 * A swap corrupts Colyseus' delta-encoded inputs and patches, which showed up
 * as constant prediction corrections under fake loss.)
 */
class DelayLine<T> {
  private readonly queue: { at: number; item: T }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastAt = 0;
  private readonly deliver: (item: T) => void;

  constructor(deliver: (item: T) => void) {
    this.deliver = deliver;
  }

  get busy(): boolean {
    return this.queue.length > 0;
  }

  push(item: T, delayMs: number): void {
    const at = Math.max(performance.now() + delayMs, this.lastAt);
    this.lastAt = at;
    this.queue.push({ at, item });
    if (this.timer === null) this.arm();
  }

  private arm(): void {
    const head = this.queue[0];
    if (!head) {
      this.timer = null;
      return;
    }
    this.timer = setTimeout(this.flush, Math.max(0, head.at - performance.now()));
  }

  private readonly flush = (): void => {
    const now = performance.now();
    // Deliver everything due, in order. Allow 1 ms of timer rounding.
    while (this.queue.length > 0 && this.queue[0]!.at <= now + 1) this.deliver(this.queue.shift()!.item);
    this.arm();
  };
}

export class NetSim {
  settings: NetSimSettings;

  constructor(settings: NetSimSettings) {
    this.settings = { ...settings };
  }

  get active(): boolean {
    const s = this.settings;
    return s.latencyMs > 0 || s.jitterMs > 0 || s.loss > 0;
  }

  /** One-way delay for the next message (ms): half the round trip, jitter, and a resend delay on loss. */
  private delay(): number {
    const s = this.settings;
    const base = s.latencyMs / 2;
    const jitter = s.jitterMs > 0 ? (Math.random() * 2 - 1) * (s.jitterMs / 2) : 0;
    const resend = s.loss > 0 && Math.random() < s.loss ? Math.max(s.latencyMs, 40) : 0;
    return Math.max(0, base + jitter + resend);
  }

  attach(room: Room): void {
    const transport = room.connection.transport as unknown as { events: { onmessage?: ((ev: MessageEvent) => unknown) | null } };
    const events = transport.events;
    const onmessage = events.onmessage;
    if (!onmessage) return;
    const inbound = new DelayLine<unknown>((data) => onmessage.call(transport, { data } as MessageEvent));
    events.onmessage = (ev: MessageEvent) => {
      // While messages are still queued, later ones must queue behind them.
      if (!this.active && !inbound.busy) return onmessage.call(transport, ev);
      inbound.push(ev.data instanceof ArrayBuffer ? ev.data.slice(0) : ev.data, this.active ? this.delay() : 0);
      return undefined;
    };

    const connection = room.connection;
    const send = connection.send.bind(connection);
    const outbound = new DelayLine<Uint8Array>((data) => send(data));
    connection.send = (data: Buffer | Uint8Array) => {
      if (!this.active && !outbound.busy) return send(data);
      outbound.push(new Uint8Array(data), this.active ? this.delay() : 0);
    };
  }
}
