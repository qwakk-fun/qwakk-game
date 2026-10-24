/**
 * Hunt Season upgrades (v3, melee builds), server side: what each card does
 * to a duck, on top of what the duck brings from its progression (its kit:
 * gear and skill tree, `@qwakk/shared/duck` kitStats, built by the server
 * from the database at join). Every number is server only (RaidRules.upgrade,
 * admin settings, the shared kit tables) and nothing here changes what the
 * client simulates: damage, reach, crits, health, armor, regen, lifesteal,
 * bleed, the chain, the storm meter, dodges and revive speed are applied by
 * the server's hit path (raid/blade.ts, raid/raid.ts).
 */
import { BASE_KIT_STATS, COMBAT, Upgrade, type KitStats, type UpgradeId } from '@qwakk/shared';
import type { RaidRules } from './rules.ts';

/** Most times one duck can take each card in a run. */
export const UPGRADE_MAX: Record<UpgradeId, number> = {
  [Upgrade.Damage]: 5,
  [Upgrade.MaxHealth]: 5,
  [Upgrade.Armor]: 4,
  [Upgrade.Regen]: 4,
  [Upgrade.Reach]: 3,
  [Upgrade.Revive]: 2,
  [Upgrade.Crit]: 3,
  [Upgrade.Lifesteal]: 3,
  [Upgrade.Storm]: 3,
  [Upgrade.Bleed]: 3,
  [Upgrade.Chain]: 2,
  [Upgrade.Finisher]: 3,
};

/** A duck's upgrades in this run: how many of each card it took. */
export class DuckUpgrades {
  readonly taken = new Map<UpgradeId, number>();

  count(id: UpgradeId): number {
    return this.taken.get(id) ?? 0;
  }

  add(id: UpgradeId): void {
    this.taken.set(id, this.count(id) + 1);
  }

  /** Cards at their limit (not offered again). */
  maxed(): Set<number> {
    const out = new Set<number>();
    for (const [id, n] of this.taken) if (n >= UPGRADE_MAX[id]) out.add(id);
    return out;
  }

  /** Every card taken, in order of id, repeated by count (the HUD's list). */
  list(): number[] {
    const out: number[] = [];
    for (const [id, n] of [...this.taken].sort((a, b) => a[0] - b[0])) for (let i = 0; i < n; i++) out.push(id);
    return out;
  }
}

export interface DuckStats {
  maxHp: number;
  /** Outgoing damage multiplier, incoming damage multiplier. */
  damage: number;
  taken: number;
  regenPerSecond: number;
  /** Revive time multiplier for this duck as the reviver (0.5 is twice as fast). */
  reviveTime: number;
  /** The katana's reach multiplier (the server's sweep only). */
  reach: number;
  /** Extra crit multiplier on top of the rules' crit (1: none). */
  crit: number;
  /** Health back per landed cut. */
  lifesteal: number;
  /** Blade Storm meter gain multiplier. */
  storm: number;
  /** Bleed damage per second after a cut (0: none). */
  bleedDps: number;
  /** Share of a heavy spin's damage that chains to more hunters (0: none). */
  chain: number;
  /** The third cut's damage multiplier (the kit's finisher also on the heavy spin: `heavy`). */
  finisher: number;
  heavy: number;
  /** Kit: katana cuts' damage multiplier, the chance a cut crits, extra crit multiplier. */
  blade: number;
  critChance: number;
  critBonus: number;
  /** Kit: chance a hunter's hit misses, the dash cut's multiplier, the last stand. */
  dodge: number;
  dash: number;
  lastStand: boolean;
  /** Kit: the quack's reach, damage and stagger; storm pulse damage; the rallying quack's heal. */
  quackReach: number;
  quackDamage: number;
  quackStagger: number;
  stormDamage: number;
  rally: number;
}

/** Most max health a duck can reach (cards and kit). */
export const MAX_HP_CAP = 300;

/** A duck's numbers: its run's cards (`u`) on top of its kit (`k`; the base kit: nothing). */
export function duckStats(u: DuckUpgrades, r: RaidRules['upgrade'], k: KitStats = BASE_KIT_STATS): DuckStats {
  return {
    maxHp: Math.min(MAX_HP_CAP, COMBAT.maxHp + k.hp + r.maxHealth * u.count(Upgrade.MaxHealth)),
    damage: 1 + (r.damagePercent / 100) * u.count(Upgrade.Damage),
    taken: Math.max(0.25, Math.max(0.3, 1 - (r.armorPercent / 100) * u.count(Upgrade.Armor)) * k.taken),
    regenPerSecond: r.regenPerSecond * u.count(Upgrade.Regen),
    reviveTime: Math.max(0.25, 1 - (r.revivePercent / 100) * u.count(Upgrade.Revive)),
    reach: (1 + (r.reachPercent / 100) * u.count(Upgrade.Reach)) * k.reach,
    crit: 1 + (r.critPercent / 100) * u.count(Upgrade.Crit),
    lifesteal: r.lifesteal * u.count(Upgrade.Lifesteal),
    storm: (1 + (r.stormPercent / 100) * u.count(Upgrade.Storm)) * k.meter,
    bleedDps: r.bleedDps * u.count(Upgrade.Bleed),
    chain: Math.min(1, (r.chainPercent / 100) * u.count(Upgrade.Chain)),
    finisher: (1 + (r.finisherPercent / 100) * u.count(Upgrade.Finisher)) * k.finisher,
    heavy: k.finisher,
    blade: k.blade,
    critChance: Math.max(0, Math.min(0.5, k.critChance)),
    critBonus: k.critBonus,
    dodge: Math.max(0, Math.min(0.5, k.dodge)),
    dash: k.dash,
    lastStand: k.lastStand,
    quackReach: k.quackReach,
    quackDamage: k.quackDamage,
    quackStagger: k.quackStagger,
    stormDamage: k.storm,
    rally: k.rally,
  };
}

/** The number a card shows (the server's value, so the card never lies). */
export function upgradeValue(id: UpgradeId, r: RaidRules['upgrade']): number {
  switch (id) {
    case Upgrade.Damage: return r.damagePercent;
    case Upgrade.MaxHealth: return r.maxHealth;
    case Upgrade.Armor: return r.armorPercent;
    case Upgrade.Regen: return Math.round(r.regenPerSecond * 10) / 10;
    case Upgrade.Reach: return r.reachPercent;
    case Upgrade.Revive: return r.revivePercent;
    case Upgrade.Crit: return r.critPercent;
    case Upgrade.Lifesteal: return r.lifesteal;
    case Upgrade.Storm: return r.stormPercent;
    case Upgrade.Bleed: return r.bleedDps;
    case Upgrade.Chain: return r.chainPercent;
    case Upgrade.Finisher: return r.finisherPercent;
  }
}
