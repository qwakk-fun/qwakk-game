/**
 * Deploy smoke test: matchmaking over HTTP(S), then the room WebSocket, then
 * the first state patch, then leave. Proves the proxy, WebSocket upgrade and
 * TLS are wired. It joins as a real player named "smoke" for about a second.
 *
 * Usage (from the repo root, after npm ci):
 *   node --disable-warning=ExperimentalWarning deploy/smoke/join.ts wss://play.qwakk.fun
 *   node --disable-warning=ExperimentalWarning deploy/smoke/join.ts ws://localhost:2597
 */
import { Client } from '@colyseus/sdk';
import { ROOM } from '@qwakk/shared';

const endpoint = process.argv[2] ?? 'ws://localhost:2567';
const t0 = performance.now();
const ms = () => `${(performance.now() - t0).toFixed(0)} ms`;

const timeout = setTimeout(() => {
  console.error(`FAIL: no state from ${endpoint} within 10 s`);
  process.exit(1);
}, 10_000);

try {
  const room = await new Client(endpoint).joinOrCreate(ROOM.name, { name: 'smoke' });
  console.log(`joined room ${room.roomId} as ${room.sessionId} after ${ms()}`);
  await new Promise<void>((resolve) => room.onStateChange.once(() => resolve()));
  console.log(`first state patch after ${ms()}`);
  await room.leave(true);
  clearTimeout(timeout);
  console.log(`OK ${endpoint}`);
  process.exit(0);
} catch (err) {
  console.error(`FAIL: ${endpoint}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
