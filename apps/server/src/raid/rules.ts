/**
 * Hunt Season numbers the server alone decides, from the admin settings
 * (`raid.*`, settings/defs.ts; the constants are the defaults). A room reads
 * them once when it is created (`raidRules()`), never per tick; tests pass
 * their own object.
 */
import { RAID, TICK_RATE } from '@qwakk/shared';
import { settings } from '../settings/runtime.ts';

export interface RaidRules {
  lobbySeconds: number;
  breakSeconds: number;
  towerHp: number;
  maxLive: number;
  hunterHpScale: number;
  hunterDamageScale: number;
  towerDamageScale: number;
  /** Ticks from first sight of a duck to a hunter's first shot (the telegraph covers it), random in range. */
  reactionTicks: [number, number];
  /** A hunter's aim error on a new target (rad, either way), settling every tick while it aims. */
  aimError: number;
  /** Extra random cone of every hunter bullet or pellet (rad). */
  spread: number;
  upgrade: {
    damagePercent: number;
    maxHealth: number;
    armorPercent: number;
    regenPerSecond: number;
    revivePercent: number;
    headshotPercent: number;
    lifesteal: number;
    repair: number;
  };
  dropAmmoPercent: number;
  dropHealPercent: number;
  healAmount: number;
}

export const DEFAULT_RAID_RULES: RaidRules = {
  lobbySeconds: RAID.lobbySeconds,
  breakSeconds: RAID.breakSeconds,
  towerHp: RAID.towerHp,
  maxLive: RAID.maxLive,
  hunterHpScale: 1,
  hunterDamageScale: 1,
  towerDamageScale: 1,
  reactionTicks: [15, 25],
  aimError: 0.1,
  spread: (1.1 * Math.PI) / 180,
  upgrade: { damagePercent: 15, maxHealth: 20, armorPercent: 10, regenPerSecond: 1.5, revivePercent: 25, headshotPercent: 30, lifesteal: 6, repair: 250 },
  dropAmmoPercent: 22,
  dropHealPercent: 12,
  healAmount: 25,
};

/** The rules from the admin settings now. */
export function raidRules(): RaidRules {
  const n = (k: string): number => settings.num(`raid.${k}`);
  const rmin = n('hunterReactionMin');
  return {
    lobbySeconds: n('lobbySeconds'),
    breakSeconds: n('breakSeconds'),
    towerHp: n('towerHp'),
    maxLive: n('maxLive'),
    hunterHpScale: n('hunterHpScale'),
    hunterDamageScale: n('hunterDamageScale'),
    towerDamageScale: n('towerDamageScale'),
    reactionTicks: [rmin, Math.max(rmin, n('hunterReactionMax'))],
    aimError: n('hunterAimError'),
    spread: (n('hunterSpreadDeg') * Math.PI) / 180,
    upgrade: {
      damagePercent: n('upgrade.damagePercent'),
      maxHealth: n('upgrade.maxHealth'),
      armorPercent: n('upgrade.armorPercent'),
      regenPerSecond: n('upgrade.regenPerSecond'),
      revivePercent: n('upgrade.revivePercent'),
      headshotPercent: n('upgrade.headshotPercent'),
      lifesteal: n('upgrade.lifesteal'),
      repair: n('upgrade.repair'),
    },
    dropAmmoPercent: n('dropAmmoPercent'),
    dropHealPercent: n('dropHealPercent'),
    healAmount: n('healAmount'),
  };
}

export const ticks = (s: number): number => Math.max(1, Math.round(s * TICK_RATE));
