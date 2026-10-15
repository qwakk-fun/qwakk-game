/**
 * Heals: a bandage (4) or a medkit (5) takes time, slows you to a walk and
 * is interrupted by firing, reloading, switching weapons or jumping. Part of
 * the sim so the slow-down is predicted exactly; the server's copy decides.
 */
import { HEAL } from './constants.ts';
import { Button, type InputFrame } from './input.ts';
import type { PlayerSim } from './sim.ts';

const INTERRUPT = Button.Fire | Button.Reload | Button.Slot1 | Button.Slot2 | Button.Jump;

export const HealKind = {
  None: 0,
  Bandage: 1,
  Medkit: 2,
} as const;

/** Can this heal start now (has the item, would heal something)? */
export function canHeal(s: PlayerSim, kind: number): boolean {
  if (kind === HealKind.Bandage) return s.bandages > 0 && s.hp < HEAL.bandageCap;
  if (kind === HealKind.Medkit) return s.medkits > 0 && s.hp < HEAL.medkitCap;
  return false;
}

export function healTicks(kind: number): number {
  return kind === HealKind.Medkit ? HEAL.medkitTicks : HEAL.bandageTicks;
}

export function stepHeal(s: PlayerSim, input: InputFrame): void {
  const b = input.buttons | 0;
  const pressed = b & ~(s.prevButtons | 0);
  if (s.heal > 0) {
    if (b & INTERRUPT && (pressed & INTERRUPT || b & Button.Fire)) {
      s.heal = 0;
      s.healKind = 0;
      return;
    }
    s.heal -= 1;
    if (s.heal === 0) {
      if (s.healKind === HealKind.Bandage && s.bandages > 0) {
        s.bandages -= 1;
        s.hp = Math.max(s.hp, Math.min(HEAL.bandageCap, s.hp + HEAL.bandageAmount));
      } else if (s.healKind === HealKind.Medkit && s.medkits > 0) {
        s.medkits -= 1;
        s.hp = HEAL.medkitCap;
      }
      s.healKind = 0;
    }
    return;
  }
  const want = pressed & Button.Heal1 ? HealKind.Bandage : pressed & Button.Heal2 ? HealKind.Medkit : HealKind.None;
  if (want !== HealKind.None && s.reload === 0 && canHeal(s, want)) {
    s.heal = healTicks(want);
    s.healKind = want;
  }
}
