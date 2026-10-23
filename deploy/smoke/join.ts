/**
 * Deploy smoke test against a game server:
 *   1. GET /health
 *   2. a session: SMOKE_SESSION if set, else POST /api/session as a new guest
 *      named "smoketest" (refused with 403 when Turnstile is on)
 *   3. the lobby (room list) over the WebSocket: the three static deathmatch
 *      rooms (DM_ROOMS) must be listed, which proves the server opened them at boot
 *   4. each deathmatch room by id: matchmaking over HTTP(S), the room
 *      WebSocket, the first state patch (map id, ducks seated, bots filled), leave
 *   5. a battle royale Quick Play (joinOrCreate), first state patch, leave.
 *      SMOKE_BR=0 skips it (it opens a waiting room, which counts toward the
 *      per-IP room creation limit and closes again when the smoke test leaves).
 *      A guest session (no SMOKE_SESSION, or a guest token) must instead be
 *      refused by battle royale and Hunt Season: those modes need an account.
 *      With the game session of a signed-in duck (`qwakk.account` in the
 *      browser) as SMOKE_SESSION, the battle royale join runs as before.
 * It proves TLS, the proxy, the WebSocket upgrade, the static rooms and the
 * meta layer are wired. Each join is a real player for about a second.
 *
 * Usage (from the repo root, after npm ci):
 *   npm run smoke -- ws://localhost:2597
 *   npm run smoke -- wss://play.qwakk.fun
 *
 * With Turnstile on in production, a new guest cannot be created from a
 * script. Steps 3 to 5 then run only with SMOKE_SESSION=<token>: play once in
 * a browser, copy `token` from localStorage `qwakk.identity` (valid 24 h). It
 * is read from the environment only; never write it to a file.
 */
import { Client, type Room } from '@colyseus/sdk';
import { BR, MATCH, RAID, ROOM } from '@qwakk/shared';
import { DM_ROOMS, LOBBY_ROOM } from '@qwakk/shared/lobby';

const endpoint = (process.argv[2] ?? 'ws://localhost:2567').replace(/\/+$/, '');
const http = endpoint.replace(/^ws(s?):/, 'http$1:');
const t0 = performance.now();
const ms = () => `${(performance.now() - t0).toFixed(0)} ms`;
const fail = (msg: string): never => {
  console.error(`FAIL ${endpoint}: ${msg}`);
  process.exit(1);
};
const within = <T>(p: Promise<T>, what: string, limitMs = 8000): Promise<T> =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what}: no answer within ${limitMs} ms`)), limitMs).unref())]);

setTimeout(() => fail('no result within 45 s'), 45_000).unref();

/** The first decoded state patch (the state object holds defaults before it). */
function firstPatch(room: Room): Promise<void> {
  return within(new Promise<void>((resolve) => room.onStateChange.once(() => resolve())), `${room.roomId} first state patch`);
}

/** Wait until the room has sent `patches` more patches (bots are seated on the tick after the join). */
function patches(room: Room, count: number): Promise<void> {
  let n = 0;
  return within(
    new Promise<void>((resolve) => {
      const onPatch = (): void => {
        if (++n < count) return;
        room.onStateChange.remove(onPatch);
        resolve();
      };
      room.onStateChange(onPatch);
    }),
    `${room.roomId} state patches`,
  );
}

// The smoke test reads a few public fields only; the full schema types live in the client.
const stateOf = (room: Room): any => room.state;

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
      console.log(`OK ${endpoint} (joins skipped; set SMOKE_SESSION to test the lobby and the room joins)`);
      process.exit(0);
    }
    if (!res.ok || !s.token) fail(`/api/session answered ${res.status} ${s.error ?? ''}`);
    token = s.token!;
    console.log(`session for smoketest#${s.tag ?? '?'} after ${ms()}`);
  }

  const client = new Client(endpoint);

  // 3. The lobby lists the static deathmatch rooms.
  const lobby = await within(client.joinOrCreate(LOBBY_ROOM), 'lobby join');
  const listed = await within(
    new Promise<Map<string, { humans?: number; mode?: string }>>((resolve) => {
      lobby.onMessage('rooms', (list: { roomId?: string; metadata?: { humans?: number; mode?: string } }[]) => {
        resolve(new Map((Array.isArray(list) ? list : []).map((r) => [String(r.roomId), r.metadata ?? {}])));
      });
      lobby.onMessage('+', () => {});
      lobby.onMessage('-', () => {});
    }),
    'lobby room list',
  );
  await lobby.leave(true);
  const missing = DM_ROOMS.filter((r) => listed.get(r.id)?.mode !== 'dm').map((r) => r.id);
  if (missing.length > 0) fail(`the lobby does not list the deathmatch rooms ${missing.join(', ')} (listed: ${[...listed.keys()].join(', ') || 'none'})`);
  console.log(`lobby lists ${listed.size} rooms, deathmatch ${DM_ROOMS.map((r) => `${r.id} (${listed.get(r.id)?.humans ?? 0} humans)`).join(', ')} after ${ms()}`);

  // 4. Each deathmatch room by id.
  for (const r of DM_ROOMS) {
    const room = await within(client.joinById(r.id, { name: 'smoketest', token }), `join ${r.id}`);
    if (room.name !== ROOM.name) fail(`room ${r.id} is a "${room.name}" room, expected "${ROOM.name}"`);
    await firstPatch(room);
    await patches(room, 3);
    const st = stateOf(room);
    const seated = Number(st?.players?.size ?? 0);
    console.log(`joined ${r.id} as ${room.sessionId}: map ${st?.mapId ?? '?'} (${st?.mapHash ?? '?'}), ${seated} ducks seated after ${ms()}`);
    if (seated !== MATCH.players) console.warn(`  note: expected ${MATCH.players} ducks (humans plus bots); QWAKK_BOTS=0 or a full room explains fewer`);
    await room.leave(true);
  }

  // 5. Battle royale Quick Play.
  if (process.env.SMOKE_BR !== '0') {
    try {
      const br = await within(client.joinOrCreate(BR.roomName, { name: 'smoketest', token }), 'battle royale join');
      await firstPatch(br);
      console.log(`joined battle royale ${br.roomId}: map ${stateOf(br)?.mapId ?? '?'} after ${ms()}`);
      await br.leave(true);
      if (!process.env.SMOKE_SESSION) fail('a guest was let into battle royale');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/account/i.test(msg)) throw err;
      console.log(`battle royale refuses the guest ("${msg}") after ${ms()}`);
      // Hunt Season needs an account too.
      const raid = await client.joinOrCreate(RAID.roomName, { name: 'smoketest', token }).then(
        async (r) => { await r.leave(true); return 'joined'; },
        (e: unknown) => (e instanceof Error ? e.message : String(e)),
      );
      if (!/account/i.test(raid)) fail(`Hunt Season did not refuse the guest: ${raid}`);
      console.log(`Hunt Season refuses the guest after ${ms()}`);
    }
  }

  console.log(`OK ${endpoint}`);
  process.exit(0);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
