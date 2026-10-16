/**
 * Lobby rooms, headless:
 * - the start rule (BattleRoyale): no countdown below BR.minHumans humans,
 *   countdown at BR.minHumans, back to waiting when humans drop below it,
 *   bots fill the seats and the match starts when it ends, no joins after;
 * - the matchmaking guard: join options filtered, room creation limited per
 *   IP and capped per room type, the lobby never created by clients.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { BR, createSimWorld, emptyInput, initPhysics, TICK_RATE } from '@qwakk/shared';
import { compareListings, LOBBY_ERROR, roomLabel, type RoomListing } from '@qwakk/shared/lobby';
import { BattleRoyale, DEFAULT_BR, type BrEvents } from '../src/br/battleRoyale.ts';
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

function newMatch(started?: () => void): { br: BattleRoyale; tick: (n: number) => void } {
  const br = new BattleRoyale(createSimWorld(loadSainteCanard().def), { ...DEFAULT_BR, bots: true, seed: 9, createBot: idleBot }, events(started));
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
  it('defaults: 3 humans start a 30 s countdown', () => {
    expect(BR.minHumans).toBe(3);
    expect(BR.countdownSeconds).toBe(30);
  });

  it('two humans wait: no countdown, however long they wait', () => {
    const { br, tick } = newMatch();
    br.addHuman('a', 'A');
    br.addHuman('b', 'B');
    tick(5 * TICK_RATE);
    expect(br.phase).toBe('warmup');
    expect(br.countingDown).toBe(false);
    expect(br.waitingFor).toBe(1);
    expect(br.secondsLeft).toBe(0);
  });

  it('the third human starts the countdown; dropping to two resets it; the next third starts it fresh', () => {
    const { br, tick } = newMatch();
    for (const id of ['a', 'b', 'c']) br.addHuman(id, id);
    expect(br.countingDown).toBe(true);
    expect(br.waitingFor).toBe(0);
    expect(br.secondsLeft).toBe(BR.countdownSeconds);
    tick(10 * TICK_RATE);
    expect(br.secondsLeft).toBe(BR.countdownSeconds - 10);
    // A fourth joins during the countdown: it keeps running, not restarted.
    br.addHuman('d', 'd');
    expect(br.secondsLeft).toBe(BR.countdownSeconds - 10);
    br.remove('d');
    br.remove('c');
    expect(br.countingDown).toBe(false);
    expect(br.waitingFor).toBe(1);
    tick(60 * TICK_RATE);
    expect(br.phase).toBe('warmup');
    br.addHuman('e', 'e');
    expect(br.secondsLeft).toBe(BR.countdownSeconds);
  });

  it('when the countdown ends, bots fill the seats and the match starts; nobody joins after', () => {
    let started = 0;
    const { br, tick } = newMatch(() => started++);
    for (const id of ['a', 'b', 'c']) br.addHuman(id, id);
    tick(BR.countdownSeconds * TICK_RATE - 1);
    expect(br.phase).toBe('warmup');
    tick(1);
    expect(br.phase).toBe('playing');
    expect(started).toBe(1);
    expect(br.seats.size).toBe(BR.players);
    expect(br.humans).toBe(3);
    expect(br.addHuman('late', 'Late')).toBeNull();
  });

  it('a room full of humans starts sooner', () => {
    const { br } = newMatch();
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
    expect(cleanClientOptions('br', 'lobby', { name: 'Duck', token: 't', spectate: true, maxClients: 99, countdownSeconds: 0, seed: 1 })).toEqual({ name: 'Duck', token: 't', spectate: true });
    expect(cleanClientOptions('br', 'lobby', { spectate: 'yes' })).toEqual({});
    expect(cleanClientOptions('lobby', 'lobby', { filter: { name: 'island' } })).toEqual({});
    expect(cleanClientOptions('br', 'lobby', null)).toEqual({});
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
