/**
 * Kill stack damage, server only (the client never predicts damage): the
 * admin setting `dm.stackDamagePercent`, kept in a plain number that the hit
 * path reads, refreshed only when the setting changes (like weapons.ts).
 */
import { settings, type RuntimeSettings } from './runtime.ts';

let perStack = 0;

function rebuild(s: RuntimeSettings): void {
  perStack = s.num('dm.stackDamagePercent') / 100;
}

rebuild(settings);
settings.onChange((key) => {
  if (key === 'dm.stackDamagePercent') rebuild(settings);
});

/** Damage factor for a shooter with this many kill stacks (1 with none). */
export function stackDamageScale(stacks: number): number {
  return 1 + perStack * stacks;
}
