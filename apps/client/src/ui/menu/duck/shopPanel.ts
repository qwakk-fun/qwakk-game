/**
 * The shop panel of a Duck Plaza market stall (the Blacksmith sells katanas,
 * the Armorer armor): the slot's items by tier, each with its stats, how it
 * compares with what the duck wears, its level lock and its price in Tüy,
 * and one button (Buy, Equip or Equipped). Opened by walking up to the stall
 * and pressing E (a tap on touch); the plaza pauses under it like under the
 * sheet. Every button is a request the server checks (duckStore.ts).
 */
import { gearOfSlot, type GearItem, type GearSlot } from '@qwakk/shared/duck';
import { COPY } from '../copy.ts';
import { h } from '../dom.ts';
import type { DuckStore } from './duckStore.ts';
import { itemName, itemStats, versus } from './gearText.ts';

export type ShopKind = 'smith' | 'armorer';

const SLOT: Record<ShopKind, GearSlot> = { smith: 'katana', armorer: 'armor' };

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

export class ShopPanel {
  readonly root: HTMLElement;
  private readonly store: DuckStore;
  private readonly onClose: () => void;
  private kind: ShopKind = 'smith';
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly balance: HTMLElement;
  private readonly list: HTMLElement;
  private readonly status: HTMLElement;
  private off: (() => void) | null = null;
  private note = '';
  private noteBad = false;

  constructor(store: DuckStore, onClose: () => void) {
    this.store = store;
    this.onClose = onClose;
    const D = COPY.duck;
    this.title = h('h2', { id: 'qp-shop-title' });
    this.sub = h('p', { class: 'qm-sub' });
    this.balance = h('span', { class: 'qp-balance' });
    this.list = h('ul', { class: 'qp-shop-list' });
    this.status = h('p', { class: 'qp-status', role: 'status' });
    const close = h('button', { type: 'button', class: 'qm-sheet-x qp-shop-x', 'aria-label': D.shop.close }, '×');
    close.addEventListener('click', () => this.close());
    const card = h(
      'div',
      { class: 'qm-card qp-shop-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'qp-shop-title' },
      h('header', { class: 'qp-shop-head' }, h('div', { class: 'qp-shop-titles' }, this.title, this.sub), this.balance, close),
      this.list,
      this.status,
      h('p', { class: 'qm-fine qp-shop-note' }, D.shop.note),
    );
    this.root = h('div', { class: 'qm qp-shop', hidden: true }, card);
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(kind: ShopKind): void {
    this.kind = kind;
    this.note = '';
    if (!this.root.isConnected) document.body.append(this.root);
    this.root.hidden = false;
    this.off?.();
    this.off = this.store.on(() => this.render());
    this.render();
    void this.store.load();
    requestAnimationFrame(() => this.root.querySelector<HTMLElement>('.qp-shop-x')?.focus({ preventScroll: true }));
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.off?.();
    this.off = null;
    this.onClose();
  }

  private say(text: string, bad = false): void {
    this.note = text;
    this.noteBad = bad;
    this.renderStatus();
  }

  private renderStatus(): void {
    this.status.textContent = this.note;
    this.status.classList.toggle('is-bad', this.noteBad);
  }

  private render(): void {
    const D = COPY.duck;
    const S = D.shop;
    this.title.textContent = this.kind === 'smith' ? S.smith : S.armorer;
    this.sub.textContent = this.kind === 'smith' ? S.smithSub : S.armorerSub;
    const v = this.store.view;
    this.balance.replaceChildren(h('span', { class: 'qp-tuy-icon', 'aria-hidden': 'true' }), v ? D.balance(v.feathers) : '...');
    this.renderStatus();
    if (!v) {
      this.list.replaceChildren(h('li', { class: 'qp-empty' }, this.store.failed ? D.offline : D.loading));
      return;
    }
    const slot = SLOT[this.kind];
    const worn = slot === 'katana' ? v.equipped.katana : v.equipped.armor;
    this.list.replaceChildren(...gearOfSlot(slot).map((item) => this.row(item, worn)));
  }

  private row(item: GearItem, worn: string | null): HTMLElement {
    const D = COPY.duck;
    const S = D.shop;
    const v = this.store.view!;
    const owned = v.owned.includes(item.id);
    const on = worn === item.id;
    const lockedLevel = v.level < item.level;
    const short = item.cost - v.feathers;
    const vs = on ? 0 : versus(item, worn);
    const compare = on ? S.yours : vs > 0 ? S.better(vs) : vs < 0 ? S.worse : '';
    let btn: HTMLButtonElement;
    if (on) btn = h('button', { type: 'button', class: 'qm-btn qm-btn-sm qm-btn-quiet', disabled: true }, S.equipped);
    else if (owned) {
      btn = h('button', { type: 'button', class: 'qm-btn qm-btn-sm qm-btn-ghost qp-equip' }, S.equip);
      btn.addEventListener('click', () => void this.equip(item));
    } else if (lockedLevel) btn = h('button', { type: 'button', class: 'qm-btn qm-btn-sm qm-btn-quiet qp-locked', disabled: true }, S.locked(item.level));
    else {
      btn = h('button', { type: 'button', class: 'qm-btn qm-btn-sm qm-btn-yellow qp-buy', disabled: short > 0 }, S.buy(item.cost));
      btn.addEventListener('click', () => void this.buy(item));
    }
    if (this.store.busy) btn.disabled = true;
    const swatch = h('span', { class: `qp-swatch${item.glow ? ' is-glow' : ''}`, style: `--c: ${hex(item.color)}; --g: ${hex(item.glow || item.color)}; --b: ${hex(item.band || item.color)}`, 'aria-hidden': 'true' });
    const meta = h('span', { class: 'qp-meta' }, item.cost === 0 ? S.starter : `${item.cost} ${D.tuy}`, lockedLevel ? ` · ${D.needsLevel(item.level)}` : '', !owned && !lockedLevel && short > 0 ? ` · ${S.short(short)}` : '');
    return h(
      'li',
      { class: `qp-item${on ? ' is-on' : ''}${lockedLevel ? ' is-locked' : ''}`, 'data-item': item.id },
      swatch,
      h('span', { class: 'qp-item-text' }, h('b', {}, itemName(item.id)), h('span', { class: 'qp-item-stats' }, itemStats(item)), h('span', { class: 'qp-item-sub' }, meta, compare ? h('span', { class: `qp-vs${vs > 0 ? ' is-up' : ''}` }, compare) : null)),
      btn,
    );
  }

  private async buy(item: GearItem): Promise<void> {
    const err = await this.store.buy(item.id);
    if (err) return this.say(COPY.duck.errors[err] ?? COPY.duck.errors.generic!, true);
    this.say(COPY.duck.shop.bought(itemName(item.id)));
  }

  private async equip(item: GearItem): Promise<void> {
    const err = await this.store.equip(item.id);
    if (err) return this.say(COPY.duck.errors[err] ?? COPY.duck.errors.generic!, true);
    this.say(COPY.duck.shop.equippedNow(itemName(item.id)));
  }
}
