/**
 * The plaza's few bits of screen UI, kept minimal: a toast line, the tiny
 * bubble over a duck you clicked (Invite to team, Quack; on your own duck
 * Dance and Leave team), the invite you got (Join or No thanks, also Y and N),
 * your team's names in a corner, a first-visit key hint, a center dot while
 * the mouse is locked, a "click to walk" cue, the warp into a portal and two
 * touch buttons (Quack, Dance; chat has the room chat's own button). Text nodes only.
 */
import type { ShopId } from '@qwakk/shared/hub';
import { COPY } from '../ui/menu/copy.ts';
import './hub.css';

const H = () => COPY.hub;

export interface DuckTarget {
  id: string;
  pid: number;
  name: string;
  tag: string;
  level: number;
  self: boolean;
  teammate: boolean;
}

export interface HubUiHooks {
  invite(t: DuckTarget): void;
  quack(): void;
  dance(): void;
  leaveTeam(): void;
  answer(accept: boolean): void;
  /** The bubble needs the cursor (desktop): free it without opening the menu. */
  freeCursor(): void;
  /** Open a stall's shop (the Blacksmith, the Armorer). */
  shop(id: ShopId): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(cls: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', `hu-btn ${cls}`, label);
  b.type = 'button';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  return b;
}

export class HubUi {
  readonly root: HTMLElement;
  private readonly hooks: HubUiHooks;
  private readonly toastEl: HTMLElement;
  private readonly duckMenu: HTMLElement;
  private readonly inviteEl: HTMLElement;
  private readonly teamEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly cueEl: HTMLElement;
  private readonly dot: HTMLElement;
  private readonly warpEl: HTMLElement;
  private readonly touchEl: HTMLElement;
  /** At a market stall that sells Hunt Season gear: "E · Blacksmith" (a button on touch). */
  private readonly shopEl: HTMLButtonElement;
  private shopId: ShopId | null = null;
  private shopKey = '';
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private inviteTimer: ReturnType<typeof setTimeout> | null = null;
  /** The duck the bubble is open over, and the invite we hold (from pid). */
  target: DuckTarget | null = null;
  invite: { pid: number; name: string } | null = null;

  constructor(parent: HTMLElement, hooks: HubUiHooks) {
    this.hooks = hooks;
    this.root = el('div', 'hub-ui');
    this.toastEl = el('div', 'hu-toast');
    this.toastEl.setAttribute('role', 'status');
    this.toastEl.hidden = true;
    this.duckMenu = el('div', 'hu-bubble hu-duck');
    this.duckMenu.hidden = true;
    this.inviteEl = el('div', 'hu-bubble hu-invite');
    this.inviteEl.setAttribute('role', 'alert');
    this.inviteEl.hidden = true;
    this.teamEl = el('div', 'hu-team');
    this.teamEl.hidden = true;
    this.hintEl = el('div', 'hu-hint', H().hints);
    this.hintEl.hidden = true;
    this.cueEl = el('div', 'hu-cue');
    this.cueEl.append(el('div', 'hu-cue-title', H().title), el('div', 'hu-cue-sub', H().clickToWalk));
    this.cueEl.hidden = true;
    this.dot = el('div', 'hu-dot');
    this.dot.hidden = true;
    this.warpEl = el('div', 'hu-warp');
    this.warpEl.hidden = true;
    this.touchEl = el('div', 'hu-touch');
    this.touchEl.append(button('hu-touch-quack', H().quack, () => hooks.quack()), button('hu-touch-dance', H().dance, () => hooks.dance()));
    this.touchEl.hidden = true;
    this.shopEl = button('hu-shop', '', () => this.shopId && hooks.shop(this.shopId));
    this.shopEl.hidden = true;
    this.root.append(this.shopEl);
    this.root.append(this.cueEl, this.dot, this.teamEl, this.toastEl, this.duckMenu, this.inviteEl, this.hintEl, this.touchEl, this.warpEl);
    parent.append(this.root);
  }

  toast(text: string, action?: { label: string; run: () => void }, ms = 3600): void {
    this.toastEl.replaceChildren(el('span', 'hu-toast-text', text));
    if (action) this.toastEl.append(button('hu-toast-act', action.label, action.run));
    this.toastEl.hidden = false;
    this.toastEl.classList.remove('pop');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('pop');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toastEl.hidden = true), action ? ms + 2400 : ms);
  }

  /** Open the bubble over a duck (`inTeam`: you are in a team, for the own-duck bubble). */
  openDuck(t: DuckTarget, inTeam: boolean, teamFull: boolean): void {
    this.target = t;
    const h = H();
    const head = el('div', 'hu-bubble-head');
    head.append(el('b', '', t.name), el('span', 'hu-bubble-tag', t.tag ? `#${t.tag}` : ''), el('span', 'hu-bubble-lvl', t.level > 0 ? h.level(t.level) : h.guest));
    const row = el('div', 'hu-bubble-row');
    if (t.self) {
      row.append(button('hu-dance', h.dance, () => (this.closeDuck(), this.hooks.dance())));
      if (inTeam) row.append(button('hu-leave', h.leaveTeam, () => (this.closeDuck(), this.hooks.leaveTeam())));
    } else {
      if (!t.teammate && !teamFull) row.append(button('hu-invite-btn is-primary', h.invite, () => (this.closeDuck(), this.hooks.invite(t))));
      if (t.teammate) row.append(el('span', 'hu-mate-chip', h.teammate));
      row.append(button('hu-quack', h.quack, () => (this.closeDuck(), this.hooks.quack())));
    }
    const close = button('hu-close', '×', () => this.closeDuck());
    close.setAttribute('aria-label', h.close);
    this.duckMenu.replaceChildren(close, head, row);
    this.duckMenu.hidden = false;
    this.duckMenu.classList.remove('pop');
    void this.duckMenu.offsetWidth;
    this.duckMenu.classList.add('pop');
    this.hooks.freeCursor();
  }

  closeDuck(): void {
    this.target = null;
    this.duckMenu.hidden = true;
  }

  get duckOpen(): boolean {
    return !this.duckMenu.hidden;
  }

  /** An invite arrived: the bubble over your own duck. */
  showInvite(pid: number, name: string, tag: string, touch: boolean, ttlMs: number): void {
    this.invite = { pid, name };
    const h = H();
    const text = el('div', 'hu-invite-text');
    text.append(el('b', '', `${name}${tag ? `#${tag}` : ''}`), document.createTextNode(` ${h.invitesYou}`));
    const row = el('div', 'hu-bubble-row');
    row.append(button('is-primary hu-accept', touch ? h.accept : `${h.accept} (Y)`, () => this.hooks.answer(true)), button('hu-decline', touch ? h.decline : `${h.decline} (N)`, () => this.hooks.answer(false)));
    this.inviteEl.replaceChildren(text, row);
    this.inviteEl.hidden = false;
    this.inviteEl.classList.remove('pop');
    void this.inviteEl.offsetWidth;
    this.inviteEl.classList.add('pop');
    if (this.inviteTimer) clearTimeout(this.inviteTimer);
    this.inviteTimer = setTimeout(() => this.clearInvite(), ttlMs);
  }

  clearInvite(): void {
    this.invite = null;
    this.inviteEl.hidden = true;
  }

  /** Place the bubbles over their ducks (CSS px of the label anchor), or tuck them away when off screen. */
  place(duckAt: { x: number; y: number } | null, selfAt: { x: number; y: number } | null): void {
    if (!this.duckMenu.hidden) {
      if (duckAt) this.duckMenu.style.transform = `translate3d(${Math.round(duckAt.x)}px, ${Math.round(duckAt.y)}px, 0) translate(-50%, -100%)`;
      this.duckMenu.classList.toggle('is-off', !duckAt);
    }
    if (!this.inviteEl.hidden) {
      const at = selfAt ?? { x: window.innerWidth / 2, y: window.innerHeight * 0.4 };
      this.inviteEl.style.transform = `translate3d(${Math.round(at.x)}px, ${Math.round(at.y)}px, 0) translate(-50%, -100%)`;
    }
  }

  /** Your team in the corner (names; the leader marked), or nothing. */
  setTeam(members: readonly { name: string; tag: string; leader: boolean; you: boolean; busy: boolean }[]): void {
    if (members.length < 2) {
      this.teamEl.hidden = true;
      return;
    }
    const h = H();
    const list = el('ul', 'hu-team-list');
    for (const m of members) {
      const li = el('li', `hu-team-row${m.you ? ' is-you' : ''}${m.busy ? ' is-busy' : ''}`);
      li.append(el('span', 'hu-team-dot'), el('span', 'hu-team-name', m.name), el('span', 'hu-team-tag', `#${m.tag}`));
      if (m.leader) li.append(el('span', 'hu-team-lead', h.leader));
      else if (m.busy) li.append(el('span', 'hu-team-lead', h.inMatch));
      list.append(li);
    }
    this.teamEl.replaceChildren(el('div', 'hu-team-title', h.team), list);
    this.teamEl.hidden = false;
  }

  /** Desktop: the "click to walk around" cue while the mouse is free and no menu is open; the dot while locked. */
  setPointer(locked: boolean, cue: boolean): void {
    this.dot.hidden = !locked;
    this.cueEl.hidden = !cue;
  }

  /** The stall the duck stands at (null: none), as a key pill or, on touch, a button. */
  shopPrompt(id: ShopId | null, touch: boolean): void {
    this.shopId = id;
    const key = id ? `${id}|${touch ? 1 : 0}` : '';
    if (key === this.shopKey) return;
    this.shopKey = key;
    this.shopEl.hidden = !id;
    if (!id) return;
    const D = COPY.duck.shop;
    const name = id === 'smith' ? D.smith : D.armorer;
    this.shopEl.replaceChildren(...(touch ? [] : [el('kbd', 'hu-key', 'E')]), el('span', '', touch ? D.open(name) : name));
  }

  get shopOpen(): ShopId | null {
    return this.shopId;
  }

  showHint(on: boolean): void {
    this.hintEl.hidden = !on;
  }

  setTouch(on: boolean): void {
    this.touchEl.hidden = !on;
    this.hintEl.textContent = on ? H().touchHints : H().hints;
  }

  warp(text: string, color: string): void {
    this.closeDuck();
    this.warpEl.replaceChildren(el('div', 'hu-warp-text', text));
    this.warpEl.style.setProperty('--warp', color);
    this.warpEl.hidden = false;
    this.warpEl.classList.remove('on');
    void this.warpEl.offsetWidth;
    this.warpEl.classList.add('on');
  }

  dispose(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    if (this.inviteTimer) clearTimeout(this.inviteTimer);
    this.root.remove();
  }
}
