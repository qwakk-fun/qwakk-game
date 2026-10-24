/**
 * How the menu words a piece of Hunt Season gear: its name, its stats line
 * and how it compares with what the duck wears (from the shared catalog, so
 * the shop never claims a number the server does not use).
 */
import { gearById, type GearItem } from '@qwakk/shared/duck';
import { COPY } from '../copy.ts';

const D = () => COPY.duck;

export function itemName(id: string | null | undefined): string {
  return (id && D().items[id]) || D().noArmor;
}

const pct = (v: number): number => Math.round(v * 100);

/** "+7% katana damage · 2% crit chance", or the starter's "no bonus". */
export function itemStats(item: GearItem): string {
  const S = D().stats;
  const parts: string[] = [];
  if (item.slot === 'katana') {
    if ((item.blade ?? 1) > 1) parts.push(S.damage(pct((item.blade ?? 1) - 1)));
    if ((item.crit ?? 0) > 0) parts.push(S.crit(pct(item.crit ?? 0)));
  } else {
    if ((item.hp ?? 0) > 0) parts.push(S.hp(item.hp ?? 0));
    if ((item.guard ?? 0) > 0) parts.push(S.guard(pct(item.guard ?? 0)));
  }
  return parts.length > 0 ? parts.join(' · ') : S.base;
}

/** A single number for "how much better": damage (crits counted) for a katana, effective health for armor. */
export function itemPower(item: GearItem | null): number {
  if (!item) return 1;
  if (item.slot === 'katana') return (item.blade ?? 1) * (1 + (item.crit ?? 0) * 0.6);
  return (100 + (item.hp ?? 0)) / 100 / (1 - (item.guard ?? 0));
}

/** How an item compares with the one worn in its slot: percent better (negative: worse). */
export function versus(item: GearItem, wornId: string | null): number {
  const worn = gearById(wornId);
  return Math.round((itemPower(item) / itemPower(worn) - 1) * 100);
}
