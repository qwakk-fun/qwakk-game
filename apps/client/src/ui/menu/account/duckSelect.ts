/**
 * The character select: the account's four nests side by side (a 2 by 2
 * grid on narrow screens), each duck in 3D on its podium (menuHero/roster.ts,
 * the portrait first and as the fallback) with its name, #tag, look and
 * level; empty nests hatch a new duck. Picking a nest turns that duck to the
 * viewer; Play enters the main menu as it. Also: delete a duck (type its
 * name), bring this device's guest duck in, the account and log out.
 * Arrow keys move the pick, Enter plays.
 */
import { gearTier } from '@qwakk/shared/duck';
import { CHARACTER_SLOTS, type CharacterView } from '@qwakk/shared/accounts';
import { ApiError } from '../api.ts';
import { characterCopy, characterOfLook } from '../characters.ts';
import { COPY } from '../copy.ts';
import { asset, h } from '../dom.ts';
import type { HeroModule } from '../heroSlot.ts';
import { icon } from '../icons.ts';
import { errorText } from '../nameStep.ts';
import { duckLevel, xpBar } from '../xpBar.ts';
import { claimGuest, deleteDuck } from './accountApi.ts';
import { CreateDuck } from './createDuck.ts';
import { openDialog } from './dialog.ts';
import type { AccountSession } from './session.ts';

const D = COPY.ducks;

export interface DuckSelectHooks {
  play(duck: CharacterView): void;
  account(): void;
  logout(): void;
  /** This device's guest duck that could move in, or null. */
  guestCarry(): { deviceToken: string; name: string; tag: string; look: number } | null;
  /** The guest duck moved in: forget the guest on this device. */
  claimed(): void;
  /** The account session is gone (401): back to sign-in. */
  expired(): void;
}

type Roster = Awaited<ReturnType<HeroModule['mountRoster']>>;

interface Nest {
  el: HTMLButtonElement;
  canvas: HTMLCanvasElement | null;
  duck: CharacterView | null;
}

export class DuckSelect {
  readonly el: HTMLElement;
  private readonly hooks: DuckSelectHooks;
  private readonly session: AccountSession;
  private readonly loadHero: (() => Promise<HeroModule>) | undefined;
  private readonly grid: HTMLElement;
  private readonly count: HTMLElement;
  private readonly email: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly deleteBtn: HTMLButtonElement;
  private readonly claimBtn: HTMLButtonElement;
  private readonly msg: HTMLElement;
  private readonly pickView: HTMLElement;
  private readonly create: CreateDuck;
  private nests: Nest[] = [];
  private picked = -1;
  private roster: Roster | null = null;
  private rosterGen = 0;
  private rosterFailed = false;
  private visible = false;
  private busy = false;

  constructor(session: AccountSession, hooks: DuckSelectHooks, loadHero?: () => Promise<HeroModule>) {
    this.session = session;
    this.hooks = hooks;
    this.loadHero = loadHero;
    this.grid = h('div', { class: 'qd-nests', role: 'radiogroup', 'aria-label': D.label });
    this.count = h('span', { class: 'qd-count' });
    this.email = h('span', { class: 'qd-email' });
    this.playBtn = h('button', { type: 'button', class: 'qm-btn qm-btn-yellow qd-play' }, h('span', { class: 'qd-play-text' }), icon('arrow'));
    this.deleteBtn = h('button', { type: 'button', class: 'qm-btn qm-btn-ghost qm-btn-sm qd-delete' }, icon('trash'), D.delete);
    this.claimBtn = h('button', { type: 'button', class: 'qm-btn qm-btn-ghost qm-btn-sm qd-claim', hidden: true }, icon('swap'), h('span', {}));
    this.msg = h('p', { class: 'qa-msg qd-msg', role: 'status', 'aria-live': 'polite' });
    const accountBtn = h('button', { type: 'button', class: 'qm-btn qm-btn-quiet qm-btn-sm qd-account' }, icon('user'), COPY.account.title);
    const logoutBtn = h('button', { type: 'button', class: 'qm-btn qm-btn-quiet qm-btn-sm qd-logout' }, icon('leave'), COPY.account.logout);
    accountBtn.addEventListener('click', () => this.hooks.account());
    logoutBtn.addEventListener('click', () => this.hooks.logout());
    this.playBtn.addEventListener('click', () => this.play());
    this.deleteBtn.addEventListener('click', () => this.confirmDelete());
    this.claimBtn.addEventListener('click', () => void this.claim());
    this.grid.addEventListener('keydown', (e) => this.onKey(e));

    this.pickView = h(
      'div',
      { class: 'qd-pick' },
      h(
        'div',
        { class: 'qd-head' },
        h('div', { class: 'qd-titles' }, h('h1', { class: 'qa-title' }, D.title, ' ', this.count), h('p', { class: 'qa-sub' }, D.sub)),
        h('div', { class: 'qd-who' }, h('span', { class: 'qd-email-wrap' }, icon('mail'), this.email), accountBtn, logoutBtn),
      ),
      this.grid,
      h('div', { class: 'qd-bar' }, this.playBtn, h('div', { class: 'qd-bar-side' }, this.claimBtn, this.deleteBtn)),
      this.msg,
    );
    this.create = new CreateDuck(
      {
        token: () => this.session.token,
        created: (duck) => {
          const a = this.session.account;
          if (a) this.session.update({ ...a, characters: [...a.characters.filter((c) => c.slot !== duck.slot), duck].sort((x, y) => x.slot - y.slot) });
          this.session.select(duck.id);
          this.showPick();
          this.say(COPY.create.done(`${duck.name}#${duck.tag}`));
        },
        back: () => this.showPick(),
      },
      loadHero,
    );
    this.el = h('section', { class: 'qd', 'aria-label': D.title }, this.pickView, this.create.el);
    this.create.el.hidden = true;
  }

  /** Show the screen (the account is loaded). */
  show(message?: string): void {
    this.visible = true;
    this.showPick();
    if (message) this.say(message);
  }

  /** Leave the screen: free the 3D ducks. */
  hide(): void {
    this.visible = false;
    this.create.close();
    this.stopRoster();
  }

  /** A loading or error line while the account loads (`retry` shows a button). */
  loading(text: string, error = false, retry?: () => void): void {
    this.visible = true;
    this.create.el.hidden = true;
    this.pickView.hidden = false;
    this.grid.replaceChildren(h('div', { class: 'qd-loading' }, error ? null : h('span', { class: 'qm-spin', 'aria-hidden': 'true' }), h('span', { class: error ? 'qm-error' : '' }, text), retry ? h('button', { type: 'button', class: 'qm-btn qm-btn-ghost qm-btn-sm', onclick: retry }, D.retry) : null));
    this.playBtn.disabled = true;
    this.deleteBtn.disabled = true;
    this.claimBtn.hidden = true;
  }

  private say(text: string, error = false): void {
    this.msg.textContent = text;
    this.msg.classList.toggle('is-error', error);
  }

  private showPick(): void {
    this.create.close();
    this.create.el.hidden = true;
    this.pickView.hidden = false;
    this.say('');
    this.render();
    this.startRoster();
  }

  private openCreate(slot?: number): void {
    this.stopRoster();
    this.pickView.hidden = true;
    this.create.el.hidden = false;
    this.create.open(slot);
  }

  private render(): void {
    const ducks = this.session.ducks;
    this.email.textContent = this.session.email;
    this.count.textContent = D.count(ducks.length);
    this.nests = [];
    const els: HTMLElement[] = [];
    for (let slot = 0; slot < CHARACTER_SLOTS; slot++) {
      const duck = ducks.find((d) => d.slot === slot) ?? null;
      const nest = duck ? this.duckNest(duck) : this.emptyNest(slot);
      this.nests.push(nest);
      els.push(nest.el);
    }
    this.grid.replaceChildren(...els);
    const active = this.session.active;
    this.pick(active ? this.nests.findIndex((n) => n.duck?.id === active.id) : -1, false);
    const carry = this.hooks.guestCarry();
    const free = ducks.length < CHARACTER_SLOTS;
    this.claimBtn.hidden = !carry || !free;
    if (carry) (this.claimBtn.lastElementChild as HTMLElement).textContent = D.claim(`${carry.name}#${carry.tag}`);
    if (ducks.length === 0) this.say(D.pickFirst);
    this.roster?.set(this.rosterSlots());
  }

  private duckNest(duck: CharacterView): Nest {
    const look = characterOfLook(duck.look);
    const canvas = h('canvas', { class: 'qd-canvas', width: 1, height: 1 });
    const el = h(
      'button',
      { type: 'button', role: 'radio', class: 'qd-nest', 'data-duck': duck.id, 'data-slot': duck.slot, style: `--qm-char-accent: ${look.accent}` },
      h('span', { class: 'qd-figure' }, h('span', { class: 'qd-podium', 'aria-hidden': 'true' }), h('img', { class: 'qd-portrait', src: asset(look.portrait), alt: '', width: 320, height: 320, decoding: 'async' }), canvas),
      h(
        'span',
        { class: 'qd-plate' },
        h('span', { class: 'qd-name' }, duck.name, h('span', { class: 'qd-tag' }, `#${duck.tag}`)),
        h('span', { class: 'qd-meta' }, characterCopy(look.id).name, h('span', { class: 'qd-dot', 'aria-hidden': 'true' }, '·'), h('span', { class: 'qd-level' }, D.level(duckLevel(duck))), duck.katana && gearTier(duck.katana) > 0 ? h('span', { class: 'qd-dot', 'aria-hidden': 'true' }, '·') : null, duck.katana && gearTier(duck.katana) > 0 ? h('span', { class: 'qd-katana' }, COPY.duck.items[duck.katana] ?? '') : null),
        xpBar(duck),
      ),
      h('span', { class: 'qd-check', 'aria-hidden': 'true' }, icon('check')),
    );
    el.addEventListener('click', () => this.pick(this.nests.findIndex((n) => n.el === el)));
    el.addEventListener('dblclick', () => this.play());
    return { el, canvas, duck };
  }

  private emptyNest(slot: number): Nest {
    const el = h(
      'button',
      { type: 'button', class: 'qd-nest is-empty', 'data-slot': slot, 'aria-label': `${D.empty}: ${D.create}` },
      h('span', { class: 'qd-figure' }, h('span', { class: 'qd-podium', 'aria-hidden': 'true' }), h('span', { class: 'qd-egg', 'aria-hidden': 'true' }, icon('plus'))),
      h('span', { class: 'qd-plate' }, h('span', { class: 'qd-name' }, D.empty), h('span', { class: 'qd-meta qd-create-cta' }, D.create)),
    );
    el.addEventListener('click', () => this.openCreate(slot));
    return { el, canvas: null, duck: null };
  }

  private pick(index: number, user = true): void {
    const nest = this.nests[index];
    if (!nest?.duck) index = this.nests.findIndex((n) => n.duck);
    this.picked = index;
    this.nests.forEach((n, i) => {
      if (!n.duck) return;
      const on = i === index;
      n.el.setAttribute('aria-checked', on ? 'true' : 'false');
      n.el.classList.toggle('is-on', on);
      n.el.tabIndex = on ? 0 : -1;
    });
    const duck = this.nests[index]?.duck ?? null;
    if (duck && user) this.session.select(duck.id);
    (this.playBtn.firstElementChild as HTMLElement).textContent = duck ? D.play(duck.name) : D.pickFirst;
    this.playBtn.disabled = !duck || this.busy;
    this.deleteBtn.disabled = !duck || this.busy;
    this.roster?.select(index);
  }

  private onKey(e: KeyboardEvent): void {
    const filled = this.nests.map((n, i) => (n.duck ? i : -1)).filter((i) => i >= 0);
    if (e.key === 'Enter' && this.nests[this.picked]?.duck && document.activeElement === this.nests[this.picked]?.el) {
      e.preventDefault();
      this.play();
      return;
    }
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step || filled.length === 0) return;
    e.preventDefault();
    const at = filled.indexOf(this.picked);
    const next = filled[(at + step + filled.length) % filled.length]!;
    this.pick(next);
    this.nests[next]?.el.focus();
  }

  private play(): void {
    const duck = this.nests[this.picked]?.duck;
    if (!duck || this.busy) return;
    this.session.select(duck.id);
    this.hooks.play(duck);
  }

  // ---- 3D -----------------------------------------------------------------

  private rosterSlots(): ({ canvas: HTMLCanvasElement; character: string } | null)[] {
    return this.nests.map((n) => (n.duck && n.canvas ? { canvas: n.canvas, character: characterOfLook(n.duck.look).id } : null));
  }

  private startRoster(): void {
    const load = this.loadHero;
    if (!load || this.roster || this.rosterFailed || !this.visible) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true) return;
    const gen = ++this.rosterGen;
    // After the screen has painted: the portraits show first.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (gen !== this.rosterGen) return;
        void (async () => {
          try {
            const mod = await load();
            if (gen !== this.rosterGen) return;
            const roster = await mod.mountRoster({ cancelled: () => gen !== this.rosterGen });
            if (gen !== this.rosterGen) return roster.dispose();
            this.roster = roster;
            roster.set(this.rosterSlots());
            roster.select(this.picked);
          } catch (err) {
            if (gen !== this.rosterGen) return;
            console.warn('[menu] 3D ducks unavailable, keeping the portraits', err);
            this.rosterFailed = true;
          }
        })();
      }),
    );
  }

  private stopRoster(): void {
    this.rosterGen++;
    this.roster?.dispose();
    this.roster = null;
  }

  // ---- delete and claim ---------------------------------------------------

  private confirmDelete(): void {
    const duck = this.nests[this.picked]?.duck;
    if (!duck) return;
    const X = COPY.deleteDuck;
    const input = h('input', { id: 'qd-confirm', class: 'qm-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: 16 });
    const msg = h('p', { class: 'qa-msg', role: 'status', 'aria-live': 'polite' });
    const submit = h('button', { type: 'submit', class: 'qm-btn qm-btn-danger', disabled: true }, icon('trash'), X.submit(duck.name));
    const cancel = h('button', { type: 'button', class: 'qm-btn qm-btn-ghost' }, X.cancel);
    const form = h('form', { class: 'qa-form', novalidate: true }, h('label', { class: 'qa-label', for: 'qd-confirm' }, X.confirmLabel(duck.name)), input, msg, h('div', { class: 'qa-dialog-actions' }, cancel, submit));
    const dialog = openDialog({ title: X.title(duck.name), body: [X.body(duck.name)], content: form, danger: true });
    cancel.addEventListener('click', () => dialog.close());
    input.addEventListener('input', () => {
      submit.disabled = input.value !== duck.name;
      msg.textContent = input.value && !duck.name.startsWith(input.value) ? X.mismatch : '';
      msg.classList.toggle('is-error', msg.textContent !== '');
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (input.value !== duck.name) return;
      void (async () => {
        const token = this.session.token;
        if (!token) return;
        submit.disabled = true;
        msg.replaceChildren(h('span', { class: 'qm-spin', 'aria-hidden': 'true' }));
        try {
          await deleteDuck(token, duck.id, input.value);
          const a = this.session.account;
          if (a) this.session.update({ ...a, characters: a.characters.filter((c) => c.id !== duck.id) });
          if (this.session.active?.id === duck.id) this.session.dropGameSession();
          dialog.close();
          this.showPick();
          this.say(X.done(duck.name));
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            dialog.close();
            return this.hooks.expired();
          }
          msg.textContent = errorText(err);
          msg.classList.add('is-error');
          submit.disabled = false;
        }
      })();
    });
  }

  private async claim(): Promise<void> {
    const carry = this.hooks.guestCarry();
    const token = this.session.token;
    if (!carry || !token || this.busy) return;
    this.busy = true;
    this.claimBtn.disabled = true;
    try {
      const { character } = await claimGuest(token, carry.deviceToken, carry.look);
      this.hooks.claimed();
      const a = this.session.account;
      if (a) this.session.update({ ...a, characters: [...a.characters, character].sort((x, y) => x.slot - y.slot) });
      this.session.select(character.id);
      this.render();
      this.say(D.claimed(`${character.name}#${character.tag}`));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return this.hooks.expired();
      // A guest that is gone or moved already: forget it here.
      if (err instanceof ApiError && err.code === 'no_guest') this.hooks.claimed();
      this.render();
      this.say(errorText(err), true);
    } finally {
      this.busy = false;
      this.claimBtn.disabled = false;
    }
  }
}
