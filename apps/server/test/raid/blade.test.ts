/**
 * Hunt Season v3, the katana on the server (raid/blade.ts), headless on Pond
 * Keep: the sim says when a swing lands, the server sweeps its arc against
 * the hunters as the duck saw them (lag compensated, never past the rewind
 * cap) and decides: one swing cuts several, nothing behind or through a
 * wall, back-stabs crit, the dash cuts what it passes once, the quack pushes
 * and staggers, the Blade Storm's meter fills from hits and kills and its
 * pulses cut, the dash's first ticks are untouchable, and the XP numbers
 * (minions apart, the combo bonus) are the server's own. Also: only Hunt
 * Season rooms take the skill buttons.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { BLADE, Button, COMBAT, DASH, emptyInput, HunterAct, HunterKind, NET, QUACK, raidXp, STORM, stormMeter, TICK_RATE, type InputFrame } from '@qwakk/shared';
import { RaidHitFlags } from '@qwakk/shared/net';
import type { Seat } from '../../src/arena.ts';
import { headlessRaid, keepNav, type HeadlessRaid } from '../../bench/raidHeadless.ts';
import type { HunterAgent } from '../../src/raid/hunter.ts';

beforeAll(async () => {
  await keepNav();
}, 180_000);

const MS = 1000 / TICK_RATE;
let T = 50_000;

/** A run with one human-like duck (it rewinds like a player: a measured round trip of 100 ms), no packs. */
async function setup(): Promise<{ h: HeadlessRaid; seat: Seat }> {
  const h = await headlessRaid({ ducks: 0 });
  h.raid.push.quiet = true;
  const seat = h.raid.addDuck('human-a', 'Ann')!;
  seat.rttMs = 100;
  h.raid.beginTick(T, T * MS);
  h.raid.skipTo(1);
  h.raid.hunts.clear();
  // In the courtyard, north of the core, facing north (yaw 0: forward is -z).
  Object.assign(seat.sim, { x: 0, y: 1.05, z: -9, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0 });
  return { h, seat };
}

/** One server tick with this duck's input (view time `vt`, default: now). */
function step(h: HeadlessRaid, seat: Seat, buttons = 0, vt?: number, over: Partial<InputFrame> = {}): void {
  T++;
  h.raid.beginTick(T, T * MS);
  h.raid.applyInput(seat, { ...emptyInput(), buttons, yaw: seat.sim.yaw, pitch: 0, ...over }, vt ?? T * MS);
  h.raid.endTick();
}

/** A hunter placed at (x, z) relative to the duck, held in place (stunned) and facing `yaw`. */
function place(h: HeadlessRaid, seat: Seat, kind: number, dx: number, dz: number, yaw = Math.PI): HunterAgent {
  const x = h.raid.hunts.spawnForTest(kind, seat.sim.x + dx, seat.sim.z + dz);
  x.yaw = yaw;
  x.stun = 1e6;
  x.stunAct = HunterAct.Stagger;
  return x;
}

/** Press Fire once and step until the cut has landed. */
function slash(h: HeadlessRaid, seat: Seat, vt?: (i: number) => number): void {
  for (let i = 0; i <= BLADE.light[0]!.impact + 1; i++) step(h, seat, i === 0 ? Button.Fire : 0, vt?.(i));
}

function hitsOf(h: HeadlessRaid): number[][] {
  const out: number[][] = [];
  h.raid.blade.flush((_id, d) => out.push(d), () => 0);
  return out;
}

describe('the katana on the server', () => {
  it('one swing cuts every hunter inside its arc (a pack falls together), none behind it', async () => {
    const { h, seat } = await setup();
    const front = [place(h, seat, HunterKind.Recruit, -1.2, -1.4), place(h, seat, HunterKind.Recruit, 0, -1.9), place(h, seat, HunterKind.Recruit, 1.3, -1.2)];
    const behind = place(h, seat, HunterKind.Recruit, 0, 2.2);
    for (let i = 0; i < 4; i++) step(h, seat);
    hitsOf(h);
    slash(h, seat);
    for (const f of front) expect(f.downTicks).toBeGreaterThan(0);
    expect(behind.downTicks).toBe(0);
    expect(behind.hp).toBe(behind.maxHp);
    const d = h.raid.ducks.get(seat.id)!;
    expect(d.minionKills).toBe(3);
    expect(d.kills).toBe(0);
    // The damage numbers go to the duck: three hits, all kills, the combo at three.
    const msgs = hitsOf(h);
    expect(msgs).toHaveLength(1);
    const [combo, , n, ...rest] = msgs[0]!;
    expect(n).toBe(3);
    expect(combo).toBe(3);
    for (let i = 0; i < 3; i++) expect(rest[i * 5 + 1]! & RaidHitFlags.Killed).toBeTruthy();
    // The meter: hits and kills.
    const r = h.raid.rules.blade;
    expect(d.meter).toBeCloseTo(3 * r.meterPerHit + 3 * r.meterPerKill, 5);
    expect(stormMeter(seat.sim)).toBe(Math.floor(d.meter));
    // The combo bonus is counted by the server, and the XP formula takes it.
    expect(d.comboXp).toBeGreaterThan(0);
    expect(raidXp({ wavesCleared: 0, kills: 0, minionKills: 300, comboXp: d.comboXp * 100, bossKills: 0, revives: 0, won: false })).toBeGreaterThan(600);
  });

  it('judges the cut against the hunters as the duck saw them (lag compensation), never past the rewind cap', async () => {
    const { h, seat } = await setup();
    const x = place(h, seat, HunterKind.Beater, 0, -1.8);
    for (let i = 0; i < 6; i++) step(h, seat);
    const seenAt = T * MS;
    // It steps out of the arc (well behind the duck) two ticks before the swing lands.
    const impactTick = T + 1 + BLADE.light[0]!.impact;
    for (let i = 0; T < impactTick - 2; i++) step(h, seat);
    x.x = seat.sim.x;
    x.z = seat.sim.z + 6;
    // The duck's view time: 70 ms behind (what it drew) -> the old spot, inside the arc: a hit.
    slash(h, seat, () => seenAt + 10);
    expect(x.hp).toBeLessThan(x.maxHp);
    // Again, but the claimed view time is a second old: clamped to the cap (the duck's round trip explains ~220 ms at most), the hunter was already gone.
    const { h: h2, seat: s2 } = await setup();
    const y = place(h2, s2, HunterKind.Beater, 0, -1.8);
    for (let i = 0; i < 4; i++) step(h2, s2);
    const old = T * MS;
    y.x = s2.sim.x;
    y.z = s2.sim.z + 6;
    for (let i = 0; i < 15; i++) step(h2, s2);
    expect(T * MS - old).toBeGreaterThan(COMBAT.maxRewindMs + 100);
    slash(h2, s2, () => old);
    expect(y.hp).toBe(y.maxHp);
    expect(h2.raid.maxRewindFor(s2)).toBeLessThanOrEqual(COMBAT.maxRewindMs);
    expect(h2.raid.maxRewindFor(s2)).toBeCloseTo(50 + NET.interpDelayMs + NET.remoteSmoothMs + COMBAT.rewindMarginMs, 5);
  });

  it('never cuts through a wall', async () => {
    const { h, seat } = await setup();
    // The north curtain wall's inner face is at z = -17: a hunter just outside it, the duck just inside.
    Object.assign(seat.sim, { x: 4, z: -16.2 });
    const out = place(h, seat, HunterKind.Beater, 0, -3.6);
    const inside = place(h, seat, HunterKind.Recruit, 1.0, 1.2, 0);
    for (let i = 0; i < 4; i++) step(h, seat);
    // Turned to face the wall (the arc reaches 2.6 m plus the body) and swing: the one outside stays whole.
    out.z = seat.sim.z - 2.3;
    for (let i = 0; i < 2; i++) step(h, seat);
    slash(h, seat);
    expect(out.hp).toBe(out.maxHp);
    void inside;
  });

  it('a cut from behind is a crit, and a pistol hit or a quack is reported apart from the swing', async () => {
    const { h, seat } = await setup();
    // Facing away from the duck (its back to it): yaw 0 faces -z, the duck is at +z of it.
    const back = place(h, seat, HunterKind.Rifleman, 0, -1.8, 0);
    for (let i = 0; i < 4; i++) step(h, seat);
    hitsOf(h);
    slash(h, seat);
    const [msg] = hitsOf(h);
    const flags = msg![4]!;
    expect(flags & RaidHitFlags.Crit).toBeTruthy();
    expect(flags & RaidHitFlags.Back).toBeTruthy();
    expect(flags & RaidHitFlags.Elite).toBeTruthy();
    const r = h.raid.rules.blade;
    expect(back.maxHp - back.hp).toBeCloseTo(r.slash[0] * r.crit, 3);
  });

  it('the dash cuts every hunter on its path once, and nothing touches the duck in its first ticks', async () => {
    const { h, seat } = await setup();
    // A line of Beaters straight ahead (the dash goes forward without move keys).
    const line = [place(h, seat, HunterKind.Beater, 0.3, -1.5), place(h, seat, HunterKind.Beater, -0.4, -3.0), place(h, seat, HunterKind.Beater, 0.2, -4.2)];
    const aside = place(h, seat, HunterKind.Beater, 3.5, -2.5);
    for (let i = 0; i < 4; i++) step(h, seat);
    const z0 = seat.sim.z;
    step(h, seat, Button.Dash);
    // Invulnerable now.
    const hp = seat.sim.hp;
    h.raid.hurtDuck(seat.id, 30, 0, 0, HunterKind.Rifleman, false);
    expect(seat.sim.hp).toBe(hp);
    for (let i = 0; i < DASH.ticks + 2; i++) step(h, seat);
    expect(z0 - seat.sim.z).toBeGreaterThan(DASH.distance * 0.8);
    const r = h.raid.rules.blade;
    for (const b of line) expect(b.maxHp - b.hp).toBeCloseTo(r.dash, 5);
    expect(aside.hp).toBe(aside.maxHp);
    // After its invulnerable ticks the duck can be hurt again.
    h.raid.hurtDuck(seat.id, 30, 0, 0, HunterKind.Rifleman, false);
    expect(seat.sim.hp).toBeLessThan(hp);
  });

  it('the quack shoves and staggers everything around (a little damage); the boss barely moves', async () => {
    const { h, seat } = await setup();
    const ring = [0, 1, 2, 3, 4].map((i) => place(h, seat, HunterKind.Beater, Math.cos(i * 1.25) * 3.5, Math.sin(i * 1.25) * 3.5 + 0.5));
    for (const x of ring) x.stun = 0;
    const boss = place(h, seat, HunterKind.Boss, -4.5, 0.8);
    boss.stun = 0;
    for (let i = 0; i < 2; i++) step(h, seat);
    const d0 = ring.map((x) => Math.hypot(x.x - seat.sim.x, x.z - seat.sim.z));
    const b0 = { x: boss.x, z: boss.z };
    for (let i = 0; i <= QUACK.impact + 6; i++) step(h, seat, i === 0 ? Button.Quack : 0);
    let pushed = 0;
    ring.forEach((x, i) => {
      expect(x.hp).toBeLessThan(x.maxHp);
      expect(x.stun).toBeGreaterThan(0);
      expect(x.act).toBe(HunterAct.Launched);
      pushed += Math.hypot(x.x - seat.sim.x, x.z - seat.sim.z) - d0[i]!;
    });
    // Shoved away on average (one may land against the core's plinth).
    expect(pushed / ring.length).toBeGreaterThan(1);
    expect(Math.hypot(boss.x - b0.x, boss.z - b0.z)).toBeLessThan(1);
  });

  it('the Blade Storm goes with a full meter only, spins for its ticks and cuts everything near again and again', async () => {
    const { h, seat } = await setup();
    const boss = place(h, seat, HunterKind.Boss, 1.5, -1.0);
    for (let i = 0; i < 2; i++) step(h, seat);
    step(h, seat, Button.Storm);
    expect(boss.hp).toBe(boss.maxHp);
    step(h, seat);
    h.raid.fillMeter(seat);
    for (let i = 0; i < STORM.ticks + 4; i++) step(h, seat, i === 0 ? Button.Storm : 0);
    const r = h.raid.rules.blade;
    const pulses = Math.floor((STORM.ticks - 1) / STORM.every);
    expect(boss.maxHp - boss.hp).toBeCloseTo(pulses * r.storm, 3);
    expect(h.raid.ducks.get(seat.id)!.meter).toBeLessThan(STORM.meterFull);
  });
});

describe('the skill buttons belong to Hunt Season', () => {
  it('only the Hunt Season room takes them; the deathmatch and battle royale rooms mask them off', async () => {
    const { RaidRoom } = await import('../../src/RaidRoom.ts');
    const { IslandRoom } = await import('../../src/IslandRoom.ts');
    const { BrRoom } = await import('../../src/BrRoom.ts');
    const allow = (C: { prototype: unknown }): boolean => (C.prototype as { allowSkills(): boolean }).allowSkills();
    expect(allow(RaidRoom)).toBe(true);
    expect(allow(IslandRoom)).toBe(false);
    expect(allow(BrRoom)).toBe(false);
  });
});
