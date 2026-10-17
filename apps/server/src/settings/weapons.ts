/**
 * Weapon numbers the server alone uses: body damage and the headshot
 * multiplier (the client never predicts damage; hit markers and kills come
 * from the server). Everything else about a weapon (fire rate, spread,
 * recoil, ammo) is simulated on both sides and stays in `WEAPONS`.
 *
 * `serverWeapon(id)` returns a ready copy of the weapon with the current
 * damage numbers, rebuilt only when a setting changes.
 */
import { WEAPONS, weaponStats, type WeaponStats } from '@qwakk/shared';
import { weaponKey } from './defs.ts';
import { settings, type RuntimeSettings } from './runtime.ts';

let table: WeaponStats[] = [];

function rebuild(s: RuntimeSettings): void {
  table = WEAPONS.map((w, i) => ({ ...w, damage: s.num(`weapons.${weaponKey(i)}.damage`), headMultiplier: s.num(`weapons.${weaponKey(i)}.headMultiplier`) }));
}

rebuild(settings);
settings.onChange((key) => {
  if (key.startsWith('weapons.')) rebuild(settings);
});

/** The weapon with the damage numbers in force (server hit path). */
export function serverWeapon(id: number): WeaponStats {
  return table[id] ?? weaponStats(id);
}
