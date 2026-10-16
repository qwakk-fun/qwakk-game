/**
 * Item names and lines for the battle royale HUD: pickup prompts, the crate
 * panel, the inventory screen and the "that did not work" toasts. Plain text
 * (no HTML), no em dashes.
 */
import { ARMOR, backpackLevel, Deny, Item, itemName, weaponStats, WeaponId, type ItemExtra } from '@qwakk/shared';

/** Short name: "Rifle", "Rifle ammo", "Vest 2", "Backpack 3". */
export function shortName(kind: number): string {
  switch (kind) {
    case Item.Vest1:
      return 'Vest 1';
    case Item.Vest2:
      return 'Vest 2';
    case Item.Helmet1:
      return 'Helmet 1';
    case Item.Helmet2:
      return 'Helmet 2';
    case Item.Crate:
      return 'Crate';
    default: {
      const pack = backpackLevel(kind);
      return pack > 0 ? `Backpack ${pack}` : itemName(kind);
    }
  }
}

/** One line for an item lying somewhere: "Rifle ammo x30", "Rifle (12 rounds)", "Vest 2 (40%)". */
export function itemLine(kind: number, amount: number, extra: ItemExtra = {}): string {
  if (kind === Item.Rifle || kind === Item.Pistol) {
    if (extra.mag === undefined) return shortName(kind);
    const full = weaponStats(kind === Item.Rifle ? WeaponId.Rifle : WeaponId.Pistol).magSize;
    return `${shortName(kind)} (${extra.mag}/${full})`;
  }
  if (kind === Item.Vest1 || kind === Item.Vest2 || kind === Item.Helmet1 || kind === Item.Helmet2) {
    if (extra.dur === undefined) return shortName(kind);
    const lvl = kind === Item.Vest1 || kind === Item.Helmet1 ? 1 : 2;
    const max = (kind === Item.Vest1 || kind === Item.Vest2 ? ARMOR.vestDurability[lvl] : ARMOR.helmetDurability[lvl]) ?? 1;
    return `${shortName(kind)} (${Math.round((100 * extra.dur) / max)}%)`;
  }
  return amount > 1 ? `${shortName(kind)} x${amount}` : shortName(kind);
}

/** Why a pickup did nothing, short, for the prompt and the crate panel ('' when it fits). */
export function denyShort(reason: number): string {
  switch (reason) {
    case Deny.Full:
      return 'Backpack full';
    case Deny.Max:
      return 'Carrying the max';
    case Deny.Worse:
      return 'Yours is better';
    case Deny.Opening:
      return 'Opening...';
    default:
      return '';
  }
}

/** The toast when the server says no. Empty: nothing worth saying. */
export function denyToast(reason: number, kind: number): string {
  const name = shortName(kind);
  switch (reason) {
    case Deny.Full:
      return `Backpack full: no room for ${name}`;
    case Deny.Max:
      return `You already carry all the ${name} you can`;
    case Deny.Worse:
      return `Your ${backpackLevel(kind) > 0 ? 'backpack' : kind === Item.Helmet1 || kind === Item.Helmet2 ? 'helmet' : 'vest'} is as good or better`;
    case Deny.TooHeavy:
      return 'Too heavy to take the backpack off. Drop some ammo or heals first';
    default:
      return '';
  }
}

/** Weight with up to two decimals, trailing zeros dropped: "12.5", "6", "0.25". */
export function weightText(w: number): string {
  return String(Math.round(w * 100) / 100);
}
