/**
 * Hunt Season v3: the duck's katana and its skills, part of the shared sim
 * (stepped in stepPlayer on the client for prediction and on the server for
 * authority, exactly alike). Only a duck that carries the katana (`arms` bit
 * ARMS_KATANA, set by the Hunt Season server) ever runs any of this; the
 * deathmatch and the battle royale never set the bit, so their sims are
 * unchanged.
 *
 * What the sim decides (from input buttons only): the light combo (Fire
 * press: Slash 1, 2, 3 with combo windows and a buffered press), the heavy
 * attack (Fire held past a swing's recovery charges, the release spins), the
 * Dash (a fast lunge that moves the duck, so it must be here), the "VAK!"
 * Quack Shockwave and the Blade Storm (the ultimate, while its meter is
 * full), their cooldowns, how much each slows the duck, and the moment each
 * one lands (`lastBlade`). What the sim never decides: who is hit and how
 * hard (the server sweeps the arcs against the hunters with lag
 * compensation, raid/ on the server), and how full the ultimate's meter is
 * (the server fills it on hits and kills and writes it into the state).
 *
 * The player schema has no free fields, so the state is packed into fields
 * a katana duck does not use otherwise (documented bit map):
 *
 *   mag0 (uint8, the rifle slot's magazine; Hunt Season ducks carry no rifle)
 *     bits 0..3  BladeAct: idle, slash 1 to 3, charge, heavy, draw
 *     bit  4     a buffered Fire press (the next slash of the combo)
 *     bits 5..7  the heavy's charge (0 to 7, eighths of a full charge)
 *   res0 (uint8, the rifle slot's reserve)     ticks into the act (saturates at 255)
 *   ex   bits 0..6   Dash timer: counts down from DASH.cooldown; dashing in its first DASH.ticks
 *        bits 7..14  Quack timer: counts down from QUACK.cooldown; casting in its first QUACK.cast
 *        bits 15..18 free; 19..31 the keep (trap root, cannons: raid/root.ts, raid/man.ts)
 *   dmEnergy (uint8, the deathmatch hero's flight energy; there is no hero in Hunt Season)
 *        0..100: the Blade Storm meter (server written); 128 + n: storming, n ticks left
 *
 * Hunt Season ducks have no grenades or rockets, so `ex` bits 0..18 never
 * mean explosives for them (stepPlayer does not step the explosives of a
 * katana duck).
 */
import { MOVE, TICK_RATE } from '../constants.ts';
import { Button, type InputFrame } from '../input.ts';
import { WeaponId, weaponStats } from '../weapons.ts';
import { dcos, dsin } from '../math.ts';
import type { PlayerSim } from '../sim.ts';

/** `arms` bit of the katana (WeaponId.Katana). */
export const ARMS_KATANA = 1 << WeaponId.Katana;

/** What the blade is doing (`mag0` bits 0..3). */
export const BladeAct = {
  Idle: 0,
  Slash1: 1,
  Slash2: 2,
  Slash3: 3,
  /** Fire held past a swing: winding up the heavy spin. */
  Charge: 4,
  /** The released heavy spin. */
  Heavy: 5,
  /** Drawing the katana (from the pistol). */
  Draw: 6,
} as const;

/** One light swing of the combo, in ticks from its start (art/melee melee.json Slash_1..3 events at 30 Hz, a little forgiving). */
export interface LightSwing {
  /** The blade lands (the server sweeps the arc this tick). */
  impact: number;
  /** A (buffered) press from here on chains the next slash. */
  open: number;
  /** The swing is done: holding Fire now starts the heavy charge. */
  recover: number;
  /** The combo window shuts: back to idle, the next press starts Slash 1. */
  close: number;
  /** Forward push at the start of the swing (m/s): every cut steps into the crowd. */
  lunge: number;
}

export const BLADE = {
  light: [
    { impact: 4, open: 5, recover: 8, close: 13, lunge: 2.2 },
    { impact: 4, open: 6, recover: 9, close: 14, lunge: 2.2 },
    { impact: 9, open: 99, recover: 12, close: 16, lunge: 3.4 },
  ] as readonly LightSwing[],
  heavy: { impact: 3, recover: 15, fullCharge: 24 },
  /** Ticks to draw the katana after the pistol (Slot 1). */
  drawTicks: 8,
  /** Ground speed while swinging (before recovery), charging, spinning, in the Blade Storm (times the normal speed). */
  swingSpeed: 0.4,
  chargeSpeed: 0.55,
  heavySpeed: 0.2,
  stormSpeed: 0.85,
} as const;

/**
 * Dash: a fast lunge through enemies along the move keys (forward without
 * any), `distance` meters over `ticks` ticks shaped by the art's Dash clip
 * (melee.json dash.progress per 30 fps frame), then it carries on at run
 * speed. The duck cannot be hurt by hunters in its first `iframes` ticks
 * (server rule, from this state).
 */
export const DASH = {
  distance: 4.5,
  ticks: 6,
  iframes: 5,
  cooldown: 66,
  /** Share of the distance covered at each frame (frame 0 to 6). */
  progress: [0, 0.0426, 0.414, 0.6888, 0.8725, 0.9722, 1] as readonly number[],
} as const;

/** "VAK!" Quack Shockwave: rooted for `cast` ticks, the shockwave leaves the feet at `impact` (server: push, stagger, a little damage). */
export const QUACK = { cooldown: 240, cast: 11, impact: 7 } as const;

/** Blade Storm, the ultimate: `ticks` long, a hit pulse every `every` ticks (server), the meter's full mark. */
export const STORM = { ticks: 120, every: 6, meterFull: 100 } as const;

/** What the last stepPlayer did with the blade (a reused object; read it right after the step). */
export const BladeEvent = {
  None: 0,
  /** A light slash landed: `step` 1 to 3. */
  Slash: 1,
  /** The heavy spin landed: `charge` 0 to 1. */
  Heavy: 2,
  /** The quack shockwave left the feet. */
  Quack: 3,
  /** One pulse of the Blade Storm. */
  Storm: 4,
  /** A dash started (`step` 1) or one of its moving ticks (`step` 2) (the server sweeps the path). */
  Dash: 5,
  /** The Blade Storm started. */
  StormStart: 6,
} as const;

/** Most blade events one step can raise (a storm pulse, a quack's impact, a dash tick and a slash can all land together). */
export const BLADE_EVENTS_MAX = 4;

/**
 * What the blade did in the last step (stepPlayer clears it): up to
 * BLADE_EVENTS_MAX events, `n` of them, as parallel arrays (no allocation).
 */
export const lastBlade = {
  n: 0,
  kind: [0, 0, 0, 0] as number[],
  step: [0, 0, 0, 0] as number[],
  charge: [0, 0, 0, 0] as number[],
};

/** Clear the last step's events (stepPlayer, at the start of a step). */
export function clearBladeEvents(): void {
  lastBlade.n = 0;
}

/** True when the last step raised an event of this kind. */
export function hasBladeEvent(kind: number): boolean {
  for (let i = 0; i < lastBlade.n; i++) if (lastBlade.kind[i] === kind) return true;
  return false;
}

function emit(kind: number, step = 0, charge = 0): void {
  const i = lastBlade.n;
  if (i >= BLADE_EVENTS_MAX) return;
  lastBlade.kind[i] = kind;
  lastBlade.step[i] = step;
  lastBlade.charge[i] = charge;
  lastBlade.n = i + 1;
}

const DASH_MASK = 127;
const QUACK_SHIFT = 7;
const QUACK_MASK = 255;

const pressed = (b: number, prev: number, bit: number): boolean => (b & bit) !== 0 && (prev & bit) === 0;

export function isBladeDuck(s: { arms: number }): boolean {
  return (s.arms & ARMS_KATANA) !== 0;
}

/** The katana is the weapon in hand. */
export function bladeOut(s: { arms: number; weapon: number }): boolean {
  return s.weapon === WeaponId.Katana && (s.arms & ARMS_KATANA) !== 0;
}

export const bladeAct = (s: { mag0: number }): number => s.mag0 & 15;
export const bladeQueued = (s: { mag0: number }): boolean => (s.mag0 & 16) !== 0;
/** The heavy's charge, 0 to 1 (charging: so far; released: what it had). */
export function bladeCharge(s: { mag0: number; res0: number }): number {
  if (bladeAct(s) === BladeAct.Charge) return Math.min(1, s.res0 / BLADE.heavy.fullCharge);
  return ((s.mag0 >>> 5) & 7) / 7;
}
export const bladeTicks = (s: { res0: number }): number => s.res0;
export const dashTimer = (s: { ex: number }): number => (s.ex | 0) & DASH_MASK;
export const quackTimer = (s: { ex: number }): number => ((s.ex | 0) >>> QUACK_SHIFT) & QUACK_MASK;
/** Ticks into the dash (0 on its first tick), or -1 when not dashing. */
export function dashTick(s: { ex: number }): number {
  const t = dashTimer(s);
  return t > DASH.cooldown - DASH.ticks ? DASH.cooldown - t : -1;
}
/** Still inside the dash's invulnerable ticks (server: hunters cannot hurt the duck). */
export function dashImmune(s: { ex: number }): boolean {
  const k = dashTick(s);
  return k >= 0 && k < DASH.iframes;
}
/** Ticks into the quack cast, or -1. */
export function quackTick(s: { ex: number }): number {
  const t = quackTimer(s);
  return t > QUACK.cooldown - QUACK.cast ? QUACK.cooldown - t : -1;
}
/** Blade Storm ticks left (0: not storming). */
export function stormLeft(s: { dmEnergy: number }): number {
  return (s.dmEnergy & 128) !== 0 ? s.dmEnergy & 127 : 0;
}
/** The ultimate's meter, 0 to 100 (0 while storming). */
export function stormMeter(s: { dmEnergy: number }): number {
  return (s.dmEnergy & 128) !== 0 ? 0 : Math.min(STORM.meterFull, s.dmEnergy);
}

/** Server: fill the meter (never while storming). */
export function setStormMeter(s: { dmEnergy: number }, v: number): void {
  if ((s.dmEnergy & 128) !== 0) return;
  s.dmEnergy = Math.max(0, Math.min(STORM.meterFull, Math.floor(v)));
}

function setTimers(s: PlayerSim, dash: number, quack: number): void {
  s.ex = (((s.ex | 0) & ~(DASH_MASK | (QUACK_MASK << QUACK_SHIFT))) | (dash & DASH_MASK) | ((quack & QUACK_MASK) << QUACK_SHIFT)) >>> 0;
}

function setAct(s: PlayerSim, act: number, queued = false, charge = 0): void {
  s.mag0 = (act & 15) | (queued ? 16 : 0) | ((charge & 7) << 5);
  s.res0 = 0;
}

/** Server: arm a duck with the katana and the pistol, blade in hand, every blade state fresh (the keep's `ex` bits kept). */
export function armBlade(s: PlayerSim, meter = 0): void {
  const pistol = weaponStats(WeaponId.Pistol);
  s.arms = ARMS_KATANA | (1 << WeaponId.Pistol);
  s.weapon = WeaponId.Katana;
  s.equip = 0;
  s.cooldown = 0;
  s.reload = 0;
  s.spray = 0;
  s.mag0 = 0;
  s.res0 = 0;
  if (s.mag1 <= 0 && s.res1 <= 0) {
    s.mag1 = pistol.magSize;
    s.res1 = pistol.reserve;
  }
  s.ex = ((s.ex | 0) & ~0x7ffff) >>> 0;
  s.dmEnergy = Math.max(0, Math.min(STORM.meterFull, Math.floor(meter)));
}

/** Can the duck act at all (standing, on its feet, not manning a cannon)? */
function able(s: PlayerSim, manning: boolean): boolean {
  return s.alive === 1 && s.down === 0 && s.mode === 0 && !manning;
}

/**
 * The skills and the timers, before the movement (a dash moves the duck this
 * same tick). `manning`: at a bread cannon; `rooted`: caught in a trap (no
 * dash). Knocked, dead or at a cannon the timers still run down.
 */
export function stepBladeSkills(s: PlayerSim, input: InputFrame, manning: boolean, rooted: boolean): void {
  const b = input.buttons | 0;
  const prev = s.prevButtons | 0;
  let dash = dashTimer(s);
  let quack = quackTimer(s);
  if (dash > 0) dash--;
  if (quack > 0) quack--;
  let storm = stormLeft(s);
  if (storm > 0) {
    storm--;
    s.dmEnergy = storm > 0 ? 128 | storm : 0;
    if (storm > 0 && (STORM.ticks - storm) % STORM.every === 0) {
      emit(BladeEvent.Storm);
    }
  }
  const ok = able(s, manning);
  if (!ok && (s.dmEnergy & 128) !== 0) s.dmEnergy = 0;
  if (ok) {
    if (pressed(b, prev, Button.Storm) && storm === 0 && stormMeter(s) >= STORM.meterFull) {
      // The storm draws the katana and drops whatever the blade was doing.
      s.dmEnergy = 128 | STORM.ticks;
      s.weapon = WeaponId.Katana;
      s.equip = 0;
      s.reload = 0;
      setAct(s, BladeAct.Idle);
      emit(BladeEvent.StormStart);
    } else if (pressed(b, prev, Button.Quack) && quack === 0 && dashTick(s) < 0) {
      quack = QUACK.cooldown;
      if (bladeOut(s)) setAct(s, BladeAct.Idle);
      s.reload = 0;
    } else if (pressed(b, prev, Button.Dash) && dash === 0 && !rooted && quackTickOf(quack) < 0) {
      dash = DASH.cooldown;
      // Along the move keys, or straight ahead without any (yaw: the camera's, as the movement).
      const sy = dsin(input.yaw);
      const cy = dcos(input.yaw);
      let wx = input.mx * cy - input.mz * sy;
      let wz = -input.mx * sy - input.mz * cy;
      const len = Math.sqrt(wx * wx + wz * wz);
      if (len < 1e-3) {
        wx = -sy;
        wz = -cy;
      } else {
        wx /= len;
        wz /= len;
      }
      // The direction rides in the velocity for the dash's ticks (dashVelocity scales it).
      s.vx = wx;
      s.vz = wz;
      if (bladeOut(s) && bladeAct(s) !== BladeAct.Draw) setAct(s, BladeAct.Idle);
      emit(BladeEvent.Dash, 1);
    }
  }
  setTimers(s, dash, quack);
  if (dashTick(s) > 0 && !hasBladeEvent(BladeEvent.Dash)) emit(BladeEvent.Dash, 2);
  if (quackTick(s) === QUACK.impact) emit(BladeEvent.Quack);
}

function quackTickOf(timer: number): number {
  return timer > QUACK.cooldown - QUACK.cast ? QUACK.cooldown - timer : -1;
}

/**
 * The dash's velocity this tick (stepMovement uses it instead of walking):
 * along the direction it set out in (the velocity's direction, slid along
 * walls), at the speed the clip's progress gives. Null when not dashing.
 */
export function dashVelocity(s: PlayerSim, out: { x: number; z: number }): { x: number; z: number } | null {
  const k = dashTick(s);
  if (k < 0) return null;
  const len = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
  if (len < 1e-6) {
    out.x = 0;
    out.z = 0;
    return out;
  }
  const p = DASH.progress;
  const speed = ((p[k + 1] ?? 1) - (p[k] ?? 1)) * DASH.distance * TICK_RATE;
  out.x = (s.vx / len) * speed;
  out.z = (s.vz / len) * speed;
  return out;
}

/** Below this share of its speed along its line, the dash counts as blocked (a wall, the gate, a crate, a closed deck). */
export const DASH_BLOCKED = 0.3;

/**
 * After a dash tick's move (`want`: the velocity the dash asked for).
 * Blocked (the controller clipped the move to under DASH_BLOCKED of its
 * speed along its line, or turned it back): the dash ends on the spot, the
 * cooldown runs on, nothing carries on (the clipped leftover would otherwise
 * be scaled back up to dash speed next tick, backward off a wall). After its
 * last moving tick it carries on at run speed (then friction as usual).
 */
export function endDash(s: PlayerSim, want: { x: number; z: number }): void {
  const k = dashTick(s);
  if (k < 0) return;
  const w2 = want.x * want.x + want.z * want.z;
  if (w2 > 1e-6 && (s.vx * want.x + s.vz * want.z) / w2 < DASH_BLOCKED) {
    s.vx = 0;
    s.vz = 0;
    setTimers(s, DASH.cooldown - DASH.ticks, quackTimer(s));
    return;
  }
  if (k !== DASH.ticks - 1) return;
  const len = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
  if (len < 1e-6) return;
  s.vx = (s.vx / len) * MOVE.runSpeed;
  s.vz = (s.vz / len) * MOVE.runSpeed;
}

/** Ground speed factor from what the blade and the skills are doing (1: free). Rooted while quacking. */
export function bladeSpeedFactor(s: PlayerSim): number {
  if (quackTick(s) >= 0) return 0;
  if (stormLeft(s) > 0) return BLADE.stormSpeed;
  if (!bladeOut(s)) return 1;
  const act = bladeAct(s);
  const t = s.res0;
  if (act >= BladeAct.Slash1 && act <= BladeAct.Slash3) return t < BLADE.light[act - 1]!.recover ? BLADE.swingSpeed : 1;
  if (act === BladeAct.Charge) return BLADE.chargeSpeed;
  if (act === BladeAct.Heavy) return t < BLADE.heavy.recover ? BLADE.heavySpeed : 1;
  return 1;
}

function startSlash(s: PlayerSim, step: number): void {
  setAct(s, step);
  // A step into the cut, along the facing (the camera yaw).
  const lunge = BLADE.light[step - 1]!.lunge;
  s.vx += -dsin(s.yaw) * lunge;
  s.vz += -dcos(s.yaw) * lunge;
  const sp = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
  if (sp > MOVE.sprintSpeed) {
    s.vx *= MOVE.sprintSpeed / sp;
    s.vz *= MOVE.sprintSpeed / sp;
  }
}

/**
 * The katana, after the movement (in place of the gun's state machine while
 * it is in hand): Slot 2 takes the pistol, Slot 1 draws the katana back.
 * Returns true while the katana is the weapon in hand (the gun does not step
 * then).
 */
export function stepBlade(s: PlayerSim, input: InputFrame, manning: boolean): boolean {
  const b = input.buttons | 0;
  const prev = s.prevButtons | 0;
  // Switching: Slot 1 draws the katana, Slot 2 the pistol (the gun's own switch never knows the katana).
  if (s.weapon !== WeaponId.Katana) {
    if (pressed(b, prev, Button.Slot1) && able(s, manning)) {
      s.weapon = WeaponId.Katana;
      s.equip = 0;
      s.reload = 0;
      s.spray = 0;
      s.cooldown = 0;
      setAct(s, BladeAct.Draw);
      return true;
    }
    return false;
  }
  if (pressed(b, prev, Button.Slot2) && (s.arms & (1 << WeaponId.Pistol)) !== 0 && stormLeft(s) === 0) {
    s.weapon = WeaponId.Pistol;
    s.equip = weaponStats(WeaponId.Pistol).equipTicks;
    s.reload = 0;
    s.spray = 0;
    s.cooldown = 0;
    setAct(s, BladeAct.Idle);
    return false;
  }
  if (s.res0 < 255) s.res0++;
  const t = s.res0;
  let act = bladeAct(s);
  const fire = (b & Button.Fire) !== 0;
  const press = pressed(b, prev, Button.Fire);
  // No swings while unable, quacking, dashing or in the storm (it spins by itself).
  if (!able(s, manning) || quackTick(s) >= 0 || dashTick(s) >= 0 || stormLeft(s) > 0) {
    if (act !== BladeAct.Idle && act !== BladeAct.Draw) setAct(s, BladeAct.Idle);
    else if (act === BladeAct.Draw && t >= BLADE.drawTicks) setAct(s, BladeAct.Idle);
    return true;
  }
  if (act === BladeAct.Draw) {
    if (t < BLADE.drawTicks) return true;
    setAct(s, BladeAct.Idle);
    act = BladeAct.Idle;
  }
  if (act === BladeAct.Idle) {
    if (press) startSlash(s, 1);
    return true;
  }
  if (act >= BladeAct.Slash1 && act <= BladeAct.Slash3) {
    const w = BLADE.light[act - 1]!;
    if (t === w.impact) {
      emit(BladeEvent.Slash, act);
    }
    let queued = bladeQueued(s);
    if (press && t > 1) {
      queued = true;
      s.mag0 |= 16;
    }
    const next = act === BladeAct.Slash3 ? 1 : act + 1;
    const chainAt = act === BladeAct.Slash3 ? w.recover : w.open;
    if (queued && t >= chainAt) {
      startSlash(s, next);
      return true;
    }
    if (t >= w.recover && fire && !queued && (prev & Button.Fire) !== 0) {
      setAct(s, BladeAct.Charge);
      return true;
    }
    if (t >= w.close) setAct(s, BladeAct.Idle);
    return true;
  }
  if (act === BladeAct.Charge) {
    if (!fire) {
      const charge = Math.min(7, Math.floor((Math.min(t, BLADE.heavy.fullCharge) * 7) / BLADE.heavy.fullCharge));
      setAct(s, BladeAct.Heavy, false, charge);
    }
    return true;
  }
  if (act === BladeAct.Heavy) {
    if (t === BLADE.heavy.impact) {
      emit(BladeEvent.Heavy, 0, ((s.mag0 >>> 5) & 7) / 7);
    }
    if (t >= BLADE.heavy.recover) {
      if (press) startSlash(s, 1);
      else setAct(s, BladeAct.Idle);
    }
    return true;
  }
  setAct(s, BladeAct.Idle);
  return true;
}

/** The pose action other ducks see (ads.ts Act.Katana and up), or 0 when the katana is not involved (the pistol in hand). */
export function bladePoseAct(s: PlayerSim): number {
  if (stormLeft(s) > 0) return 23;
  if (quackTick(s) >= 0) return 22;
  if (dashTick(s) >= 0) return 24;
  if (!bladeOut(s)) return 0;
  switch (bladeAct(s)) {
    case BladeAct.Slash1: return 17;
    case BladeAct.Slash2: return 18;
    case BladeAct.Slash3: return 19;
    case BladeAct.Charge: return 20;
    case BladeAct.Heavy: return 21;
    case BladeAct.Draw: return 25;
    default: return 16;
  }
}
