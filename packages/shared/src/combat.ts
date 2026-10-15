/**
 * Weapon state machine, stepped once per tick right after movement, on both
 * the client (prediction) and the server (authority). Fire rate, ammo, reloads
 * and switching are all decided here from the input buttons, so a client can
 * only ever ask; the server's copy of this state decides.
 */
import { Button, type InputFrame } from './input.ts';
import { MOVE } from './constants.ts';
import type { PlayerSim } from './sim.ts';
import { COMBAT, weaponStats, type WeaponStats } from './weapons.ts';

/** What a step fired. Reused object: read it before the next step. */
export interface ShotFired {
  weapon: number;
  /** Index into the weapon's spray pattern for this shot. */
  sprayIndex: number;
  /** Spread cone radius for this shot (rad). */
  inaccuracy: number;
  /** Per-player shot counter after this shot; seeds the spread direction. */
  shotSeq: number;
}

const shotScratch: ShotFired = { weapon: 0, sprayIndex: 0, inaccuracy: 0, shotSeq: 0 };

function pressed(buttons: number, prev: number, bit: number): boolean {
  return (buttons & bit) !== 0 && (prev & bit) === 0;
}

export function magOf(s: PlayerSim, weapon: number): number {
  return weapon === 0 ? s.mag0 : s.mag1;
}

export function reserveOf(s: PlayerSim, weapon: number): number {
  return weapon === 0 ? s.res0 : s.res1;
}

function setAmmo(s: PlayerSim, weapon: number, mag: number, reserve: number): void {
  if (weapon === 0) {
    s.mag0 = mag;
    s.res0 = reserve;
  } else {
    s.mag1 = mag;
    s.res1 = reserve;
  }
}

/**
 * Spread cone radius right now. Standing still (or below the accurate speed,
 * which a counter-strafe reaches in two ticks) gives first-shot accuracy;
 * running, jumping and long sprays widen it.
 */
export function inaccuracy(w: WeaponStats, s: PlayerSim, sprayIndex: number): number {
  let r = s.crouch ? w.spreadCrouch : w.spreadStand;
  const speed = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
  const accurate = MOVE.runSpeed * COMBAT.accurateSpeedFraction;
  const t = Math.min(1, Math.max(0, (speed - accurate) / (MOVE.runSpeed - accurate)));
  r += w.spreadMove * t;
  if (!s.grounded) r += w.spreadAir;
  r += Math.min(w.spreadFireMax, w.spreadPerShot * sprayIndex);
  return r;
}

/** One tick of the weapon state machine. Returns the shot fired, or null. */
export function stepWeapon(s: PlayerSim, input: InputFrame): ShotFired | null {
  const b = input.buttons | 0;
  const prev = s.prevButtons | 0;

  // Switching: cancels a reload, resets the spray, starts the equip timer.
  const want = pressed(b, prev, Button.Slot1) ? 0 : pressed(b, prev, Button.Slot2) ? 1 : -1;
  if (want >= 0 && want !== s.weapon) {
    s.weapon = want;
    s.equip = weaponStats(want).equipTicks;
    s.reload = 0;
    s.spray = 0;
    s.cooldown = 0;
  }
  const w = weaponStats(s.weapon);

  if (s.equip > 0) s.equip -= 1;
  if (s.cooldown > 0) s.cooldown -= 1;
  if (s.reload > 0) {
    s.reload -= 1;
    if (s.reload === 0) {
      const mag = magOf(s, s.weapon);
      const res = reserveOf(s, s.weapon);
      const take = Math.min(w.magSize - mag, res);
      setAmmo(s, s.weapon, mag + take, res - take);
    }
  }

  if (pressed(b, prev, Button.Reload) && s.reload === 0 && s.equip === 0) {
    if (magOf(s, s.weapon) < w.magSize && reserveOf(s, s.weapon) > 0) s.reload = w.reloadTicks;
  }

  const firePressed = pressed(b, prev, Button.Fire);
  const wantsFire = w.automatic ? (b & Button.Fire) !== 0 : firePressed;
  let fired: ShotFired | null = null;

  if (wantsFire && s.equip === 0 && s.cooldown === 0) {
    // A fresh trigger pull with rounds left cancels a reload.
    if (s.reload > 0 && firePressed && magOf(s, s.weapon) > 0) s.reload = 0;
    if (s.reload === 0) {
      const mag = magOf(s, s.weapon);
      if (mag > 0) {
        const sprayIndex = Math.min(Math.floor(s.spray), w.pattern.length - 1);
        setAmmo(s, s.weapon, mag - 1, reserveOf(s, s.weapon));
        s.cooldown = w.fireTicks;
        s.shotSeq = (s.shotSeq + 1) & 0xffff;
        s.spray = Math.min(s.spray + 1, w.pattern.length - 1);
        fired = shotScratch;
        fired.weapon = s.weapon;
        fired.sprayIndex = sprayIndex;
        fired.inaccuracy = inaccuracy(w, s, sprayIndex);
        fired.shotSeq = s.shotSeq;
      } else if (firePressed && reserveOf(s, s.weapon) > 0) {
        s.reload = w.reloadTicks; // empty: pulling the trigger reloads
      }
    }
  }

  // Recoil reset: the spray recovers once the gun is ready and not firing.
  if (!fired && s.cooldown === 0 && s.spray > 0) s.spray = Math.max(0, s.spray - w.sprayRecoveryPerTick);
  return fired;
}
