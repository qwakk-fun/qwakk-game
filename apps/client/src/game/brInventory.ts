import { t as translate } from '../i18n/game.ts';
/**
 * What the inventory screen and the crate panel show, from the local duck's
 * state (predicted sim fields plus its owner-only gear) and the loot entries
 * in reach. The same shared rules as the server (inventory.ts) label what
 * fits and why not; the server still decides every request.
 */
import {
  ARMOR,
  capacityOf,
  Container,
  hasWeapon,
  isStack,
  Item,
  loadOf,
  PACK,
  pickupBlock,
  weaponStats,
  WeaponId,
  weightOf,
  type Armor,
  type ItemExtra,
  type PlayerSim,
} from '@qwakk/shared';
import type { PlayerState } from '@qwakk/shared/net';
import type { InvAction, InvRow, InvScreen } from '../hud/br/inventoryPanel.ts';
import { denyShort, itemLine, shortName, weightText } from '../hud/br/itemText.ts';
import type { LootEntry } from './brLoot.ts';

/** The local duck's worn gear, from its owner-only state. */
export function gearOf(mine: PlayerState): Armor {
  return { vest: mine.vest, vestDur: mine.vestDur, helmet: mine.helmet, helmetDur: mine.helmetDur, pack: mine.pack };
}

const drop = (kind: number, amount: number): InvAction => ({ t: 'drop', kind, amount });

/** "Crate", "Large crate", "Ammo box", "Dropped crate". */
export function crateTitle(e: LootEntry): string {
  if (e.pt === 0) return translate('Dropped crate');
  return e.box === Container.Large ? translate('Large crate') : e.box === Container.Ammo ? translate('Ammo box') : translate('Crate');
}

function stackRow(kind: number, amount: number, step: number, key?: string): InvRow {
  const actions = [{ label: translate('Drop {n}', { n: Math.min(step, amount) }), act: drop(kind, step) }];
  if (amount > step) actions.push({ label: translate('Drop all'), act: drop(kind, amount) });
  return { label: `${shortName(kind)} x${amount}`, detail: translate('weight {n}', { n: weightText(amount * weightOf(kind)) }), actions, note: '', key };
}

/** A row for an item that could be taken (from a crate at `index`, or the item itself with -1). */
function takeRow(s: PlayerSim, gear: Armor, e: LootEntry, kind: number, amount: number, extra: ItemExtra, index: number): InvRow {
  const block = pickupBlock(s, gear, kind, extra);
  const w = weightOf(kind);
  return {
    label: itemLine(kind, amount, extra),
    detail: isStack(kind) ? translate('weight {n}', { n: weightText(amount * w) }) : '',
    actions: block ? [] : [{ label: translate('Take'), act: { t: 'take', num: e.num, index, kind } }],
    note: denyShort(block),
  };
}

export function inventoryScreen(s: PlayerSim, mine: PlayerState, reach: readonly LootEntry[]): InvScreen {
  const gear = gearOf(mine);
  const equipped: InvRow[] = [];
  for (const w of [WeaponId.Rifle, WeaponId.Pistol]) {
    const kind = w === WeaponId.Rifle ? Item.Rifle : Item.Pistol;
    const stats = weaponStats(w);
    if (hasWeapon(s, w)) equipped.push({ key: String(w + 1), label: translate(stats.name), detail: `${w === 0 ? s.mag0 : s.mag1} / ${stats.magSize}`, actions: [{ label: translate('Drop'), act: drop(kind, 1) }], note: '' });
    else equipped.push({ key: String(w + 1), label: translate('Empty slot'), detail: '', actions: [], note: '' });
  }
  const piece = (name: string, level: number, dur: number, max: readonly number[], kind: number): InvRow =>
    level > 0
      ? { label: `${name} ${level}`, detail: `${Math.round((100 * dur) / (max[level] ?? 1))}%`, actions: [{ label: translate('Drop'), act: drop(kind, 1) }], note: '' }
      : { label: translate('No {name}', { name: name.toLocaleLowerCase() }), detail: '', actions: [], note: '' };
  equipped.push(piece(translate('Vest'), gear.vest, gear.vestDur, ARMOR.vestDurability, Item.Vest1));
  equipped.push(piece(translate('Helmet'), gear.helmet, gear.helmetDur, ARMOR.helmetDurability, Item.Helmet1));
  const pack = gear.pack ?? 0;
  const base = PACK.capacity[0] ?? 0;
  if (pack > 0) {
    const heavy = loadOf(s) > base;
    equipped.push({ label: translate('Backpack {n}', { n: pack }), detail: translate('holds {n}', { n: capacityOf(gear) }), actions: heavy ? [] : [{ label: translate('Drop'), act: drop(Item.Backpack1, 1) }], note: heavy ? translate('Too full to take off') : '' });
  } else equipped.push({ label: translate('No backpack'), detail: translate('holds {n}', { n: base }), actions: [], note: '' });

  const carried: InvRow[] = [];
  if (s.res0 > 0) carried.push(stackRow(Item.RifleAmmo, s.res0, 30));
  if (s.res1 > 0) carried.push(stackRow(Item.PistolAmmo, s.res1, 24));
  if (s.bandages > 0) carried.push(stackRow(Item.Bandage, s.bandages, 1, '4'));
  if (s.medkits > 0) carried.push(stackRow(Item.Medkit, s.medkits, 1, '5'));

  const nearby: InvScreen['nearby'] = [];
  const ground: InvRow[] = [];
  for (const e of reach) {
    if (e.kind === Item.Crate) {
      if (!e.open) nearby.push({ title: translate('{name} (closed)', { name: crateTitle(e) }), rows: [{ label: translate('Press E to open it'), detail: '', actions: [], note: '' }] });
      else if (e.contents.length > 0) nearby.push({ title: crateTitle(e), rows: e.contents.map((c, i) => takeRow(s, gear, e, c.kind, c.amount, c, i)) });
    } else ground.push(takeRow(s, gear, e, e.kind, e.amount, e.extra, -1));
  }
  if (ground.length > 0) nearby.push({ title: translate('On the ground'), rows: ground });
  return { load: loadOf(s), capacity: capacityOf(gear), pack, equipped, carried, nearby };
}

/** The panel under the prompt when it targets an open crate: its contents, and what does not fit. */
export function cratePanel(s: PlayerSim, mine: PlayerState, e: LootEntry): { title: string; rows: { label: string; note: string }[] } {
  const gear = gearOf(mine);
  return { title: crateTitle(e), rows: e.contents.map((c) => ({ label: itemLine(c.kind, c.amount, c), note: denyShort(pickupBlock(s, gear, c.kind, c)) })) };
}

/** Why the prompt's item would not fit ('' when it does). */
export function promptNote(s: PlayerSim, mine: PlayerState, e: LootEntry): string {
  if (e.kind === Item.Crate) return '';
  return denyShort(pickupBlock(s, gearOf(mine), e.kind, e.extra));
}
