/**
 * Hunt Season progression, part 1: what a duck's level unlocks (the katana's
 * moves). A fresh duck has the light combo only; the rest comes with levels
 * (`players.level`, written only by the game server at a run's end).
 *
 * How a lock reaches the sim (docs/progression.md, Determinism):
 *   - Dash, the "VAK!" shockwave and the Blade Storm are input buttons: the
 *     server masks a locked one off every input of that duck before the step
 *     (Raid.beforeStep), and the client masks the same bits before it sends
 *     and predicts (raidClient `lockedButtons`, everything locked until the
 *     server's kit message says otherwise), so both step the same frames.
 *   - The pistol is the `arms` bit the server hands out at a spawn
 *     (armBlade): no bit, no Slot 2.
 *   - The charged heavy is `ex` bit 15 (EX_HEAVY_LOCK, raid/blade.ts), set by
 *     the server at a spawn: the sim never starts a charge while it is set.
 * All of it is server state or server-checked input, so a client cannot
 * unlock anything by itself.
 *
 * Pure: the menu (`@qwakk/shared/duck`), the HUD and the server read it.
 */
import { Button } from '../input.ts';

/** The level each katana move needs. The light combo is always there. */
export const UNLOCK_LEVEL = {
  dash: 2,
  pistol: 3,
  quack: 4,
  heavy: 6,
  storm: 8,
} as const;

export type SkillId = keyof typeof UNLOCK_LEVEL;

/** In the order they unlock (the end screen, the My Duck page). */
export const SKILL_IDS: readonly SkillId[] = ['dash', 'pistol', 'quack', 'heavy', 'storm'];

/** Wire bits of an unlock set (`Msg.RaidKit`). */
export const SKILL_BIT: Record<SkillId, number> = { dash: 1, pistol: 2, quack: 4, heavy: 8, storm: 16 };

/** Every move unlocked (bot ducks, dev identities, the test hook). */
export const ALL_SKILLS = 31;

export function isUnlocked(level: number, skill: SkillId): boolean {
  return Math.floor(level) >= UNLOCK_LEVEL[skill];
}

/** The unlock bits a level gives. */
export function unlockBits(level: number): number {
  let bits = 0;
  for (const id of SKILL_IDS) if (isUnlocked(level, id)) bits |= SKILL_BIT[id];
  return bits;
}

export function hasSkill(bits: number, skill: SkillId): boolean {
  return (bits & SKILL_BIT[skill]) !== 0;
}

/** The skill buttons a duck with these unlock bits may not press (masked off its inputs on both sides). */
export function lockedButtonsOf(bits: number): number {
  let mask = 0;
  if (!hasSkill(bits, 'dash')) mask |= Button.Dash;
  if (!hasSkill(bits, 'quack')) mask |= Button.Quack;
  if (!hasSkill(bits, 'storm')) mask |= Button.Storm;
  return mask;
}

/** The moves a level-up from `before` to `after` unlocked, in order. */
export function newUnlocks(before: number, after: number): SkillId[] {
  return SKILL_IDS.filter((id) => !isUnlocked(before, id) && isUnlocked(after, id));
}
