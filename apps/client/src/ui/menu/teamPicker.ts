/**
 * The battle royale mode picker (Solo, Duo, Squad): the team size of a room
 * you create and what Quick Play looks for. Modes too small for your party
 * are off, and the pick moves up to fit it.
 */
import { TEAM_SIZES, teamSizeFor } from '@qwakk/shared/lobby';
import { COPY } from './copy.ts';
import { h } from './dom.ts';

const M = COPY.modes;

export class TeamPicker {
  readonly el: HTMLElement;
  private readonly buttons = new Map<number, HTMLButtonElement>();
  private pick = 1;
  private partySize = 1;
  private busy = false;
  /** Team sizes the server lets players open now (GET /api/status). */
  private modes = new Set<number>(TEAM_SIZES);

  constructor() {
    this.el = h('div', { class: 'qm-modes', role: 'radiogroup', 'aria-label': M.label });
    for (const t of TEAM_SIZES) {
      const b = h('button', { type: 'button', class: 'qm-mode', role: 'radio', 'data-team': t }, M.names[t] ?? `${t}`);
      b.addEventListener('click', () => {
        if (t < this.partySize || !this.modes.has(t)) return;
        this.pick = t;
        this.render();
      });
      this.buttons.set(t, b);
      this.el.append(b);
    }
    this.el.addEventListener('keydown', (e) => {
      const order = [...this.buttons.values()].filter((b) => !b.disabled);
      const i = order.indexOf(document.activeElement as HTMLButtonElement);
      if (i < 0 || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      e.preventDefault();
      const next = order[(i + (e.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length]!;
      next.click();
      next.focus();
    });
    this.render();
  }

  /** The team size picked (never smaller than the party; an open mode when there is one). */
  get mode(): number {
    const want = Math.max(this.pick, teamSizeFor(this.partySize));
    if (this.modes.has(want)) return want;
    return TEAM_SIZES.find((t) => t >= want && this.modes.has(t)) ?? TEAM_SIZES.find((t) => t >= this.partySize && this.modes.has(t)) ?? want;
  }

  /** The modes the server runs now; the others are off. */
  setModes(modes: readonly number[]): void {
    const next = new Set(modes.filter((t) => (TEAM_SIZES as readonly number[]).includes(t)));
    if (next.size === this.modes.size && [...next].every((t) => this.modes.has(t))) return;
    this.modes = next;
    this.render();
  }

  /** Your party's size (1 without one): smaller modes switch off, the pick moves up. */
  setPartySize(n: number): void {
    const size = Math.max(1, n);
    if (size === this.partySize) return;
    this.partySize = size;
    if (this.pick < size) this.pick = teamSizeFor(size);
    this.render();
  }

  setBusy(on: boolean): void {
    this.busy = on;
    this.render();
  }

  private render(): void {
    for (const [t, b] of this.buttons) {
      const on = t === this.mode;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle('is-on', on);
      const off = !this.modes.has(t);
      b.disabled = this.busy || t < this.partySize || off;
      b.title = t < this.partySize ? M.tooSmall : off ? M.off : '';
    }
  }
}
