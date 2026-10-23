/**
 * Lobby rooms end to end: the real server (start rule pinned to 3 humans, a
 * short countdown for the test), `vite preview` of the test bundle, one
 * headless Chrome player and two Node players (npm run build:test first).
 *
 *   1. Node B creates a room. A Node lobby watcher sees it listed: counting down with one human.
 *   2. Chrome A (signed in: battle royale needs an account) opens the menu, picks
 *      its duck, sees the room in the live list and joins it from there. The waiting room shows the roster and the plane countdown.
 *   3. Node C picks the room from the lobby list and joins: the countdown gains 15 seconds
 *      (listed as counting down; the waiting room shows the plane timer).
 *   4. When it ends, bots fill the seats (16 ducks) and the match starts; the
 *      room is listed as in progress and a late join by id is refused.
 *   5. The three static deathmatch rooms are listed (name, 0/32) in the lobby
 *      and the menu; a menu clicks Join on one: the lobby lists 1 human there
 *      and the player is in a full room (MATCH.players ducks, the rest bots).
 *
 * Saves screenshots: room list, waiting room, countdown, list during the
 * countdown, list with the room in progress.
 *
 * Usage: npm run e2e:lobby [-- OUTDIR]
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, type Room } from '@colyseus/sdk';
import { chromium, type Page } from 'playwright';
import { BR, MATCH, ROOM } from '@qwakk/shared';
import { DM_ROOMS, LOBBY_ROOM, type RoomListing } from '@qwakk/shared/lobby';
import { IslandState, MatchPhase } from '@qwakk/shared/net';
import { accountSeed, e2eDatabase, pickDuck, seedBrowser, signUpApi } from './lib/accounts.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? join(tmpdir(), 'qwakk-shots-lobby');
mkdirSync(out, { recursive: true });
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 2567);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5173);
const COUNTDOWN_S = 10;
const server_ = `ws://localhost:${SERVER_PORT}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function run(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}): ChildProcess {
  return spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function waitForOutput(proc: ChildProcess, needle: string, timeoutMs = 30000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${needle}"`)), timeoutMs);
    const onData = (chunk: Buffer) => {
      if (chunk.toString().includes(needle)) {
        clearTimeout(timer);
        resolve();
      }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
  });
}

async function until(label: string, test: () => boolean | Promise<boolean>, timeoutMs = 30000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await test())) {
    if (Date.now() > end) throw new Error(`timeout: ${label}`);
    await sleep(100);
  }
}

interface Listed {
  name?: string;
  locked?: boolean;
  metadata: RoomListing;
}

/** A Node menu: the lobby's live list. */
async function watchLobby(): Promise<{ room: Room; rooms: Map<string, Listed> }> {
  const room = await new Client(server_).joinOrCreate(LOBBY_ROOM);
  const rooms = new Map<string, Listed>();
  room.onMessage('rooms', (list: (Listed & { roomId: string })[]) => {
    rooms.clear();
    for (const r of list) rooms.set(r.roomId, r);
  });
  room.onMessage('+', ([id, r]: [string, Listed]) => rooms.set(id, r));
  room.onMessage('-', (id: string) => rooms.delete(id));
  return { room, rooms };
}

const snap = (p: Page): Promise<{ phase: number; players: number } | null> => p.evaluate(() => (window as any).__qwakk?.snapshot() ?? null);
const text = (p: Page, sel: string): Promise<string> => p.locator(sel).first().innerText().catch(() => '');
/** The game overlay ("Click to play") stays up until the pointer is locked; hide it for the HUD shots. */
const hideOverlay = (p: Page): Promise<void> => p.evaluate(() => document.getElementById('overlay')?.classList.add('hidden'));

async function main(): Promise<void> {
  if (!existsSync(`${root}/apps/client/dist-test/index.html`)) throw new Error('Build the test client first: npm run build:test');
  const db = await e2eDatabase('lobby');
  const server = run(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], root, {
    PORT: String(SERVER_PORT),
    DATABASE_URL: db.url,
    QWAKK_TEST_HOOKS: '1',
    QWAKK_BR_COUNTDOWN: String(COUNTDOWN_S),
    // The human target must not cancel the 15-second extension on arrival.
    QWAKK_BR_MIN_HUMANS: '3',
    QWAKK_BR_SEED: '7',
  });
  const web = run(process.execPath, [`${root}/node_modules/vite/bin/vite.js`, 'preview', '--outDir', process.env.E2E_DIST ?? 'dist-test', '--port', String(WEB_PORT), '--strictPort'], `${root}/apps/client`);
  const procs = [server, web];
  const cleanup = () => procs.forEach((p) => p.exitCode === null && p.kill('SIGINT'));
  process.on('exit', cleanup);
  const rooms: Room[] = [];
  try {
    await Promise.all([waitForOutput(server, 'server listening'), waitForOutput(web, String(WEB_PORT))]);
    const lobby = await watchLobby();
    rooms.push(lobby.room);
    const listing = (id: string) => lobby.rooms.get(id)?.metadata;

    // 1. B creates a room.
    const b = await new Client(server_).create<IslandState>(BR.roomName, { name: 'NodeB' }, IslandState);
    b.onMessage('*', () => {}); // match messages (kills, shots) are not read here
    rooms.push(b);
    const id = b.roomId;
    await until('listed: solo countdown', () => listing(id)?.stage === 'countdown' && listing(id)?.need === 0 && listing(id)?.humans === 1);
    console.log(`room ${id} "${listing(id)?.label}" listed: ${JSON.stringify(listing(id))}`);

    // 2. Chrome A joins it from the menu's list.
    const browser = await chromium.launch({
      ...((process.env.E2E_BROWSER ?? 'chrome') === 'chrome' ? { channel: 'chrome' } : {}),
      headless: true,
      args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
    });
    const menuUrl = `http://localhost:${WEB_PORT}/game/?lang=en&server=${server_}&hud=0`;
    const ctxA = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } });
    await seedBrowser(ctxA, accountSeed(await signUpApi(`http://localhost:${SERVER_PORT}`, 'e2e.lobby@example.com', [['LobbyDuck', 0]])));
    const a = await ctxA.newPage();
    a.on('pageerror', (e) => console.error('[A] page error:', e.message));
    a.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.error('[A] console:', m.text()));
    await a.goto(menuUrl);
    await pickDuck(a);
    const row = a.locator(`.qm-room[data-room="${id}"]`);
    await row.waitFor({ timeout: 30000 });
    const rowText = await row.innerText();
    console.log(`menu list row: ${rowText.replace(/\s+/g, ' ')}`);
    if (!(await row.getAttribute('class'))?.includes('is-countdown') || !rowText.includes('1/16')) throw new Error('the room row does not show 1/16 and a countdown');
    await sleep(600);
    await a.screenshot({ path: `${out}/1-room-list.png` });
    await row.locator('button').click();
    await until('A is in the room', async () => (await snap(a))?.players === 2, 60000);
    await until('waiting room panel', async () => (await text(a, '.br-lobby')).includes('NodeB'), 15000);
    const banner = await text(a, '.br-banner');
    console.log(`waiting room: ${banner.replace(/\s+/g, ' ')} | ${(await text(a, '.br-lobby')).replace(/\s+/g, ' ')}`);
    if (!banner.includes('The plane leaves in')) throw new Error('the waiting room does not show the fallback countdown');
    await until('listed: 2 humans, counting down', () => listing(id)?.humans === 2 && listing(id)?.need === 0 && listing(id)?.stage === 'countdown');
    await a.screenshot({ path: `${out}/2a-waiting-overlay.png` });
    await hideOverlay(a);
    await sleep(300);
    await a.screenshot({ path: `${out}/2-waiting-room.png` });

    // 3. C picks the room from the lobby list (the first one it can join) and joins: the countdown gains 15 seconds.
    const pick = [...lobby.rooms.entries()].find(([, r]) => r.name === BR.roomName && !r.locked && (r.metadata.stage === 'waiting' || r.metadata.stage === 'countdown'))?.[0];
    if (pick !== id) throw new Error(`C would pick ${pick}, not ${id}`);
    const c = await new Client(server_).joinById<IslandState>(pick, { name: 'NodeC' }, IslandState);
    c.onMessage('*', () => {});
    rooms.push(c);
    await until('listed: counting down', () => listing(id)?.stage === 'countdown' && listing(id)?.need === 0);
    await until('A sees the countdown', async () => (await text(a, '.br-banner')).includes('The plane leaves in'), 10000);
    await hideOverlay(a);
    await sleep(1200);
    await a.screenshot({ path: `${out}/3-countdown.png` });
    console.log(`countdown: ${(await text(a, '.br-banner')).replace(/\s+/g, ' ')}; listed ${JSON.stringify(listing(id))}`);

    // Another menu shows the countdown in the list.
    const ctxD = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } });
    await seedBrowser(ctxD, { guest: true }); // a guest: the deathmatch rooms are open to it
    const d = await ctxD.newPage();
    await d.goto(menuUrl);
    await d.locator(`.qm-room[data-room="${id}"].is-countdown`).waitFor({ timeout: 15000 });
    await sleep(400);
    await d.screenshot({ path: `${out}/4-list-countdown.png` });

    // 4. The countdown ends: bots fill the seats and the match starts.
    await until('match started', () => b.state.phase === MatchPhase.Playing, (BR.initialWaitSeconds + 2 * BR.joinExtraSeconds + 10) * 1000);
    await until('bots fill the seats', () => b.state.total === BR.players && b.state.players.size === BR.players, 5000);
    const humans = [...b.state.players.values()].filter((p) => !p.bot).length;
    console.log(`match started: ${b.state.total} ducks, ${humans} humans, ${b.state.total - humans} bots`);
    if (humans !== 3) throw new Error(`expected 3 humans, got ${humans}`);
    await until('A is in the match', async () => (await snap(a))?.phase === MatchPhase.Playing, 10000);
    await until('listed: in progress', () => listing(id)?.stage === 'playing' && lobby.rooms.get(id)?.locked === true, 10000);
    let refused = false;
    try {
      rooms.push(await new Client(server_).joinById(id, { name: 'Late' }));
    } catch {
      refused = true;
    }
    if (!refused) throw new Error('a room in progress took a late join');
    await d.locator(`.qm-room[data-room="${id}"].is-playing`).waitFor({ timeout: 10000 });
    const playingRow = await d.locator(`.qm-room[data-room="${id}"]`).innerText();
    if (!playingRow.includes('In progress')) throw new Error('the list does not show the room in progress');
    if (!(await d.locator(`.qm-room[data-room="${id}"] button`).isDisabled())) throw new Error('Join is enabled on a room in progress');
    await d.screenshot({ path: `${out}/5-list-in-progress.png` });
    await hideOverlay(a);
    await sleep(800);
    await a.screenshot({ path: `${out}/6-match-started.png` });

    // 5. The deathmatch rooms: listed with their names and 0/32, joinable from the menu.
    for (const r of DM_ROOMS) {
      const l = listing(r.id);
      if (lobby.rooms.get(r.id)?.name !== ROOM.name || l?.mode !== 'dm' || l.label !== r.label || l.humans !== 0 || l.cap !== ROOM.maxClients) throw new Error(`deathmatch room ${r.id} is not listed right: ${JSON.stringify(lobby.rooms.get(r.id))}`);
    }
    const dmId = DM_ROOMS[DM_ROOMS.length - 1]!.id;
    const dmRow = d.locator(`.qm-dm-room[data-room="${dmId}"]`);
    await dmRow.waitFor({ timeout: 10000 });
    const dmText = (await dmRow.innerText()).replace(/\s+/g, ' ');
    console.log(`deathmatch rows: ${(await d.locator('.qm-dm-rooms').innerText()).replace(/\s+/g, ' ')}`);
    if (!dmText.includes(DM_ROOMS[DM_ROOMS.length - 1]!.label) || !dmText.includes(`0/${ROOM.maxClients}`)) throw new Error(`the deathmatch row shows "${dmText}"`);
    await d.locator('.qm-dm-rooms').scrollIntoViewIfNeeded();
    await sleep(300);
    await d.screenshot({ path: `${out}/7-deathmatch-rooms.png` });
    await dmRow.locator('button').click();
    await until('listed: 1 human in the deathmatch room', () => listing(dmId)?.humans === 1, 60000);
    await until('D plays a full deathmatch room', async () => (await snap(d))?.players === MATCH.players, 60000);
    console.log(`deathmatch: joined ${dmId} from the menu, ${MATCH.players} ducks, listed ${JSON.stringify(listing(dmId))}`);
    await hideOverlay(d);
    await sleep(1500);
    await d.screenshot({ path: `${out}/8-deathmatch-joined.png` });

    await ctxA.close();
    await ctxD.close();
    await browser.close();
    console.log(`screenshots in ${out}`);
    console.log('LOBBY E2E OK');
  } finally {
    for (const r of rooms) await r.leave(true).catch(() => {});
    cleanup();
    await sleep(300);
    await db.drop().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
