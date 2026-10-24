/**
 * Hunt Season numbers the server alone decides, from the admin settings
 * (`raid.*`, settings/defs.ts; the constants are the defaults). A room reads
 * them once when it is created (`raidRules()`), never per tick; tests pass
 * their own object.
 */
import { LEVEL_SCALE, PUSH, RAID, TICK_RATE } from '@qwakk/shared';
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

/** The katana's server side (raid/blade.ts on the server): what a cut does. Times of the swings are client simulated constants (BLADE in shared). */
export interface BladeRules {
  /** Damage of the light cuts, Slash 1 to 3. */
  slash: [number, number, number];
  /** The heavy spin: at no charge, and the extra at a full charge. */
  heavy: number;
  heavyCharge: number;
  /** One Blade Storm pulse, the quack shockwave, a dash through a hunter. */
  storm: number;
  quack: number;
  dash: number;
  /** Damage multiplier of a crit: a back-stab or a fully charged heavy spin. */
  crit: number;
  /** Seconds a hunter reels after a cut (minions; elites half, the Big Hunter a quarter). */
  staggerSeconds: number;
  /** Knockback of the cuts (m/s; the finisher, the heavy and the quack more), times this. */
  knockScale: number;
  /** Blade Storm meter per landed hit and per kill (100 fills it). */
  meterPerHit: number;
  meterPerKill: number;
  /** The combo counter resets after this long without a hit. */
  comboSeconds: number;
  /** A minion's melee hit: the Beater's club, the Recruit's pitchfork. */
  beaterDamage: number;
  recruitDamage: number;
}

/** The push's numbers (push.ts defaults; admin settings `raid.push.*`). */
export interface PushRules {
  trenchKills: number;
  crates: number;
  crateHp: number;
  snipersPerTower: number;
  /** Seconds between packs, times this. */
  packGapScale: number;
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
  blade: BladeRules;
  push: PushRules;
  upgrade: {
    damagePercent: number;
    maxHealth: number;
    armorPercent: number;
    regenPerSecond: number;
    revivePercent: number;
    /** Wider arcs: more reach per card. */
    reachPercent: number;
    /** Harder crits per card. */
    critPercent: number;
    /** Health back per landed cut, per card. */
    lifesteal: number;
    /** Faster Blade Storm meter per card. */
    stormPercent: number;
    /** Bleeding: damage per second for 3 s after a cut, per card. */
    bleedDps: number;
    /** The heavy spin's chain: share of its damage to up to 3 more hunters nearby, per card. */
    chainPercent: number;
    /** The third cut of the combo hits harder, per card. */
    finisherPercent: number;
  };
  dropAmmoPercent: number;
  dropHealPercent: number;
  healAmount: number;
  /** Hunter health and damage per level of the party's average above level 10 (percent; shared kit.ts levelScale caps them). */
  levelHpPercent: number;
  levelDamagePercent: number;
}

export const DEFAULT_CANNON: CannonRules = { damage: 75, radius: 3.5, knockback: 8, reloadSeconds: 1.3, heatPerShot: 30, coolPerSecond: 10, ventBelow: 35 };

export const DEFAULT_BLADE: BladeRules = {
  slash: [24, 24, 42],
  heavy: 34,
  heavyCharge: 40,
  storm: 12,
  quack: 10,
  dash: 16,
  crit: 1.6,
  staggerSeconds: 0.35,
  knockScale: 1,
  meterPerHit: 1.2,
  meterPerKill: 3,
  comboSeconds: 3,
  beaterDamage: 6,
  recruitDamage: 4,
};

export const DEFAULT_PUSH: PushRules = {
  trenchKills: PUSH.trenchKills,
  crates: PUSH.crates,
  crateHp: PUSH.crateHp,
  snipersPerTower: PUSH.snipersPerTower,
  packGapScale: 1,
};

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
  blade: DEFAULT_BLADE,
  push: DEFAULT_PUSH,
  upgrade: { damagePercent: 15, maxHealth: 20, armorPercent: 10, regenPerSecond: 1.5, revivePercent: 25, reachPercent: 15, critPercent: 30, lifesteal: 1, stormPercent: 25, bleedDps: 6, chainPercent: 40, finisherPercent: 40 },
  dropAmmoPercent: 22,
  dropHealPercent: 12,
  healAmount: 25,
  levelHpPercent: LEVEL_SCALE.hpPercent,
  levelDamagePercent: LEVEL_SCALE.damagePercent,
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
    blade: {
      slash: [n('blade.slash1'), n('blade.slash2'), n('blade.slash3')],
      heavy: n('blade.heavy'),
      heavyCharge: n('blade.heavyCharge'),
      storm: n('blade.storm'),
      quack: n('blade.quack'),
      dash: n('blade.dash'),
      crit: n('blade.crit'),
      staggerSeconds: n('blade.staggerSeconds'),
      knockScale: n('blade.knockScale'),
      meterPerHit: n('blade.meterPerHit'),
      meterPerKill: n('blade.meterPerKill'),
      comboSeconds: n('blade.comboSeconds'),
      beaterDamage: n('blade.beaterDamage'),
      recruitDamage: n('blade.recruitDamage'),
    },
    push: {
      trenchKills: n('push.trenchKills'),
      crates: n('push.crates'),
      crateHp: n('push.crateHp'),
      snipersPerTower: n('push.snipersPerTower'),
      packGapScale: n('push.packGapScale'),
    },
    upgrade: {
      damagePercent: n('upgrade.damagePercent'),
      maxHealth: n('upgrade.maxHealth'),
      armorPercent: n('upgrade.armorPercent'),
      regenPerSecond: n('upgrade.regenPerSecond'),
      revivePercent: n('upgrade.revivePercent'),
      reachPercent: n('upgrade.reachPercent'),
      critPercent: n('upgrade.critPercent'),
      lifesteal: n('upgrade.lifesteal'),
      stormPercent: n('upgrade.stormPercent'),
      bleedDps: n('upgrade.bleedDps'),
      chainPercent: n('upgrade.chainPercent'),
      finisherPercent: n('upgrade.finisherPercent'),
    },
    dropAmmoPercent: n('dropAmmoPercent'),
    dropHealPercent: n('dropHealPercent'),
    healAmount: n('healAmount'),
    levelHpPercent: n('levelHpPercent'),
    levelDamagePercent: n('levelDamagePercent'),
  };
}

export const ticks = (s: number): number => Math.max(1, Math.round(s * TICK_RATE));
