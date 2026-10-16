/**
 * Aim down sights, stepped in the sim so client prediction and the server
 * agree on spread, recoil and move speed. `s.aim` counts ticks into the aim
 * (0 hip fire, ADS.inTicks full aim); every effect scales with that blend.
 */
import { ADS } from './constants.ts';
import { hasWeapon } from './combat.ts';
import { Button, type InputFrame } from './input.ts';
import type { PlayerSim } from './sim.ts';

/** What a duck is doing, as drawn for others (the pose's `act`). */
export const Act = {
  Idle: 0,
  Reload: 1,
  Equip: 2,
  Heal: 3,
  /** Aiming down sights (more than half way in). */
  Aim: 4,
  /** Knocked (team modes): drawn crawling, no gun up. */
  Down: 5,
} as const;

/** 0 (hip) to 1 (full aim). */
export function aimBlend(s: PlayerSim): number {
  return Math.min(1, Math.max(0, s.aim / ADS.inTicks));
}

/** Can the duck aim right now? Armed, not reloading and not healing. */
export function canAim(s: PlayerSim): boolean {
  return s.alive === 1 && s.down === 0 && hasWeapon(s, s.weapon) && s.reload === 0 && s.heal === 0;
}

/** One tick of the aim ramp (ground mode only; the drop resets it). */
export function stepAim(s: PlayerSim, input: InputFrame): void {
  if ((input.buttons & Button.Aim) !== 0 && canAim(s)) s.aim = Math.min(ADS.inTicks, s.aim + 1);
  else s.aim = Math.max(0, s.aim - ADS.outPerTick);
}

/** Linear blend from 1 (hip) to `scale` (full aim). */
export function aimScale(s: PlayerSim, scale: number): number {
  return 1 + (scale - 1) * aimBlend(s);
}

/** The pose action for other players: reload, equip, heal, aiming or idle. */
export function actionOf(s: PlayerSim): number {
  if (s.down) return Act.Down;
  if (s.reload > 0) return Act.Reload;
  if (s.equip > 0) return Act.Equip;
  if (s.heal > 0) return Act.Heal;
  if (s.aim * 2 > ADS.inTicks) return Act.Aim;
  return Act.Idle;
}
