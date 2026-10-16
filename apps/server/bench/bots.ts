/**
 * Headless bots: N fake clients join deathmatch rooms (Quick Play, or spread
 * over the given room ids) and send random inputs at the tick rate, like real
 * players would. Reports downstream and upstream payload bandwidth per client
 * (WebSocket payload bytes, excluding TCP/IP overhead) and how many other
 * ducks' poses a client holds on average (interest management and culling).
 *
 * CLI: node bench/bots.ts --bots 32 --seconds 30 --url ws://localhost:2567
 */
import { Client, type Room } from '@colyseus/sdk';
import { Button, ROOM, TICK_RATE } from '@qwakk/shared';

interface BotInput {
  tick: number;
  mx: number;
  mz: number;
  buttons: number;
  yaw: number;
  pitch: number;
  vt: number;
}

export interface BotResult {
  bots: number;
  seconds: number;
  downBytesPerSecPerClient: number;
  upBytesPerSecPerClient: number;
  downMsgsPerSecPerClient: number;
  /** Other ducks' pose entries a client held (sampled every second), and other ducks in its room. */
  posesHeld: number;
  othersInRoom: number;
  roomIds: string[];
}

interface Counter {
  down: number;
  up: number;
  msgs: number;
  poseSamples: number;
  poseSum: number;
  othersSum: number;
}

function payloadSize(data: unknown): number {
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (typeof data === 'string') return Buffer.byteLength(data);
  if (Array.isArray(data)) return data.reduce((n: number, d: unknown) => n + payloadSize(d), 0);
  return 0;
}

/** Count payload bytes on the bot's socket without touching the SDK's own handlers. */
function instrument(room: Room, counter: Counter): void {
  const transport = room.connection.transport as unknown as { ws?: { addEventListener?: (t: string, f: (e: { data: unknown }) => void) => void } };
  transport.ws?.addEventListener?.('message', (e) => {
    counter.down += payloadSize(e.data);
    counter.msgs += 1;
  });
  const send = room.connection.send.bind(room.connection);
  room.connection.send = (data) => {
    counter.up += payloadSize(data);
    send(data);
  };
}

class Bot {
  private yaw = Math.random() * Math.PI * 2;
  private turn = 0;
  private mx = 0;
  private mz = 1;
  private buttons = 0;
  private nextChange = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly room: Room;
  private readonly input: ReturnType<Room['input']>;

  constructor(room: Room) {
    this.room = room;
    this.input = room.input<BotInput>();
  }

  start(): void {
    let tick = 0;
    this.timer = setInterval(() => {
      tick += 1;
      if (tick >= this.nextChange) this.change(tick);
      this.yaw += this.turn / TICK_RATE;
      const d = this.input.data as BotInput;
      d.tick = tick;
      d.mx = this.mx;
      d.mz = this.mz;
      d.yaw = ((this.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
      d.pitch = Math.sin(tick * 0.05) * 0.3;
      // Jump is a short press so the edge detector sees it.
      // Fire in bursts about a third of the time, like players in a fight.
      const firing = Math.floor(tick / 20) % 3 === 0;
      d.buttons = this.buttons | (tick % 47 === 0 ? Button.Jump : 0) | (firing ? Button.Fire : 0) | (tick % 200 === 0 ? Button.Reload : 0);
      d.vt = Math.max(0, Math.round(this.room.clock.serverNow() - 130));
      this.input.send();
    }, 1000 / TICK_RATE);
  }

  private change(tick: number): void {
    this.nextChange = tick + 15 + Math.floor(Math.random() * 60);
    this.mx = Math.round(Math.random() * 2 - 1);
    this.mz = Math.random() < 0.75 ? 1 : Math.round(Math.random() * 2 - 1);
    this.turn = (Math.random() - 0.5) * 3;
    this.buttons = (Math.random() < 0.4 ? Button.Sprint : 0) | (Math.random() < 0.1 ? Button.Crouch : 0);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.room.leave(true).catch(() => undefined);
  }
}

/** `rooms`: join these room ids round robin (joinById); empty: Quick Play (the busiest open room). */
export async function runBots(url: string, count: number, seconds: number, warmupSeconds = 3, rooms: readonly string[] = []): Promise<BotResult> {
  const client = new Client(url);
  const counters: Counter[] = [];
  const bots: Bot[] = [];
  const sampled: { room: Room; counter: Counter }[] = [];
  const roomIds = new Set<string>();
  for (let i = 0; i < count; i++) {
    const target = rooms[i % Math.max(1, rooms.length)];
    const room = target ? await client.joinById(target, { name: `bot${i + 1}` }) : await client.joinOrCreate(ROOM.name, { name: `bot${i + 1}` });
    room.onMessage('*', () => {});
    roomIds.add(room.roomId);
    const counter: Counter = { down: 0, up: 0, msgs: 0, poseSamples: 0, poseSum: 0, othersSum: 0 };
    sampled.push({ room, counter });
    instrument(room, counter);
    counters.push(counter);
    const bot = new Bot(room);
    bot.start();
    bots.push(bot);
  }
  await new Promise((r) => setTimeout(r, warmupSeconds * 1000));
  for (const c of counters) {
    c.down = 0;
    c.up = 0;
    c.msgs = 0;
  }
  const t0 = performance.now();
  const sampler = setInterval(() => {
    for (const { room, counter } of sampled) {
      const st = room.state as { poses?: Map<string, unknown>; farPoses?: Map<string, unknown>; players?: Map<string, unknown> } | undefined;
      counter.poseSamples++;
      counter.poseSum += (st?.poses?.size ?? 0) + (st?.farPoses?.size ?? 0);
      counter.othersSum += Math.max(0, (st?.players?.size ?? 1) - 1);
    }
  }, 1000);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  clearInterval(sampler);
  const elapsed = (performance.now() - t0) / 1000;
  const poseSamples = counters.reduce((n, c) => n + c.poseSamples, 0) || 1;
  const down = counters.reduce((n, c) => n + c.down, 0) / count / elapsed;
  const up = counters.reduce((n, c) => n + c.up, 0) / count / elapsed;
  const msgs = counters.reduce((n, c) => n + c.msgs, 0) / count / elapsed;
  await Promise.all(bots.map((b) => b.stop()));
  return {
    bots: count,
    seconds: Math.round(elapsed * 10) / 10,
    downBytesPerSecPerClient: Math.round(down),
    upBytesPerSecPerClient: Math.round(up),
    downMsgsPerSecPerClient: Math.round(msgs * 10) / 10,
    posesHeld: Math.round((counters.reduce((n, c) => n + c.poseSum, 0) / poseSamples) * 10) / 10,
    othersInRoom: Math.round((counters.reduce((n, c) => n + c.othersSum, 0) / poseSamples) * 10) / 10,
    roomIds: [...roomIds],
  };
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runBots(arg('url', 'ws://localhost:2567'), Number(arg('bots', '32')), Number(arg('seconds', '30')));
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}
