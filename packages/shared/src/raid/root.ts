/**
 * Hunt Season trap root, part of the shared sim: a duck caught in a trapper's
 * trap cannot walk or jump for a moment (it can still turn, aim, shoot and
 * reload). The server sets the ticks when a duck steps into an armed trap;
 * the sim counts them down every step, so the owner's prediction stays exact
 * after that one server event (like a blast's knockback). Packed into the
 * `ex` field next to the explosives (explosives.ts layout), because the
 * player schema has no fields left.
 */
import { EX_MAX } from '../explosives.ts';

const SHIFT = 19;
const MASK = 63;

/** Ticks left rooted (0: free). */
export function exRoot(s: { ex: number }): number {
  return ((s.ex | 0) >>> SHIFT) & MASK;
}

/** Server: root the duck for this many ticks (never shorter than a root already running). */
export function setRoot(s: { ex: number }, ticks: number): void {
  const t = Math.max(exRoot(s), Math.min(EX_MAX.root, Math.max(0, Math.floor(ticks))));
  s.ex = (((s.ex | 0) & ~(MASK << SHIFT)) | (t << SHIFT)) >>> 0;
}

/** One sim step: one tick less (exact integer math). */
export function tickRoot(s: { ex: number }): void {
  const t = exRoot(s);
  if (t > 0) s.ex = (((s.ex | 0) & ~(MASK << SHIFT)) | ((t - 1) << SHIFT)) >>> 0;
}
