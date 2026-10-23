/**
 * Runtime settings: validation and clamping, defaults and reset, the
 * environment locks, and the settings reaching the game: bot skills (live
 * objects), presets, weapon damage, deathmatch round rules at the next round,
 * ducks per room at once, spawn protection at the next spawn.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createSimWorld, DM_BOT, generateMap, initPhysics, MATCH, SPAWN_PROTECTION, TICK_RATE, WEAPONS } from '@qwakk/shared';
import { BR_SKILL } from '../../src/br/brBot.ts';
import { SKILL } from '../../src/bots.ts';
import { Deathmatch, DEFAULT_DM, type DeathmatchEvents } from '../../src/deathmatch.ts';
import { currentPreset, dmRoundRules, openDmRooms, presetValues, RuntimeSettings, serverWeapon, SETTING_DEFS, settings, spawnProtectTicks, teamModes } from '../../src/settings/index.ts';

const touched = new Set<string>();
const set = (key: string, v: unknown) => {
  touched.add(key);
  return settings.set(key, v);
};

afterEach(() => {
  for (const k of touched) settings.reset(k);
  touched.clear();
});

describe('setting validation', () => {
  const s = new RuntimeSettings(SETTING_DEFS, {});

  it('clamps numbers into range and rounds integers', () => {
    expect(s.validate('dm.players', 99)).toEqual({ ok: true, value: 32, clamped: true });
    expect(s.validate('dm.players', 1)).toEqual({ ok: true, value: 2, clamped: true });
    expect(s.validate('dm.players', 12.6)).toEqual({ ok: true, value: 13, clamped: true });
    expect(s.validate('dm.players', '16')).toEqual({ ok: true, value: 16, clamped: false });
    expect(s.validate('dm.spawnProtectionSeconds', 1.25)).toEqual({ ok: true, value: 1.25, clamped: false });
    expect(s.validate('dmBot.headChance', -1)).toEqual({ ok: true, value: 0, clamped: true });
  });

  it('refuses the wrong types and unknown keys', () => {
    expect(s.validate('dm.players', 'many')).toMatchObject({ ok: false });
    expect(s.validate('dm.players', NaN)).toMatchObject({ ok: false });
    expect(s.validate('dm.players', Infinity)).toMatchObject({ ok: false });
    expect(s.validate('dm.players', null)).toMatchObject({ ok: false });
    expect(s.validate('br.mode.duo', 1)).toMatchObject({ ok: false, error: 'expected_boolean' });
    expect(s.validate('ops.banner', 5)).toMatchObject({ ok: false, error: 'expected_text' });
    expect(s.validate('nope', 1)).toMatchObject({ ok: false, error: 'unknown_setting' });
  });

  it('cleans text: one line, no control characters, cut to length', () => {
    expect(s.validate('ops.banner', '  hello\n\tworld\u0000 ')).toEqual({ ok: true, value: 'hello world', clamped: false });
    const long = s.validate('ops.banner', 'x'.repeat(500));
    expect(long).toMatchObject({ ok: true, clamped: true });
    expect((long as { value: string }).value.length).toBe(160);
  });

  it('starts at the constants, stores only changes and resets', () => {
    const t = new RuntimeSettings(SETTING_DEFS, {});
    expect(t.num('dm.players')).toBe(MATCH.players);
    expect(t.isDefault('dm.players')).toBe(true);
    const r = t.set('dm.players', 10);
    expect(r).toMatchObject({ ok: true, value: 10, old: MATCH.players, changed: true });
    expect(t.isDefault('dm.players')).toBe(false);
    expect(t.set('dm.players', 10)).toMatchObject({ changed: false });
    expect(t.reset('dm.players')).toMatchObject({ ok: true, value: MATCH.players });
    expect(t.isDefault('dm.players')).toBe(true);
  });

  it('every default is inside its own range', () => {
    for (const d of SETTING_DEFS) {
      if (typeof d.default !== 'number') continue;
      if (d.min !== undefined) expect(d.default, d.key).toBeGreaterThanOrEqual(d.min);
      if (d.max !== undefined) expect(d.default, d.key).toBeLessThanOrEqual(d.max);
    }
  });

  it('lets an environment switch decide (tests and benchmarks)', () => {
    const t = new RuntimeSettings(SETTING_DEFS, { QWAKK_BR_MAX_ROOMS: '3', QWAKK_DM_ROOMS: '2' });
    expect(t.num('br.maxRooms')).toBe(3);
    expect(t.lockedBy('br.maxRooms')).toBe('QWAKK_BR_MAX_ROOMS');
    t.set('br.maxRooms', 1);
    expect(t.num('br.maxRooms')).toBe(3);
    expect([t.bool('dm.room.istanbul'), t.bool('dm.room.paris'), t.bool('dm.room.hongkong')]).toEqual([true, true, false]);
    // A switch reads 0 / 1 / false / true (QWAKK_DM_HERO=0 turns the caped hero off for the party e2e).
    expect(new RuntimeSettings(SETTING_DEFS, { QWAKK_DM_HERO: '0' }).bool('dm.hero')).toBe(false);
    expect(new RuntimeSettings(SETTING_DEFS, { QWAKK_DM_HERO: 'true' }).bool('dm.hero')).toBe(true);
    expect(new RuntimeSettings(SETTING_DEFS, { QWAKK_DM_HERO: 'maybe' }).bool('dm.hero')).toBe(true);
  });

  it('loads stored rows and skips bad ones', () => {
    const t = new RuntimeSettings(SETTING_DEFS, {});
    expect(t.load([{ key: 'dm.players', value: 12 }, { key: 'gone.key', value: 1 }, { key: 'br.mode.duo', value: 'x' }])).toBe(1);
    expect(t.num('dm.players')).toBe(12);
  });

  it('tells listeners about real changes only', () => {
    const t = new RuntimeSettings(SETTING_DEFS, {});
    const seen: string[] = [];
    const off = t.onChange((k, v, old) => seen.push(`${k}:${String(old)}->${String(v)}`));
    t.set('dm.scoreLimit', 20);
    t.set('dm.scoreLimit', 20);
    off();
    t.set('dm.scoreLimit', 30);
    expect(seen).toEqual(['dm.scoreLimit:50->20']);
  });
});

describe('settings reach the game', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('bot skill knobs write the live skill objects at once', () => {
    expect(SKILL.reactionTicks).toEqual(DM_BOT.reactionTicks);
    expect(SKILL.fovCos).toBeCloseTo(Math.cos((DM_BOT.fovHalfAngleDeg * Math.PI) / 180), 12);
    set('dmBot.reactionMin', 5);
    set('dmBot.reactionMax', 3); // below the minimum: the range collapses to 5..5
    set('dmBot.viewRange', 40);
    expect(SKILL.reactionTicks).toEqual([5, 5]);
    expect(SKILL.viewRange).toBe(40);
    set('brBot.headChance', 0.5);
    expect(BR_SKILL.headChance).toBe(0.5);
    expect(SKILL.headChance).toBe(DM_BOT.headChance);
  });

  it('presets set every knob; normal is the constants', () => {
    expect(currentPreset(settings, 'dmBot')).toBe('normal');
    for (const [id, v] of Object.entries(presetValues('dmBot', 'hard'))) set(`dmBot.${id}`, v);
    expect(currentPreset(settings, 'dmBot')).toBe('hard');
    expect(SKILL.reactionTicks).toEqual([8, 14]);
    set('dmBot.viewRange', 91);
    expect(currentPreset(settings, 'dmBot')).toBe('custom');
    for (const g of ['dmBot', 'brBot'] as const)
      for (const p of ['easy', 'normal', 'hard'] as const)
        for (const [id, v] of Object.entries(presetValues(g, p))) {
          const r = settings.validate(`${g}.${id}`, v);
          expect(r.ok && !r.clamped, `${g}.${id} ${p}`).toBe(true);
        }
  });

  it('weapon damage is server only and changes at once', () => {
    expect(serverWeapon(0).damage).toBe(WEAPONS[0]!.damage);
    set('weapons.rifle.damage', 40);
    set('weapons.pistol.headMultiplier', 2);
    expect(serverWeapon(0).damage).toBe(40);
    expect(serverWeapon(1).headMultiplier).toBe(2);
    expect(serverWeapon(0).fireTicks).toBe(WEAPONS[0]!.fireTicks); // the rest stays the shared numbers
    expect(WEAPONS[0]!.damage).toBe(24); // the shared table itself is untouched
  });

  it('deathmatch round rules apply at the next round', () => {
    const events: DeathmatchEvents = { shot: () => {}, hit: () => {}, damaged: () => {}, kill: () => {}, roundEnd: () => {}, roundStart: () => {} };
    const dm = new Deathmatch(createSimWorld(generateMap(1337)), { ...DEFAULT_DM, ...dmRoundRules(), rules: dmRoundRules, bots: false }, events);
    dm.addHuman('a', 'Alpha');
    expect(dm.scoreLimit).toBe(MATCH.scoreLimit);
    set('dm.scoreLimit', 7);
    set('dm.roundSeconds', 120);
    set('dm.intermissionSeconds', 3);
    expect(dm.scoreLimit).toBe(MATCH.scoreLimit); // this round keeps its rules
    dm.ticksLeft = 1;
    dm.endTick(); // round over: the break of the current round
    expect(dm.phase).toBe('intermission');
    dm.ticksLeft = 1;
    dm.endTick(); // next round starts with the new rules
    expect(dm.phase).toBe('playing');
    expect(dm.scoreLimit).toBe(7);
    expect(dm.ticksLeft).toBe(120 * TICK_RATE);
  });

  it('ducks per room change at once', () => {
    const events: DeathmatchEvents = { shot: () => {}, hit: () => {}, damaged: () => {}, kill: () => {}, roundEnd: () => {}, roundStart: () => {} };
    const dm = new Deathmatch(createSimWorld(generateMap(1337)), { ...DEFAULT_DM, bots: true }, events);
    dm.addHuman('a', 'Alpha');
    expect(dm.seats.size).toBe(MATCH.players);
    dm.setPlayers(8);
    expect(dm.seats.size).toBe(8);
    dm.setPlayers(12);
    expect(dm.seats.size).toBe(12);
    expect([...dm.seats.values()].filter((s) => !s.bot).length).toBe(1);
  });

  it('spawn protection applies at the next spawn', () => {
    expect(spawnProtectTicks()).toBe(SPAWN_PROTECTION.ticks);
    const events: DeathmatchEvents = { shot: () => {}, hit: () => {}, damaged: () => {}, kill: () => {}, roundEnd: () => {}, roundStart: () => {} };
    const dm = new Deathmatch(createSimWorld(generateMap(1337)), { ...DEFAULT_DM, bots: false }, events);
    const seat = dm.addHuman('a', 'Alpha');
    expect(seat.protect).toBe(SPAWN_PROTECTION.ticks);
    set('dm.spawnProtectionSeconds', 0);
    dm.spawn(seat);
    expect(seat.protect).toBe(0);
    set('dm.spawnProtectionSeconds', 4.5);
    dm.spawn(seat);
    expect(seat.protect).toBe(135);
  });

  it('rooms and modes follow their switches', () => {
    expect(openDmRooms()).toEqual(['istanbul']);
    set('dm.room.paris', true);
    expect(openDmRooms()).toEqual(['istanbul', 'paris']);
    set('br.mode.duo', false);
    expect(teamModes()).toEqual([1, 4]);
  });
});
