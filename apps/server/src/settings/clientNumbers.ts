/**
 * Numbers the client also simulates for prediction (movement, fire rate,
 * ammo, spread, aim down sights). The admin panel shows them read only:
 * changing one at runtime would make the client's prediction disagree with
 * the server, so they change only with a deploy (constants.ts, weapons.ts).
 */
import { ADS, EXPLOSIVE, HERO_FLIGHT, KILL_STACKS, MOVE, TICK_RATE, WEAPONS } from '@qwakk/shared';

export interface ClientNumber {
  group: string;
  label: string;
  value: string;
}

const deg = (rad: number): string => `${Math.round(((rad * 180) / Math.PI) * 100) / 100} deg`;

export function clientNumbers(): ClientNumber[] {
  const out: ClientNumber[] = [
    { group: 'Movement', label: 'Walk speed', value: `${MOVE.walkSpeed} m/s` },
    { group: 'Movement', label: 'Run speed', value: `${MOVE.runSpeed} m/s` },
    { group: 'Movement', label: 'Sprint speed', value: `${MOVE.sprintSpeed} m/s` },
    { group: 'Movement', label: 'Crouch speed', value: `${MOVE.crouchSpeed} m/s` },
    { group: 'Movement', label: 'Jump velocity', value: `${MOVE.jumpVelocity} m/s` },
    { group: 'Movement', label: 'Gravity', value: `${MOVE.gravity} m/s2` },
    { group: 'Aim down sights', label: 'Move speed while aiming', value: `${ADS.moveSpeed} m/s` },
    { group: 'Aim down sights', label: 'Spread at full aim', value: `x${ADS.spreadScale}` },
    { group: 'Aim down sights', label: 'Recoil at full aim', value: `x${ADS.recoilScale}` },
    { group: 'Deathmatch', label: 'Kill stack speed', value: `+${Math.round(KILL_STACKS.speedPerStack * 100)}% per stack, up to ${KILL_STACKS.max}` },
    { group: 'Deathmatch', label: 'Hero flight speed', value: `${HERO_FLIGHT.speed} m/s, climb ${HERO_FLIGHT.climbSpeed} m/s` },
    { group: 'Deathmatch', label: 'Hero flight height', value: `${HERO_FLIGHT.maxHeight} m above ground` },
    { group: 'Deathmatch', label: 'Hero flight energy', value: `${Math.round((HERO_FLIGHT.energyTicks / TICK_RATE) * 10) / 10} s, refills on the ground` },
  ];
  for (const w of WEAPONS) {
    out.push(
      { group: w.name, label: 'Fire rate', value: `${Math.round((60 * TICK_RATE) / w.fireTicks)} rpm` },
      { group: w.name, label: 'Magazine / reserve', value: `${w.magSize} / ${w.reserve}` },
      { group: w.name, label: 'Reload', value: `${Math.round((w.reloadTicks / TICK_RATE) * 100) / 100} s` },
      { group: w.name, label: 'Spread standing / moving', value: `${deg(w.spreadStand)} / +${deg(w.spreadMove)}` },
    );
  }
  const sec = (ticks: number): string => `${Math.round((ticks / TICK_RATE) * 100) / 100} s`;
  out.push(
    { group: 'Explosives', label: 'Grenade throw speed', value: `${EXPLOSIVE.grenade.speed} m/s` },
    { group: 'Explosives', label: 'Time between throws', value: sec(EXPLOSIVE.grenade.throwTicks) },
    { group: 'Explosives', label: 'Rocket speed', value: `${EXPLOSIVE.rocket.speed} m/s` },
    { group: 'Explosives', label: 'Time between rockets', value: sec(EXPLOSIVE.rocket.fireTicks) },
  );
  return out;
}
