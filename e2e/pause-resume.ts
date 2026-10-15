/**
 * Network recovery test against the real game server: a Node client runs in
 * circles, then its inputs stop (a hidden tab) or are held back and flushed
 * (a TCP stall). After each gap the server must move the player normally again
 * within 1 s, and the client must not be kicked.
 *
 * Usage: npm run test:net
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client, type Room } from '@colyseus/sdk';
import { ROOM } from '@qwakk/shared';

const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = 2596;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Scenario {
  label: string;
  kind: 'pause' | 'stall';
  seconds: number;
}

const SCENARIOS: Scenario[] = [
  { label: 'pause 0.4 s (no inputs sent)', kind: 'pause', seconds: 0.4 },
  { label: 'pause 5 s (hidden tab)', kind: 'pause', seconds: 5 },
  { label: 'stall 1 s, then burst', kind: 'stall', seconds: 1 },
  { label: 'stall 4.5 s, then burst', kind: 'stall', seconds: 4.5 },
];

async function runScenario(s: Scenario): Promise<{ ok: boolean; line: string }> {
  const room: Room = await new Client(`ws://localhost:${PORT}`).joinOrCreate(ROOM.name, { name: 'recovery' });
  await new Promise<void>((r) => room.onStateChange.once(() => r()));
  let kicked: number | null = null;
  room.onLeave((code) => (kicked = code));

  const input = room.input<{ tick: number; mx: number; mz: number; buttons: number; yaw: number; pitch: number }>();
  const send = room.connection.send.bind(room.connection);
  let held: Uint8Array[] | null = null;
  room.connection.send = (d) => (held ? held.push(new Uint8Array(d)) : send(d));

  let paused = false;
  let yaw = 0;
  const stepMs = 1000 / 30;
  const timer = setInterval(() => {
    if (paused) return;
    yaw += 0.04;
    if (yaw > Math.PI) yaw -= 2 * Math.PI;
    const d = input.data;
    d.tick = Math.max(0, Math.floor(room.clock.serverNow() / stepMs));
    d.mx = 0;
    d.mz = 1;
    d.buttons = 0;
    d.yaw = yaw;
    d.pitch = 0;
    input.send();
  }, stepMs);

  // Path length travelled per 0.5 s window, from the server's state.
  const me = () => room.state.players.get(room.sessionId);
  let last = { x: me().x, z: me().z };
  let acc = 0;
  room.onStateChange(() => {
    const p = me();
    if (!p) return;
    acc += Math.hypot(p.x - last.x, p.z - last.z);
    last = { x: p.x, z: p.z };
  });
  const windows: number[] = [];
  const sampler = setInterval(() => {
    windows.push(acc);
    acc = 0;
  }, 500);

  await sleep(2000);
  const gapStart = windows.length;
  if (s.kind === 'pause') paused = true;
  else held = [];
  await sleep(s.seconds * 1000);
  if (s.kind === 'pause') paused = false;
  else {
    const q = held ?? [];
    held = null;
    for (const m of q) send(m);
  }
  const resumeAt = windows.length;
  await sleep(4000);
  clearInterval(timer);
  clearInterval(sampler);

  // Recovered: from some window within 1 s (2 windows) after resume, every window moves >= 1 m.
  const after = windows.slice(resumeAt);
  let recoveredAt = -1;
  for (let i = 0; i <= 2 && i < after.length; i++) {
    if (after.slice(i).every((d) => d >= 1)) {
      recoveredAt = i;
      break;
    }
  }
  const ok = kicked === null && recoveredAt >= 0;
  const fmt = (a: number[]) => a.map((d) => d.toFixed(1)).join(' ');
  const line = `${ok ? 'PASS' : 'FAIL'}  ${s.label.padEnd(28)} before [${fmt(windows.slice(0, gapStart))}] gap [${fmt(windows.slice(gapStart, resumeAt))}] after [${fmt(after)}] m per 0.5 s${kicked !== null ? `, kicked with code ${kicked}` : ''}`;
  if (kicked === null) await room.leave(true);
  return { ok, line };
}

async function main(): Promise<void> {
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('server did not start')), 20000);
      server.stdout!.on('data', (c: Buffer) => {
        if (c.toString().includes('server listening')) {
          clearTimeout(t);
          resolve();
        }
      });
    });
    let failed = 0;
    for (const s of SCENARIOS) {
      const r = await runScenario(s);
      console.log(r.line);
      if (!r.ok) failed++;
      await sleep(500);
    }
    if (failed > 0) throw new Error(`${failed} recovery scenario(s) failed`);
    console.log('NET RECOVERY OK');
  } finally {
    server.kill('SIGINT');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
