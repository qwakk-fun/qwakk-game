/**
 * Hunt Season numbers the server alone decides, from the admin settings
 * (`raid.*`, settings/defs.ts; the constants are the defaults). A room reads
 * them once when it is created (`raidRules()`), never per tick; tests pass
 * their own object.
 */
import { RAID, TICK_RATE } from '@qwakk/shared';
import { settings } from '../settings/runtime.ts';

export interface CannonRules {
  /** Damage at a loaf's splash center (a quarter at the edge), splash radius (m), knockback at the center (m/s). */
  damage: number;
  radius: number;
  knockback: number;
  /** Seconds between loaves, heat per loaf (100 overheats), heat lost per second, and the heat an overheated cannon must cool below. */
  reloadSeconds: number;
  heatPerShot: number;
  coolPerSecond: number;
  ventBelow: number;
}

export interface RaidRules {
  lobbySeconds: number;
  breakSeconds: number;
  coreHp: number;
  maxLive: number;
  /** Hunters per wave (not the boss), times this. */
  waveScale: number;
  hunterHpScale: number;
  hunterDamageScale: number;
  coreDamageScale: number;
  gateHp: number;
  gateDamageScale: number;
  gateRepairPerSecond: number;
  /** Share of the gate's health the castle crew patches up at every break (0 to 1). */
  gateBreakRepair: number;
  bridgeMoveSeconds: number;
  bridgeCooldownSeconds: number;
  bridgeUpMaxSeconds: number;
  raftSpeed: number;
  cannon: CannonRules;
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

export const DEFAULT_CANNON: CannonRules = { damage: 75, radius: 3.5, knockback: 8, reloadSeconds: 1.3, heatPerShot: 30, coolPerSecond: 10, ventBelow: 35 };

export const DEFAULT_RAID_RULES: RaidRules = {
  lobbySeconds: RAID.lobbySeconds,
  breakSeconds: RAID.breakSeconds,
  coreHp: RAID.coreHp,
  maxLive: RAID.maxLive,
  waveScale: 1,
  hunterHpScale: 1,
  hunterDamageScale: 1,
  coreDamageScale: 1,
  gateHp: RAID.gateHp,
  gateDamageScale: 1,
  gateRepairPerSecond: 35,
  gateBreakRepair: 0.25,
  bridgeMoveSeconds: 2.5,
  bridgeCooldownSeconds: 10,
  bridgeUpMaxSeconds: 25,
  raftSpeed: 1.5,
  cannon: DEFAULT_CANNON,
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
    coreHp: n('coreHp'),
    maxLive: n('maxLive'),
    waveScale: n('waveScale'),
    hunterHpScale: n('hunterHpScale'),
    hunterDamageScale: n('hunterDamageScale'),
    coreDamageScale: n('coreDamageScale'),
    gateHp: n('gateHp'),
    gateDamageScale: n('gateDamageScale'),
    gateRepairPerSecond: n('gateRepairPerSecond'),
    gateBreakRepair: n('gateBreakRepairPercent') / 100,
    bridgeMoveSeconds: n('bridgeMoveSeconds'),
    bridgeCooldownSeconds: n('bridgeCooldownSeconds'),
    bridgeUpMaxSeconds: n('bridgeUpMaxSeconds'),
    raftSpeed: n('raftSpeed'),
    cannon: {
      damage: n('cannon.damage'),
      radius: n('cannon.radius'),
      knockback: n('cannon.knockback'),
      reloadSeconds: n('cannon.reloadSeconds'),
      heatPerShot: n('cannon.heatPerShot'),
      coolPerSecond: n('cannon.coolPerSecond'),
      ventBelow: n('cannon.ventBelow'),
    },
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
