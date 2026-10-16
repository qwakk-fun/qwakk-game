import { beforeAll, describe, expect, it } from 'vitest';
import { createSimWorld, initPhysics } from '@qwakk/shared';
import type { BotLike } from '../src/arena.ts';
import { BattleRoyale, DEFAULT_BR, type BrEvents } from '../src/br/battleRoyale.ts';
import { brResults } from '../src/br/results.ts';
import { loadSainteCanard } from '../src/maps.ts';

beforeAll(async () => {
  await initPhysics();
});

function events(results: Map<string, number>): BrEvents {
  return {
    shot: () => undefined,
    hit: () => undefined,
    damaged: () => undefined,
    kill: () => undefined,
    picked: () => undefined,
    result: (seat, place) => void results.set(seat.id, place),
    started: () => undefined,
    ended: () => undefined,
    loot: { added: () => undefined, changed: () => undefined, removed: () => undefined },
  };
}

const noBot = (): BotLike => {
  throw new Error('no bots in this test');
};

describe('battle royale placements', () => {
  it('a duck that leaves keeps the place it had; every duck gets a unique place; only the last one wins', () => {
    const sent = new Map<string, number>();
    const br = new BattleRoyale(createSimWorld(loadSainteCanard().def), { ...DEFAULT_BR, bots: false, seed: 5, createBot: noBot }, events(sent));
    br.beginTick(0, 0);
    for (const id of ['a', 'b', 'c', 'd']) br.addHuman(id, id.toUpperCase());
    br.lock();
    br.beginTick(1, (3 + 1) * 1000);
    // B leaves mid-match: out in 4th place (4 were alive).
    br.remove('b');
    expect(br.placement.get('b')).toBe(4);
    // D dies to the zone: 3rd.
    br.worldDamage(br.seats.get('d')!, 1000);
    expect(br.placement.get('d')).toBe(3);
    // A leaves too: 2nd, and C is the last duck standing.
    br.remove('a');
    expect(br.phase).toBe('ended');
    expect(br.winner?.id).toBe('c');
    const rows = brResults(br).rows;
    const places = rows.map((r) => r.placement).sort();
    expect(places).toEqual([1, 2, 3, 4]);
    expect(rows.filter((r) => r.placement === 1).map((r) => r.seat.id)).toEqual(['c']);
    expect(Object.fromEntries(sent)).toEqual({ b: 4, d: 3, a: 2, c: 1 });
  });

  it('ducks still standing when results are read never default to a win', () => {
    const br = new BattleRoyale(createSimWorld(loadSainteCanard().def), { ...DEFAULT_BR, bots: false, seed: 6, createBot: noBot }, events(new Map()));
    br.beginTick(0, 0);
    for (const id of ['a', 'b', 'c']) br.addHuman(id, id);
    br.lock();
    br.beginTick(1, 4000);
    br.seats.get('b')!.kills = 2;
    br.remove('c');
    const rows = brResults(br).rows;
    expect(rows.map((r) => r.placement).sort()).toEqual([1, 2, 3]);
    // B (more kills) is ranked above A; only one duck holds 1st.
    expect(rows.find((r) => r.seat.id === 'b')?.placement).toBe(1);
    expect(rows.find((r) => r.seat.id === 'a')?.placement).toBe(2);
    expect(rows.find((r) => r.seat.id === 'c')?.placement).toBe(3);
  });
});
