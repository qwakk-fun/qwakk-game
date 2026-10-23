/**
 * Deathmatch buffs packed into one sim field, `PlayerSim.dmBuff` (one schema
 * slot: Colyseus allows 63 fields per schema and PlayerState is close to it):
 *
 * - bits 0..2: kill stacks (0 to KILL_STACKS.max), +4% move speed each;
 * - bit 3: the caped hero (flies, see heroFlight.ts).
 *
 * Only the server sets them (kills, deaths, the hero pick); the sim reads them
 * so the client predicts the same movement. Public on the player state: the
 * stack count follows from the public kill feed and streak, and who wears the
 * cape is announced to everyone. Battle royale keeps the field at zero.
 */
import { KILL_STACKS } from './constants.ts';

export const DM_BUFF = {
  stackMask: 0b111,
  hero: 0b1000,
} as const;

interface Buffed {
  dmBuff: number;
}

export function killStacks(s: Buffed): number {
  return s.dmBuff & DM_BUFF.stackMask;
}

export function isHero(s: Buffed): boolean {
  return (s.dmBuff & DM_BUFF.hero) !== 0;
}

/** Set the stack count (clamped to 0..KILL_STACKS.max), keeping the hero bit. */
export function setKillStacks(s: Buffed, n: number): void {
  const k = Math.max(0, Math.min(KILL_STACKS.max, Math.floor(n)));
  s.dmBuff = (s.dmBuff & ~DM_BUFF.stackMask) | k;
}

export function setHero(s: Buffed, on: boolean): void {
  s.dmBuff = on ? s.dmBuff | DM_BUFF.hero : s.dmBuff & ~DM_BUFF.hero;
}

/** Move speed factor from kill stacks (1 without any). */
export function stackSpeedFactor(s: Buffed): number {
  return 1 + KILL_STACKS.speedPerStack * killStacks(s);
}
