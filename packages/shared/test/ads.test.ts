import { beforeAll, describe, expect, it } from 'vitest';
import {
  Act,
  actionOf,
  ADS,
  aimBlend,
  ALL_BUTTONS,
  Button,
  createPlayerSim,
  createSimWorld,
  generateMap,
  inaccuracy,
  initPhysics,
  MOVE,
  sanitizeInput,
  sanitizeInputFields,
  shotAngles,
  stepAim,
  stepPlayer,
  stepWeapon,
  terrainHeightAt,
  weaponStats,
  WeaponId,
  type InputFrame,
  type PlayerSim,
  type ShotFired,
} from '../src/index.ts';

beforeAll(async () => {
  await initPhysics();
});

const input = (buttons = 0): InputFrame => ({ seq: 0, tick: 0, mx: 0, mz: 0, buttons, yaw: 0, pitch: 0 });
const aimed = (s: PlayerSim): PlayerSim => ({ ...s, aim: ADS.inTicks });

describe('aim down sights: input', () => {
  it('the Aim button survives sanitizing; bits above it are masked off', () => {
    // Bits 14 and 15 are the deathmatch grenade and rocket slot, 16 to 18 the Hunt Season skills; everything above is masked off.
    const f = sanitizeInput({ seq: 1, tick: 0, mx: 0, mz: 0, buttons: Button.Aim | Button.Fire | (1 << 16) | (1 << 20), yaw: 0, pitch: 0 });
    expect(f?.buttons).toBe(Button.Aim | Button.Fire | Button.Dash);
    expect(ALL_BUTTONS & Button.Aim).toBe(Button.Aim);
    expect(ALL_BUTTONS & (Button.Grenade | Button.Slot3)).toBe(Button.Grenade | Button.Slot3);
    expect(ALL_BUTTONS >> 19).toBe(0);
    const g = { mx: 0, mz: 0, buttons: -1, yaw: 0, pitch: 0 };
    sanitizeInputFields(g);
    expect(g.buttons).toBe(ALL_BUTTONS);
    const junk = { mx: 0, mz: 0, buttons: Number.NaN, yaw: 0, pitch: 0 };
    sanitizeInputFields(junk);
    expect(junk.buttons).toBe(0);
  });
});

describe('aim down sights: ramp', () => {
  it('ramps in over ADS.inTicks and out faster', () => {
    const s = createPlayerSim(0, 0, 0);
    stepAim(s, input(Button.Aim));
    expect(aimBlend(s)).toBeCloseTo(1 / ADS.inTicks, 9);
    for (let i = 1; i < ADS.inTicks; i++) stepAim(s, input(Button.Aim));
    expect(aimBlend(s)).toBe(1);
    stepAim(s, input(Button.Aim));
    expect(s.aim).toBe(ADS.inTicks);
    stepAim(s, input());
    expect(s.aim).toBe(ADS.inTicks - ADS.outPerTick);
    for (let i = 0; i < ADS.inTicks; i++) stepAim(s, input());
    expect(s.aim).toBe(0);
  });

  it('cannot aim while reloading, healing, unarmed or dead', () => {
    for (const patch of [{ reload: 10 }, { heal: 10 }, { arms: 0 }, { alive: 0 }]) {
      const s = { ...aimed(createPlayerSim(0, 0, 0)), ...patch };
      stepAim(s, input(Button.Aim));
      expect(s.aim).toBe(ADS.inTicks - ADS.outPerTick);
    }
  });

  it('starting a reload drops the aim on the next tick', () => {
    const s = aimed({ ...createPlayerSim(0, 0, 0), mag0: 5, grounded: 1 });
    stepWeapon(s, input(Button.Aim | Button.Reload));
    s.prevButtons = Button.Aim | Button.Reload;
    expect(s.reload).toBeGreaterThan(0);
    stepAim(s, input(Button.Aim));
    expect(s.aim).toBeLessThan(ADS.inTicks);
  });

  it('shows as the Aim pose action past half way; reload and equip win', () => {
    const s = createPlayerSim(0, 0, 0);
    expect(actionOf(s)).toBe(Act.Idle);
    expect(actionOf({ ...s, aim: ADS.inTicks })).toBe(Act.Aim);
    expect(actionOf({ ...s, aim: 1 })).toBe(Act.Idle);
    expect(actionOf({ ...s, aim: ADS.inTicks, reload: 3 })).toBe(Act.Reload);
    expect(actionOf({ ...s, aim: ADS.inTicks, equip: 3 })).toBe(Act.Equip);
  });
});

describe('aim down sights: spread and recoil', () => {
  for (const id of [WeaponId.Rifle, WeaponId.Pistol]) {
    const w = weaponStats(id);
    it(`${w.name}: base spread, move penalty and bloom shrink by the ADS factors, air does not`, () => {
      const still = { ...createPlayerSim(0, 0, 0), grounded: 1 };
      expect(inaccuracy(w, aimed(still), 0)).toBeCloseTo(w.spreadStand * ADS.spreadScale, 12);
      expect(inaccuracy(w, aimed({ ...still, crouch: 1 }), 0)).toBeCloseTo(w.spreadCrouch * ADS.spreadScale, 12);
      const run = { ...still, vx: MOVE.runSpeed };
      const runPenalty = inaccuracy(w, run, 0) - w.spreadStand;
      expect(inaccuracy(w, aimed(run), 0)).toBeCloseTo(w.spreadStand * ADS.spreadScale + runPenalty * ADS.moveSpreadScale, 12);
      const bloom = inaccuracy(w, still, 5) - w.spreadStand;
      expect(inaccuracy(w, aimed(still), 5)).toBeCloseTo(w.spreadStand * ADS.spreadScale + bloom * ADS.fireSpreadScale, 12);
      const air = { ...still, grounded: 0 };
      expect(inaccuracy(w, aimed(air), 0) - inaccuracy(w, aimed(still), 0)).toBeCloseTo(w.spreadAir, 12);
      // Half way in, half the effect.
      expect(inaccuracy(w, { ...still, aim: ADS.inTicks / 2 }, 0)).toBeCloseTo((w.spreadStand * (1 + ADS.spreadScale)) / 2, 12);
    });
  }

  it('a shot fired at full aim carries the recoil scale, and the pattern offset shrinks by it', () => {
    const hip = { ...createPlayerSim(0, 0, 0), grounded: 1, spray: 10 };
    const ads = aimed(hip);
    // stepWeapon returns a reused object: copy each shot right away.
    const a: ShotFired = { ...(stepWeapon(hip, input(Button.Fire)) as ShotFired) };
    expect(a.recoil).toBe(1);
    const b: ShotFired = { ...(stepWeapon(ads, input(Button.Fire)) as ShotFired) };
    expect(b.recoil).toBeCloseTo(ADS.recoilScale, 12);
    expect(b.inaccuracy).toBeLessThan(a.inaccuracy);
    const hipShot: ShotFired = { ...a, inaccuracy: 0 };
    const adsShot: ShotFired = { ...b, inaccuracy: 0 };
    const base = createPlayerSim(0, 0, 0);
    const climbHip = shotAngles(base, hipShot, 1).pitch - base.pitch;
    const climbAds = shotAngles(base, adsShot, 1).pitch - base.pitch;
    expect(climbHip).toBeGreaterThan(0.01);
    expect(climbAds).toBeCloseTo(climbHip * ADS.recoilScale, 9);
  });
});

describe('aim down sights: movement', () => {
  it('caps ground speed at ADS.moveSpeed and blocks sprint; releasing gives sprint back', () => {
    const sim = createSimWorld(generateMap(1337));
    const p = createPlayerSim(-8, terrainHeightAt(sim.map.terrain, -8, 0) + 0.3, 0, Math.PI / 2);
    const step = (buttons: number, mz = 1) => stepPlayer(sim, p, { seq: 0, tick: 0, mx: 0, mz, buttons, yaw: p.yaw, pitch: 0 });
    for (let i = 0; i < 20; i++) step(0, 0);
    for (let i = 0; i < 40; i++) step(Button.Aim | Button.Sprint);
    expect(p.aim).toBe(ADS.inTicks);
    expect(Math.hypot(p.vx, p.vz)).toBeCloseTo(ADS.moveSpeed, 1);
    for (let i = 0; i < 40; i++) step(Button.Sprint);
    expect(p.aim).toBe(0);
    expect(Math.hypot(p.vx, p.vz)).toBeGreaterThan(MOVE.runSpeed);
    sim.dispose();
  });
});
