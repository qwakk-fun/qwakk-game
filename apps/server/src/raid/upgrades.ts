/**
 * Hunt Season upgrades, server side: what each card does to a duck. Every
 * number is server only (RaidRules.upgrade, admin settings) and nothing here
 * changes what the client simulates: damage, armor, health, regen, lifesteal,
 * revive speed and headshot damage are applied by the server's damage path,
 * an extra grenade is a count the server sets at wave start.
 */
import { COMBAT, Upgrade, type UpgradeId } from '@qwakk/shared';
import type { RaidRules } from './rules.ts';

/** Most times one duck can take each card in a run (the repair kit: any time the tower is hurt). */
export const UPGRADE_MAX: Record<UpgradeId, number> = {
  [Upgrade.Damage]: 5,
  [Upgrade.MaxHealth]: 5,
  [Upgrade.Armor]: 4,
  [Upgrade.Regen]: 4,
  [Upgrade.Grenade]: 3,
  [Upgrade.Revive]: 2,
  [Upgrade.Headshot]: 3,
  [Upgrade.Lifesteal]: 3,
  [Upgrade.Repair]: 99,
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
  /** Outgoing damage multiplier, headshot multiplier on top, incoming damage multiplier. */
  damage: number;
  headshot: number;
  taken: number;
  regenPerSecond: number;
  /** Revive time multiplier for this duck as the reviver (0.5 is twice as fast). */
  reviveTime: number;
  lifesteal: number;
  extraGrenades: number;
}

export function duckStats(u: DuckUpgrades, r: RaidRules['upgrade']): DuckStats {
  return {
    maxHp: Math.min(250, COMBAT.maxHp + r.maxHealth * u.count(Upgrade.MaxHealth)),
    damage: 1 + (r.damagePercent / 100) * u.count(Upgrade.Damage),
    headshot: 1 + (r.headshotPercent / 100) * u.count(Upgrade.Headshot),
    taken: Math.max(0.3, 1 - (r.armorPercent / 100) * u.count(Upgrade.Armor)),
    regenPerSecond: r.regenPerSecond * u.count(Upgrade.Regen),
    reviveTime: Math.max(0.25, 1 - (r.revivePercent / 100) * u.count(Upgrade.Revive)),
    lifesteal: r.lifesteal * u.count(Upgrade.Lifesteal),
    extraGrenades: u.count(Upgrade.Grenade),
  };
}

/** The number a card shows (the server's value, so the card never lies). */
export function upgradeValue(id: UpgradeId, r: RaidRules['upgrade']): number {
  switch (id) {
    case Upgrade.Damage: return r.damagePercent;
    case Upgrade.MaxHealth: return r.maxHealth;
    case Upgrade.Armor: return r.armorPercent;
    case Upgrade.Regen: return Math.round(r.regenPerSecond * 10) / 10;
    case Upgrade.Grenade: return 1;
    case Upgrade.Revive: return r.revivePercent;
    case Upgrade.Headshot: return r.headshotPercent;
    case Upgrade.Lifesteal: return r.lifesteal;
    case Upgrade.Repair: return r.repair;
  }
}
