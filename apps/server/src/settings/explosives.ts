/**
 * Deathmatch explosive numbers the server alone decides: blast damage, radii,
 * the fuse, self damage, knockback, grenades per life, rockets per pickup and
 * the pickup timing (defaults: EXPLOSIVE in constants.ts). The flight itself
 * (launch speed, gravity, bounce) and the throw and launch gates are also
 * simulated by the client, so they stay constants.
 *
 * `explosiveRules()` returns a ready object, rebuilt only when a setting
 * changes (an explosion reads it, never a per-tick lookup).
 */
import { EXPLOSIVE, TICK_RATE } from '@qwakk/shared';
import { settings, type RuntimeSettings } from './runtime.ts';

export interface BlastRules {
  damage: number;
  innerRadius: number;
  blastRadius: number;
  edgeScale: number;
  knockback: number;
  lift: number;
}

export interface ExplosiveRules {
  grenade: BlastRules & { fuseTicks: number };
  rocket: BlastRules & { directDamage: number };
  selfDamageScale: number;
}

let rules: ExplosiveRules;

function rebuild(s: RuntimeSettings): void {
  const G = EXPLOSIVE.grenade;
  const R = EXPLOSIVE.rocket;
  const push = s.num('weapons.explosive.knockback');
  const gr = s.num('weapons.grenade.radius');
  const rr = s.num('weapons.rocket.radius');
  rules = {
    grenade: {
      damage: s.num('weapons.grenade.damage'),
      // The full-damage core keeps its share of the radius.
      innerRadius: Math.min(G.innerRadius, gr * 0.5),
      blastRadius: gr,
      edgeScale: G.edgeScale,
      knockback: G.knockback * push,
      lift: G.lift * push,
      fuseTicks: Math.max(1, Math.round(s.num('weapons.grenade.fuseSeconds') * TICK_RATE)),
    },
    rocket: {
      damage: s.num('weapons.rocket.damage'),
      innerRadius: Math.min(R.innerRadius, rr * 0.5),
      blastRadius: rr,
      edgeScale: R.edgeScale,
      knockback: R.knockback * push,
      lift: R.lift * push,
      directDamage: s.num('weapons.rocket.directDamage'),
    },
    selfDamageScale: s.num('weapons.explosive.selfDamage'),
  };
}

rebuild(settings);
settings.onChange((key) => {
  if (key.startsWith('weapons.grenade.') || key.startsWith('weapons.rocket.') || key.startsWith('weapons.explosive.')) rebuild(settings);
});

/** The blast numbers in force. */
export function explosiveRules(): ExplosiveRules {
  return rules;
}

/** Grenades a deathmatch duck spawns with (read at every spawn). */
export function grenadesPerLife(): number {
  return settings.num('dm.grenadesPerLife');
}

/** The launcher pickup: rockets it gives (0: off) and the wait before the next one, in ticks (read when scheduling). */
export function rocketPickupRules(): { rockets: number; minTicks: number; maxTicks: number } {
  const min = settings.num('dm.rocketPickupMinSeconds');
  const max = Math.max(min, settings.num('dm.rocketPickupMaxSeconds'));
  return { rockets: settings.num('dm.rocketsPerPickup'), minTicks: min * TICK_RATE, maxTicks: max * TICK_RATE };
}
