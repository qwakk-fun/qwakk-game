/**
 * Battle royale HUD: minimap and compass with the zone direction, zone timer,
 * ducks alive and kills, the inventory bar (weapon slots, armor, backpack
 * load, heals with their keys), heal progress, the pickup prompt (with why
 * an item does not fit, and an open crate's contents), pickup and refusal
 * toasts, the full-screen map (M), the inventory screen (I,
 * inventoryPanel.ts), the Tab gear and scoreboard, banners (warm-up, plane,
 * spectating) and the results card. Plain DOM; per-frame updates only write
 * what changed.
 */
import { hint, keyLabel, touchUiOn } from '../../input/touch/mode.ts';
import { COPY } from '../../ui/menu/copy.ts';
import { InventoryPanel, type InvAction, type InvScreen } from './inventoryPanel.ts';
import { MapPainter, type MapOverlay } from './mapCanvas.ts';

export interface SlotView {
  has: boolean;
  name: string;
  mag: number;
  res: number;
  active: boolean;
}

export interface InventoryView {
  slots: [SlotView, SlotView];
  vest: number;
  vestPct: number;
  helmet: number;
  helmetPct: number;
  bandages: number;
  medkits: number;
  /** Backpack level, weight carried and capacity. */
  pack: number;
  load: number;
  capacity: number;
}

/** The contents of an open crate the prompt targets, with what does not fit. */
export interface CratePanelView {
  title: string;
  rows: { label: string; note: string }[];
}

export interface BrHudData {
  /** Zone line, for example "Zone shrinks in 0:42". */
  zoneText: string;
  /** Outside the current circle: a warning. */
  outside: boolean;
  alive: number;
  /** Teams still in (team modes), 0 to leave it out. */
  teams: number;
  kills: number;
  /** Heading of the camera (yaw) and the world angle toward the next circle (null: inside it or none). */
  yaw: number;
  zoneAngle: number | null;
  inv: InventoryView | null;
  /** Heal in progress: name and 0..1. */
  heal: { name: string; progress: number } | null;
  /** Prompt like "E  Rifle" (text, not HTML); `note` says why it does not fit; `alt` is a second key hint. */
  prompt: { key: string; text: string; note?: string; alt?: { key: string; text: string } } | null;
  /** The open crate the prompt targets. */
  crate: CratePanelView | null;
  /** Top banner (warm-up, plane, spectating), plain text lines. */
  banner: string[] | null;
}

export interface BoardRow {
  name: string;
  kills: number;
  alive: boolean;
  placement: number;
  me: boolean;
  bot: boolean;
  /** On your team. */
  ally: boolean;
}

export interface ResultCard {
  win: boolean;
  placement: number;
  total: number;
  kills: number;
  damage: number;
  survivedMs: number;
  killer: string;
  /** Ducks per team (1 solo); with more, places are team places out of `total` teams. */
  teamSize: number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const TAU = Math.PI * 2;
const wrap = (a: number): number => a - TAU * Math.floor((a + Math.PI) / TAU);

export class BrHud {
  readonly root: HTMLElement;
  private readonly mini: HTMLCanvasElement;
  private readonly big: HTMLCanvasElement;
  private readonly bigWrap: HTMLElement;
  private readonly mapHint: HTMLElement;
  private readonly compassStrip: HTMLElement;
  private readonly compassZone: HTMLElement;
  private readonly zone: HTMLElement;
  private readonly counts: HTMLElement;
  private readonly inv: HTMLElement;
  private readonly healBar: HTMLElement;
  private readonly healFill: HTMLElement;
  private readonly healName: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly cratePanel: HTMLElement;
  private readonly invPanel: InventoryPanel;
  private readonly banner: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly board: HTMLElement;
  private readonly card: HTMLElement;
  private readonly painter: MapPainter;
  private readonly labels: { name: string; x: number; z: number }[];
  private mapOpen = false;

  private last = { zone: '', counts: '', inv: '', prompt: '', crate: '', banner: '', board: '', outside: false };
  private miniClock = 0;
  private onWatch: (() => void) | null = null;
  private onBack: (() => void) | null = null;

  constructor(parent: HTMLElement, painter: MapPainter, labels: { name: string; x: number; z: number }[], inv: { action(a: InvAction): void; close(): void }) {
    this.painter = painter;
    this.labels = labels;
    this.root = el('div', 'br', parent);
    const top = el('div', 'br-topright', this.root);
    this.mini = el('canvas', 'br-mini', top);
    this.mini.width = 200;
    this.mini.height = 200;
    this.zone = el('div', 'br-zone', top);
    this.counts = el('div', 'br-counts', top);
    const compass = el('div', 'br-compass', this.root);
    this.compassStrip = el('div', 'br-compass-strip', compass);
    for (let deg = -360; deg <= 720; deg += 15) {
      const label = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][((deg % 360) + 360) % 360 / 45] ?? '';
      const t = el('span', deg % 45 === 0 ? 'br-tick major' : 'br-tick', this.compassStrip, deg % 45 === 0 ? label : '');
      t.style.left = `${deg * 2}px`;
    }
    this.compassZone = el('div', 'br-compass-zone', compass);
    el('div', 'br-compass-mark', compass);
    this.inv = el('div', 'br-inv', this.root);
    this.healBar = el('div', 'br-heal', this.root);
    this.healName = el('div', 'br-heal-name', this.healBar);
    const hb = el('div', 'br-heal-bar', this.healBar);
    this.healFill = el('div', 'br-heal-fill', hb);
    this.healBar.hidden = true;
    this.prompt = el('div', 'br-prompt', this.root);
    this.prompt.hidden = true;
    this.cratePanel = el('div', 'br-crate', this.root);
    this.cratePanel.hidden = true;
    this.banner = el('div', 'br-banner', this.root);
    this.banner.hidden = true;
    this.toasts = el('div', 'br-toasts', this.root);
    this.board = el('div', 'br-board', this.root);
    this.board.hidden = true;
    this.bigWrap = el('div', 'br-map', this.root);
    this.big = el('canvas', 'br-map-canvas', this.bigWrap);
    this.big.width = 900;
    this.big.height = 900;
    this.mapHint = el('div', 'br-map-hint', this.bigWrap, 'M to close');
    this.bigWrap.hidden = true;
    // Touch: a tap on the map closes it (the map takes taps only while the touch controls are on).
    this.bigWrap.addEventListener('click', (e) => {
      if (!touchUiOn()) return;
      e.stopPropagation();
      this.toggleMap();
    });
    this.card = el('div', 'br-card', this.root);
    this.card.hidden = true;
    this.invPanel = new InventoryPanel(this.root, inv.action, inv.close);
  }

  /** The inventory screen (null hides it). */
  showInventory(d: InvScreen | null): void {
    this.invPanel.show(d);
  }

  get inventoryVisible(): boolean {
    return this.invPanel.visible;
  }

  toggleMap(): void {
    this.mapOpen = !this.mapOpen;
    this.bigWrap.hidden = !this.mapOpen;
    this.mapHint.textContent = hint('M to close', COPY.touch.hints.mapClose);
  }

  get mapVisible(): boolean {
    return this.mapOpen;
  }

  update(dt: number, d: BrHudData, overlay: MapOverlay, mapHalf: number): void {
    // Minimap: 10 frames a second is plenty.
    this.miniClock -= dt;
    if (this.miniClock <= 0) {
      this.miniClock = 0.1;
      const c = overlay.me ?? { x: 0, z: 0 };
      this.painter.draw(this.mini, c.x, c.z, 260, overlay, null);
      if (this.mapOpen) this.painter.draw(this.big, 0, 0, mapHalf * 2, overlay, this.labels);
    }
    // Compass: 2 px per degree, north at yaw 0 (facing -z), east at yaw -90 deg.
    const heading = ((-d.yaw * 180) / Math.PI + 360) % 360;
    this.compassStrip.style.transform = `translateX(${-heading * 2}px)`;
    if (d.zoneAngle === null) this.compassZone.hidden = true;
    else {
      const rel = (wrap(d.yaw - d.zoneAngle) * 180) / Math.PI;
      this.compassZone.hidden = Math.abs(rel) > 70;
      this.compassZone.style.transform = `translateX(${rel * 2}px)`;
    }
    if (d.zoneText !== this.last.zone) {
      this.last.zone = d.zoneText;
      this.zone.textContent = d.zoneText;
    }
    if (d.outside !== this.last.outside) {
      this.last.outside = d.outside;
      this.zone.classList.toggle('outside', d.outside);
      this.root.classList.toggle('br-outside', d.outside);
    }
    const counts = `${d.alive} alive${d.teams > 0 ? ` · ${d.teams} ${d.teams === 1 ? 'team' : 'teams'}` : ''} · ${d.kills} ${d.kills === 1 ? 'kill' : 'kills'}`;
    if (counts !== this.last.counts) {
      this.last.counts = counts;
      this.counts.textContent = counts;
    }
    this.renderInventory(d.inv);
    if (d.heal) {
      this.healBar.hidden = false;
      this.healName.textContent = d.heal.name;
      this.healFill.style.width = `${Math.round(d.heal.progress * 100)}%`;
    } else this.healBar.hidden = true;
    const prompt = d.prompt ? JSON.stringify(d.prompt) + touchUiOn() : '';
    if (prompt !== this.last.prompt) {
      this.last.prompt = prompt;
      this.prompt.hidden = !d.prompt;
      this.prompt.replaceChildren();
      if (d.prompt) {
        const key = keyLabel(d.prompt.key);
        if (key) el('kbd', 'br-key', this.prompt, key);
        el('span', '', this.prompt, d.prompt.text);
        if (d.prompt.note) el('span', 'br-prompt-note', this.prompt, d.prompt.note);
        if (d.prompt.alt) {
          el('kbd', 'br-key alt', this.prompt, keyLabel(d.prompt.alt.key));
          el('span', 'br-prompt-alt', this.prompt, d.prompt.alt.text);
        }
      }
    }
    const crate = d.crate ? JSON.stringify(d.crate) : '';
    if (crate !== this.last.crate) {
      this.last.crate = crate;
      this.cratePanel.hidden = !d.crate;
      this.cratePanel.replaceChildren();
      if (d.crate) {
        el('div', 'br-crate-title', this.cratePanel, d.crate.title);
        for (const r of d.crate.rows) {
          const row = el('div', `br-crate-row${r.note ? ' dim' : ''}`, this.cratePanel);
          el('span', '', row, r.label);
          if (r.note) el('span', 'br-crate-note', row, r.note);
        }
      }
    }
    const banner = d.banner ? d.banner.join('\n') : '';
    if (banner !== this.last.banner) {
      this.last.banner = banner;
      this.banner.hidden = !d.banner;
      this.banner.replaceChildren();
      if (d.banner) d.banner.forEach((line, i) => el('div', i === 0 ? 'br-banner-big' : 'br-banner-sub', this.banner, line));
    }
  }

  private renderInventory(inv: InventoryView | null): void {
    const key = inv ? JSON.stringify(inv) : '';
    if (key === this.last.inv) return;
    this.last.inv = key;
    this.inv.replaceChildren();
    if (!inv) return;
    inv.slots.forEach((s, i) => {
      const slot = el('div', `br-slot${s.active ? ' active' : ''}${s.has ? '' : ' empty'}`, this.inv);
      el('kbd', 'br-key', slot, String(i + 1));
      el('span', 'br-slot-name', slot, s.has ? s.name : 'Empty');
      if (s.has) el('span', 'br-slot-ammo', slot, `${s.mag} / ${s.res}`);
    });
    const gear = el('div', 'br-gear', this.inv);
    const piece = (label: string, level: number, pct: number) => {
      const g = el('div', `br-piece${level ? '' : ' none'}`, gear);
      el('span', 'br-piece-name', g, level ? `${label} ${level}` : label);
      const bar = el('div', 'br-piece-bar', g);
      const fill = el('div', 'br-piece-fill', bar);
      fill.style.width = `${level ? Math.round(pct * 100) : 0}%`;
    };
    piece('Vest', inv.vest, inv.vestPct);
    piece('Helmet', inv.helmet, inv.helmetPct);
    // The backpack: load against capacity (orange when full).
    const share = inv.capacity > 0 ? Math.min(1, inv.load / inv.capacity) : 0;
    const pack = el('div', `br-piece br-pack${share >= 0.999 ? ' full' : ''}`, gear);
    el('span', 'br-piece-name', pack, `${inv.pack ? `Pack ${inv.pack}` : 'Pack'} ${Math.round(inv.load)}/${inv.capacity}`);
    const packFill = el('div', 'br-piece-fill', el('div', 'br-piece-bar', pack));
    packFill.style.width = `${Math.round(share * 100)}%`;
    const heals = el('div', 'br-heals', this.inv);
    for (const [k, name, n] of [['4', 'Bandage', inv.bandages], ['5', 'Medkit', inv.medkits]] as const) {
      const h = el('div', `br-healslot${n > 0 ? '' : ' empty'}`, heals);
      el('kbd', 'br-key', h, k);
      el('span', '', h, `${name} ${n}`);
    }
  }

  /** A short line for a pickup ("+30 Rifle ammo"), or a refusal (`no`). */
  toast(text: string, no = false): void {
    const t = el('div', no ? 'br-toast no' : 'br-toast', this.toasts, text);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove();
    setTimeout(() => t.remove(), 2200);
  }

  /** Tab: inventory on the left, every duck on the right. Null hides it. */
  showBoard(rows: BoardRow[] | null, inv: InventoryView | null): void {
    if (!rows) {
      this.board.hidden = true;
      return;
    }
    const sorted = [...rows].sort((a, b) => Number(b.alive) - Number(a.alive) || (a.alive ? b.kills - a.kills : a.placement - b.placement));
    const key = JSON.stringify([sorted, inv]);
    this.board.hidden = false;
    if (key === this.last.board) return;
    this.last.board = key;
    this.board.replaceChildren();
    const left = el('div', 'br-board-inv', this.board);
    el('div', 'br-board-title', left, 'Your gear');
    if (inv) {
      for (const s of inv.slots) el('div', 'br-board-line', left, s.has ? `${s.name}  ${s.mag} / ${s.res}` : 'Empty slot');
      el('div', 'br-board-line', left, inv.vest ? `Vest level ${inv.vest}, ${Math.round(inv.vestPct * 100)}%` : 'No vest');
      el('div', 'br-board-line', left, inv.helmet ? `Helmet level ${inv.helmet}, ${Math.round(inv.helmetPct * 100)}%` : 'No helmet');
      el('div', 'br-board-line', left, `Bandages ${inv.bandages} (4), medkits ${inv.medkits} (5)`);
      el('div', 'br-board-line', left, `${inv.pack ? `Backpack level ${inv.pack}` : 'No backpack'}, ${Math.round(inv.load)} / ${inv.capacity} carried`);
      el('div', 'br-board-line hint', left, hint('I opens the inventory', COPY.touch.hints.boardInventory));
    }
    const right = el('div', 'br-board-list', this.board);
    el('div', 'br-board-title', right, 'Ducks');
    for (const r of sorted) {
      const row = el('div', `br-board-row${r.me ? ' me' : ''}${r.ally ? ' ally' : ''}${r.alive ? '' : ' out'}`, right);
      el('span', 'n', row, r.name);
      el('span', 'k', row, `${r.kills}`);
      el('span', 'p', row, r.alive ? 'alive' : `#${r.placement}`);
    }
  }

  /** Results card on death or victory. Buttons: keep watching, or back to the menu. */
  showResult(r: ResultCard, onWatch: (() => void) | null, onBack: () => void): void {
    this.onWatch = onWatch;
    this.onBack = onBack;
    const c = this.card;
    c.replaceChildren();
    c.hidden = false;
    c.classList.toggle('win', r.win);
    const team = r.teamSize > 1;
    const others = Math.max(0, r.total - 1);
    if (r.win) {
      el('div', 'br-card-eyebrow', c, team ? 'Last team standing' : 'Last duck standing');
      el('div', 'br-card-title', c, 'Winner winner, bread dinner');
      el('div', 'br-card-sub', c, team ? `Your team out-quacked ${others} ${others === 1 ? 'team' : 'teams'} on Sainte-Canard. The pond is yours.` : `You out-quacked ${others} ${others === 1 ? 'duck' : 'ducks'} on Sainte-Canard. The pond is yours.`);
    } else {
      el('div', 'br-card-eyebrow', c, team ? `Team #${r.placement} of ${r.total}` : `#${r.placement} of ${r.total}`);
      el('div', 'br-card-title', c, team ? 'Squad plucked!' : 'Plucked!');
      el('div', 'br-card-sub', c, team ? 'Your whole team is out. Regroup and drop again.' : r.killer ? `Taken out by ${r.killer}. Shake off the feathers and drop again.` : 'Shake off the feathers and drop again.');
    }
    const stats = el('div', 'br-card-stats', c);
    for (const [label, value] of [
      ['Place', `#${r.placement}`],
      ['Kills', `${r.kills}`],
      ['Damage', `${r.damage}`],
      ['Survived', clock(r.survivedMs / 1000)],
    ] as const) {
      const s = el('div', 'br-stat', stats);
      el('div', 'v', s, value);
      el('div', 'l', s, label);
    }
    const buttons = el('div', 'br-card-buttons', c);
    if (onWatch) {
      const w = el('button', 'br-btn ghost', buttons, 'Watch the rest');
      w.type = 'button';
      w.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hideResult();
        this.onWatch?.();
      });
    }
    const b = el('button', 'br-btn', buttons, 'Back to the pond');
    b.type = 'button';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onBack?.();
    });
  }

  hideResult(): void {
    this.card.hidden = true;
  }

  get resultVisible(): boolean {
    return !this.card.hidden;
  }

  dispose(): void {
    this.root.remove();
  }
}
