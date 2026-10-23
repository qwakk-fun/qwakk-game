/**
 * Lobby rooms, headless:
 * - the start rule (BattleRoyale): 30 s from the first human,
 *   later joins add 15 s; departures keep the timer and empty rooms reset it,
 *   bots fill the seats and the match starts when it ends, no joins after;
 * - the matchmaking guard: join options filtered, room creation limited per
 *   IP and capped per room type, the lobby never created by clients.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { BR, createSimWorld, emptyInput, initPhysics, TICK_RATE } from '@qwakk/shared';
import { compareListings, LOBBY_ERROR, roomLabel, type RoomListing } from '@qwakk/shared/lobby';
import { BattleRoyale, DEFAULT_BR, type BrEvents, type BrOptions } from '../src/br/battleRoyale.ts';
import { loadSainteCanard } from '../src/maps.ts';
import { checkCreate, cleanClientOptions, matchmakingMethod, type GuardOptions } from '../src/matchmaking.ts';

beforeAll(async () => {
  await initPhysics();
});

const noop = (): undefined => undefined;
const events = (started: () => void = noop): BrEvents => ({
  shot: noop, hit: noop, damaged: noop, kill: noop, picked: noop, result: noop, started, ended: noop,
  loot: { added: noop, changed: noop, removed: noop },
});
const idleBot = () => {
  const f = emptyInput();
  return { think: () => f, respawned: noop, damagedFrom: noop };
};

function newMatch(started?: () => void, options: Partial<BrOptions> = {}): { br: BattleRoyale; tick: (n: number) => void } {
  const br = new BattleRoyale(createSimWorld(loadSainteCanard().def), { ...DEFAULT_BR, bots: true, seed: 9, createBot: idleBot, ...options }, events(started));
  let t = 0;
  br.beginTick(0, 0);
  const tick = (n: number): void => {
    for (let i = 0; i < n; i++) {
      t++;
      br.beginTick(t, (t * 1000) / TICK_RATE);
      br.endTick();
    }
  };
  return { br, tick };
}

describe('lobby start rule', () => {
  it.each([1, 2])('starts with %i humans after the initial wait plus join extensions even when the target is 5', (humans) => {
    let started = 0;
    const { br, tick } = newMatch(() => started++, { minHumans: 5, countdownSeconds: 120 });
    for (let i = 0; i < humans; i++) br.addHuman(`h${i}`, `h${i}`);
    expect(br.countingDown).toBe(true);
    expect(br.waitingFor).toBe(0);
    const seconds = 30 + (humans - 1) * 15;
    expect(br.secondsLeft).toBe(seconds);
    tick(seconds * TICK_RATE - 1);
    expect(br.phase).toBe('warmup');
    expect(br.seats.size).toBe(humans);
    tick(1);
    expect(br.phase).toBe('playing');
    expect(started).toBe(1);
    expect(br.humans).toBe(humans);
    expect(br.seats.size).toBe(BR.players);
    expect([...br.seats.values()].filter((s) => s.bot)).toHaveLength(BR.players - humans);
    expect(br.addHuman('late', 'Late')).toBeNull();
    tick(1);
    expect(started).toBe(1);
  });

  it('a later join adds 15 s to remaining time and a departure does not change it', () => {
    const { br, tick } = newMatch(undefined, { minHumans: 5 });
    br.addHuman('a', 'A');
    tick(10 * TICK_RATE);
    br.addHuman('b', 'B');
    expect(br.secondsLeft).toBe(35);
    tick(10 * TICK_RATE);
    br.remove('a');
    expect(br.secondsLeft).toBe(25);
    expect(br.countingDown).toBe(true);
    tick(25 * TICK_RATE);
    expect(br.phase).toBe('playing');
    expect(br.humans).toBe(1);
  });

  it('an empty room does not start and the next human gets a fresh countdown', () => {
    const { br, tick } = newMatch();
    tick(60 * TICK_RATE);
    expect(br.countingDown).toBe(false);
    br.addHuman('a', 'A');
    tick(20 * TICK_RATE);
    br.remove('a');
    expect(br.countingDown).toBe(false);
    expect(br.secondsLeft).toBe(0);
    tick(60 * TICK_RATE);
    expect(br.phase).toBe('warmup');
    expect(br.seats.size).toBe(0);
    br.addHuman('b', 'B');
    expect(br.secondsLeft).toBe(30);
  });

  it('reaching the human target keeps the extension even with a shorter configured countdown', () => {
    const { br, tick } = newMatch(undefined, { minHumans: 2, countdownSeconds: 5 });
    br.addHuman('a', 'A');
    tick(20 * TICK_RATE);
    br.addHuman('b', 'B');
    expect(br.secondsLeft).toBe(25);
    br.remove('b');
    expect(br.secondsLeft).toBe(25);
    br.addHuman('c', 'C');
    expect(br.secondsLeft).toBe(40);
    tick(40 * TICK_RATE);
    expect(br.phase).toBe('playing');
  });

  it('a last-second join adds time, while a duplicate or rejected join does not', () => {
    const { br, tick } = newMatch(undefined, { minHumans: 5, players: 2 });
    br.addHuman('a', 'A');
    tick(29 * TICK_RATE);
    expect(br.addHuman('a', 'A')).toBeNull();
    expect(br.secondsLeft).toBe(1);
    br.addHuman('b', 'B');
    expect(br.secondsLeft).toBe(16);
    expect(br.addHuman('c', 'C')).toBeNull();
    expect(br.secondsLeft).toBe(16);
    tick(16 * TICK_RATE);
    expect(br.phase).toBe('playing');
  });

  it('without bots the human threshold still gates and resets the countdown', () => {
    const { br, tick } = newMatch(undefined, { bots: false, minHumans: 2, countdownSeconds: 5 });
    br.addHuman('a', 'A');
    tick(60 * TICK_RATE);
    expect(br.countingDown).toBe(false);
    expect(br.waitingFor).toBe(1);
    br.addHuman('b', 'B');
    expect(br.secondsLeft).toBe(5);
    tick(TICK_RATE);
    br.remove('b');
    expect(br.countingDown).toBe(false);
    br.addHuman('c', 'C');
    expect(br.secondsLeft).toBe(5);
    tick(5 * TICK_RATE);
    expect(br.phase).toBe('playing');
    expect(br.seats.size).toBe(2);
  });

  it('when the countdown ends, bots fill the seats and the match starts; nobody joins after', () => {
    let started = 0;
    const { br, tick } = newMatch(() => started++);
    for (const id of ['a', 'b', 'c']) br.addHuman(id, id);
    tick((BR.initialWaitSeconds + 2 * BR.joinExtraSeconds) * TICK_RATE - 1);
    expect(br.phase).toBe('warmup');
    tick(1);
    expect(br.phase).toBe('playing');
    expect(started).toBe(1);
    expect(br.seats.size).toBe(BR.players);
    expect(br.humans).toBe(3);
    expect(br.addHuman('late', 'Late')).toBeNull();
  });

  it('even the last seat adds 15 s in a bot room', () => {
    const { br } = newMatch();
    for (let i = 0; i < BR.players; i++) br.addHuman(`h${i}`, `h${i}`);
    expect(br.secondsLeft).toBe(30 + (BR.players - 1) * 15);
  });

  it('without bots a room full of humans starts sooner', () => {
    const { br } = newMatch(undefined, { bots: false });
    for (let i = 0; i < BR.players; i++) br.addHuman(`h${i}`, `h${i}`);
    expect(br.secondsLeft).toBe(BR.fullCountdownSeconds);
  });
});

describe('lobby listing helpers', () => {
  it('labels are stable and friendly', () => {
    expect(roomLabel('abc123xyz')).toBe(roomLabel('abc123xyz'));
    expect(roomLabel('abc123xyz')).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  it('orders rooms: counting down, then waiting (fullest first), then in progress', () => {
    const r = (stage: RoomListing['stage'], humans: number): RoomListing => ({ label: '', stage, humans, cap: 16, need: 0, left: 0 });
    const list = [r('playing', 9), r('waiting', 1), r('countdown', 3), r('waiting', 2), r('ended', 4)];
    expect(list.sort(compareListings).map((x) => `${x.stage}${x.humans}`)).toEqual(['countdown3', 'waiting2', 'waiting1', 'playing9', 'ended4']);
  });
});

describe('matchmaking guard', () => {
  it('keeps only the join options rooms read', () => {
    expect(cleanClientOptions('br', 'lobby', { name: 'Duck', token: 't', spectate: true, maxClients: 99, countdownSeconds: 0, seed: 1 }, true)).toEqual({ name: 'Duck', token: 't', spectate: true });
    // A room without spectators never gets the flag (it would skip the admission checks).
    expect(cleanClientOptions('br', 'lobby', { name: 'Duck', spectate: true })).toEqual({ name: 'Duck' });
    expect(cleanClientOptions('br', 'lobby', { spectate: 'yes' })).toEqual({});
    expect(cleanClientOptions('lobby', 'lobby', { filter: { name: 'island' } })).toEqual({});
    expect(cleanClientOptions('br', 'lobby', null)).toEqual({});
  });

  it('keeps a picked duck only when it is in the catalog', () => {
    expect(cleanClientOptions('island', 'lobby', { name: 'Duck', character: 1 })).toEqual({ name: 'Duck', character: 1 });
    expect(cleanClientOptions('br', 'lobby', { character: 0 })).toEqual({ character: 0 });
    for (const bad of [2, -1, 1.5, '1', 'mallard', null, { id: 1 }, [1], Number.NaN, 1e9]) {
      expect(cleanClientOptions('island', 'lobby', { character: bad })).toEqual({});
    }
    expect(cleanClientOptions('lobby', 'lobby', { character: 1 })).toEqual({});
  });

  function guard(rooms: number, open: boolean, allow: boolean): GuardOptions & { creates: string[] } {
    const creates: string[] = [];
    return {
      creates,
      maxRooms: { br: 3 },
      noCreate: ['lobby'],
      countRooms: async () => rooms,
      hasOpenRoom: async () => open,
      allowCreate: (ip) => {
        creates.push(ip);
        return allow;
      },
      ipOf: () => '1.2.3.4',
    };
  }

  const code = async (p: Promise<void>): Promise<number> => {
    try {
      await p;
      return 0;
    } catch (err) {
      return (err as { code: number }).code;
    }
  };

  it('limits room creation per IP and caps the rooms open', async () => {
    expect(await code(checkCreate('create', 'br', '1.2.3.4', guard(0, false, true)))).toBe(0);
    expect(await code(checkCreate('create', 'br', '1.2.3.4', guard(0, false, false)))).toBe(LOBBY_ERROR.createLimited);
    const full = guard(3, false, true);
    expect(await code(checkCreate('create', 'br', '1.2.3.4', full))).toBe(LOBBY_ERROR.roomsFull);
    expect(full.creates).toEqual([]); // the cap is checked first and does not spend a token
  });

  it('Quick Play into an open room is never a create', async () => {
    const g = guard(3, true, false);
    expect(await code(checkCreate('joinOrCreate', 'br', '1.2.3.4', g))).toBe(0);
    expect(g.creates).toEqual([]);
    expect(await code(checkCreate('joinOrCreate', 'br', '1.2.3.4', guard(0, false, false)))).toBe(LOBBY_ERROR.createLimited);
    expect(await code(checkCreate('joinById', 'br', '1.2.3.4', guard(3, false, false)))).toBe(0);
  });

  it('static deathmatch rooms are join only: create is refused, Quick Play only joins', async () => {
    const g = { ...guard(0, false, true), joinOnly: ['island'] };
    expect(await code(checkCreate('create', 'island', '1.2.3.4', g))).toBe(LOBBY_ERROR.roomsFull);
    expect(await code(checkCreate('joinOrCreate', 'island', '1.2.3.4', g))).toBe(0);
    expect(g.creates).toEqual([]);
    expect(matchmakingMethod('joinOrCreate', 'island', g)).toBe('join');
    expect(matchmakingMethod('joinById', 'island', g)).toBe('joinById');
    expect(matchmakingMethod('joinOrCreate', 'br', g)).toBe('joinOrCreate');
  });

  it('clients cannot create lobbies', async () => {
    expect(await code(checkCreate('create', 'lobby', '1.2.3.4', guard(0, false, true)))).toBe(LOBBY_ERROR.roomsFull);
    expect(await code(checkCreate('joinOrCreate', 'lobby', '1.2.3.4', guard(0, false, false)))).toBe(0);
  });
});
