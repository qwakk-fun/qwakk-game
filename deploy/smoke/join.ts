/**
 * Deploy smoke test against a game server:
 *   1. GET /health
 *   2. a session: SMOKE_SESSION if set, else POST /api/session as a new guest
 *      named "smoketest" (refused with 403 when Turnstile is on)
 *   3. matchmaking over HTTP(S), the room WebSocket, the first state patch, leave
 * It proves TLS, the proxy, the WebSocket upgrade and the meta layer are wired.
 * The join is a real player in the deathmatch for about a second.
 *
 * Usage (from the repo root, after npm ci):
 *   node --disable-warning=ExperimentalWarning deploy/smoke/join.ts ws://localhost:2597
 *   node --disable-warning=ExperimentalWarning deploy/smoke/join.ts wss://play.qwakk.fun
 *
 * With Turnstile on in production, a new guest cannot be created from a
 * script. Play once in a browser, copy `token` from localStorage
 * `qwakk.identity` (valid 24 h) and pass it as SMOKE_SESSION=<token>. It is
 * read from the environment only; never write it to a file.
 */
import { Client } from '@colyseus/sdk';
import { ROOM } from '@qwakk/shared';

const endpoint = (process.argv[2] ?? 'ws://localhost:2567').replace(/\/+$/, '');
const http = endpoint.replace(/^ws(s?):/, 'http$1:');
const t0 = performance.now();
const ms = () => `${(performance.now() - t0).toFixed(0)} ms`;
const fail = (msg: string): never => {
  console.error(`FAIL ${endpoint}: ${msg}`);
  process.exit(1);
};

setTimeout(() => fail('no result within 15 s'), 15_000).unref();

try {
  const health = await fetch(`${http}/health`, { signal: AbortSignal.timeout(5000) });
  const body = (await health.json().catch(() => null)) as { ok?: boolean; db?: string } | null;
  if (!health.ok || body?.ok !== true) fail(`/health answered ${health.status}`);
  console.log(`health ok (db ${body?.db ?? '?'}) after ${ms()}`);

  let token = process.env.SMOKE_SESSION?.trim() ?? '';
  if (!token) {
    const res = await fetch(`${http}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'smoketest' }),
      signal: AbortSignal.timeout(8000),
    });
    const s = (await res.json().catch(() => ({}))) as { token?: string; error?: string; tag?: string };
    if (res.status === 403 && s.error === 'turnstile_failed') {
      console.log('session API ok: Turnstile is on, so a script cannot create a guest');
      console.log(`OK ${endpoint} (join skipped; set SMOKE_SESSION to test the room join)`);
      process.exit(0);
    }
    if (!res.ok || !s.token) fail(`/api/session answered ${res.status} ${s.error ?? ''}`);
    token = s.token!;
    console.log(`session for smoketest#${s.tag ?? '?'} after ${ms()}`);
  }

  const room = await new Client(endpoint).joinOrCreate(ROOM.name, { name: 'smoketest', token });
  console.log(`joined room ${room.roomId} as ${room.sessionId} after ${ms()}`);
  await new Promise<void>((resolve) => room.onStateChange.once(() => resolve()));
  console.log(`first state patch after ${ms()}`);
  await room.leave(true);
  console.log(`OK ${endpoint}`);
  process.exit(0);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
