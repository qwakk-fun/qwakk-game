/**
 * Numbers the client also simulates for prediction (movement, fire rate,
 * ammo, spread, aim down sights). The admin panel shows them read only:
 * changing one at runtime would make the client's prediction disagree with
 * the server, so they change only with a deploy (constants.ts, weapons.ts).
 */
import { ADS, MOVE, TICK_RATE, WEAPONS } from '@qwakk/shared';

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
  ];
  for (const w of WEAPONS) {
    out.push(
      { group: w.name, label: 'Fire rate', value: `${Math.round((60 * TICK_RATE) / w.fireTicks)} rpm` },
      { group: w.name, label: 'Magazine / reserve', value: `${w.magSize} / ${w.reserve}` },
      { group: w.name, label: 'Reload', value: `${Math.round((w.reloadTicks / TICK_RATE) * 100) / 100} s` },
      { group: w.name, label: 'Spread standing / moving', value: `${deg(w.spreadStand)} / +${deg(w.spreadMove)}` },
    );
  }
  return out;
}
