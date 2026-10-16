/**
 * The inventory screen (I): what is in reach on the left (open crates and
 * items on the ground, each with Take), the backpack in the middle (ammo and
 * heals with their weight, Drop buttons) and worn gear on the right (both
 * guns, vest, helmet, backpack, each with Drop), under a capacity bar. Every
 * button is a request; the server decides and the screen shows the result.
 * Plain DOM, rebuilt only when its data changes.
 */

export type InvAction = { t: 'drop'; kind: number; amount: number } | { t: 'take'; num: number; index: number; kind: number };

export interface InvRow {
  label: string;
  /** Right-hand detail: weight, "12 / 30", "60%". */
  detail: string;
  actions: { label: string; act: InvAction }[];
  /** Why it cannot be taken (dimmed row), or ''. */
  note: string;
  /** Hotkey hint, like "1" or "4". */
  key?: string;
}

export interface InvScreen {
  load: number;
  capacity: number;
  pack: number;
  equipped: InvRow[];
  carried: InvRow[];
  nearby: { title: string; rows: InvRow[] }[];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

const num = (v: number): string => String(Math.round(v * 100) / 100);

export class InventoryPanel {
  readonly root: HTMLElement;
  private last = '';
  private actions: InvAction[] = [];

  constructor(parent: HTMLElement, onAction: (a: InvAction) => void, onClose: () => void) {
    this.root = el('div', 'br-invscreen', parent);
    this.root.hidden = true;
    this.root.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      if (b.dataset.close) return onClose();
      const a = this.actions[Number(b.dataset.a)];
      if (a) onAction(a);
    });
    // Keep clicks inside the screen from reaching the canvas (which would lock the mouse).
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  show(d: InvScreen | null): void {
    if (!d) {
      this.root.hidden = true;
      this.last = '';
      return;
    }
    this.root.hidden = false;
    const key = JSON.stringify(d);
    if (key === this.last) return;
    this.last = key;
    this.actions = [];
    const r = this.root;
    r.replaceChildren();
    const head = el('div', 'br-inv-head', r);
    el('div', 'br-inv-title', head, 'Inventory');
    const cap = el('div', 'br-inv-cap', head);
    el('span', 'br-inv-cap-label', cap, d.pack > 0 ? `Backpack level ${d.pack}` : 'No backpack');
    const bar = el('div', 'br-inv-cap-bar', cap);
    const fill = el('div', 'br-inv-cap-fill', bar);
    const share = d.capacity > 0 ? Math.min(1, d.load / d.capacity) : 0;
    fill.style.width = `${Math.round(share * 100)}%`;
    fill.classList.toggle('full', share >= 0.999);
    fill.classList.toggle('high', share >= 0.85 && share < 0.999);
    el('span', 'br-inv-cap-num', cap, `${num(d.load)} / ${num(d.capacity)}`);
    const close = el('button', 'br-inv-close', head, 'Close (I)');
    close.type = 'button';
    close.dataset.close = '1';

    const cols = el('div', 'br-inv-cols', r);
    const near = el('div', 'br-inv-col', cols);
    el('div', 'br-board-title', near, 'In reach');
    if (d.nearby.length === 0) el('div', 'br-inv-empty', near, 'Nothing in reach. Walk up to a crate or an item.');
    for (const g of d.nearby) {
      el('div', 'br-inv-group', near, g.title);
      for (const row of g.rows) this.row(near, row);
    }
    const bag = el('div', 'br-inv-col', cols);
    el('div', 'br-board-title', bag, 'Backpack');
    if (d.carried.length === 0) el('div', 'br-inv-empty', bag, 'Empty. Ammo and heals go here.');
    for (const row of d.carried) this.row(bag, row);
    const worn = el('div', 'br-inv-col', cols);
    el('div', 'br-board-title', worn, 'Equipped');
    for (const row of d.equipped) this.row(worn, row);
    el('div', 'br-inv-hint', r, 'Guns, armor and the backpack weigh nothing. Ammo and heals fill the backpack. Things you drop land at your feet for anyone to take.');
  }

  private row(parent: HTMLElement, row: InvRow): void {
    const line = el('div', `br-inv-row${row.note ? ' dim' : ''}`, parent);
    if (row.key) el('kbd', 'br-key', line, row.key);
    const text = el('span', 'br-inv-text', line);
    el('span', 'br-inv-name', text, row.label);
    if (row.note || row.detail) el('span', 'br-inv-detail', text, row.note || row.detail);
    const btns = el('span', 'br-inv-btns', line);
    for (const a of row.actions) {
      const b = el('button', `br-ibtn${a.act.t === 'take' ? ' take' : ''}`, btns, a.label);
      b.type = 'button';
      b.dataset.a = String(this.actions.length);
      this.actions.push(a.act);
    }
  }
}
