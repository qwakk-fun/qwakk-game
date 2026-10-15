/**
 * Server-side round-trip measurement with WebSocket ping frames. Browsers
 * answer protocol pings in the network stack, not in page script, so a client
 * cannot shape these samples from JavaScript. The estimate is the median of
 * the last five samples.
 */
import type { Client } from '@colyseus/core';

interface RawSocket {
  ping(data?: Buffer): void;
  on(event: 'pong', listener: (data: Buffer) => void): void;
  readyState: number;
}

interface Probe {
  sent: Map<number, number>;
  samples: number[];
  seq: number;
  report: (ms: number) => void;
}

export class RttProbe {
  private readonly probes = new WeakMap<object, Probe>();

  ping(client: Client, report: (ms: number) => void): void {
    const ws = (client as unknown as { ref?: RawSocket }).ref;
    if (!ws || typeof ws.ping !== 'function' || ws.readyState !== 1) return;
    let p = this.probes.get(ws);
    if (!p) {
      const probe: Probe = { sent: new Map(), samples: [], seq: 0, report };
      p = probe;
      this.probes.set(ws, probe);
      ws.on('pong', (data: Buffer) => {
        if (data.length < 4) return;
        const seq = data.readUInt32BE(0);
        const t0 = probe.sent.get(seq);
        if (t0 === undefined) return;
        probe.sent.delete(seq);
        probe.samples.push(performance.now() - t0);
        if (probe.samples.length > 5) probe.samples.shift();
        const sorted = [...probe.samples].sort((a, b) => a - b);
        probe.report(sorted[Math.floor(sorted.length / 2)] as number);
      });
    }
    p.report = report;
    // Forget pings that never came back (keeps the map small).
    for (const [seq, t] of p.sent) if (performance.now() - t > 10_000) p.sent.delete(seq);
    const seq = (p.seq = (p.seq + 1) >>> 0);
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(seq, 0);
    p.sent.set(seq, performance.now());
    ws.ping(buf);
  }
}
