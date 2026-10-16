/**
 * The main menu at qwakk.fun/game: nickname and #tag, Play (battle royale or
 * deathmatch), the live room lists, leaderboard, settings, how to play. Pure DOM and no game
 * imports, so it paints before the Three.js and Rapier bundle has loaded.
 */
import { loadSettings, toGameSettings, type GameSettings } from '../../settings.ts';
import { ApiError, fetchMe, type MeData } from './api.ts';
import { COPY, LINKS } from './copy.ts';
import { asset, h } from './dom.ts';
import { HeroSlot, type HeroModule } from './heroSlot.ts';
import { ensureSession, loadIdentity, NAME_RE, rememberName, suggestName } from './identity.ts';
import { LOBBY_ERROR } from '@qwakk/shared/lobby';
import { LeaderboardPanel } from './leaderboardPanel.ts';
import { RoomsPanel } from './roomsPanel.ts';
import { matchPoints } from './score.ts';
import { SettingsPanel } from './settingsPanel.ts';
import '@fontsource-variable/geist/wght.css';
import '@fontsource-variable/geist-mono/wght.css';
import './menu.css';

export type GameMode = 'br' | 'dm';
export type ExitReason = 'ended' | 'left' | 'disconnected';

/** Optional numbers the game may hand back with onGameExit. */
export interface MatchSummary {
  mode?: GameMode;
  placement?: number;
  players?: number;
  kills?: number;
  points?: number;
}

export interface StartOptions {
  mode: GameMode;
  /** Join this room from the list (joinById; battle royale or deathmatch) ... */
  roomId?: string;
  /** ... or open a new room (create). Neither: Quick Play (joinOrCreate). */
  create?: boolean;
  token?: string;
  name?: string;
  settings: GameSettings;
}

export interface MenuHooks {
  /** Load the game and join; resolves once the player is in. */
  start(opts: StartOptions): Promise<void>;
  /** Warm the game bundle in the background after the menu has painted. */
  prefetch?(): void;
  /** Show the graphics preset (only when the game applies it). */
  showQuality?: boolean;
  /** Load the 3D duck for the Play tab (src/menuHero); without it the image stays. */
  hero?(): Promise<HeroModule>;
}

type Tab = 'play' | 'leaderboard' | 'settings' | 'howto';

/** Join refusals the menu explains (matchmaking or the room's onAuth). */
const JOIN_ERRORS: Record<number, string> = {
  [LOBBY_ERROR.createLimited]: 'create_limited',
  [LOBBY_ERROR.roomsFull]: 'rooms_full',
  /** Colyseus MATCHMAKE_INVALID_CRITERIA: no open room (deathmatch Quick Play with every room full). */
  521: 'dm_full',
  /** Colyseus MATCHMAKE_INVALID_ROOM_ID: the room is gone, locked (started) or full. */
  522: 'room_closed',
  /** gameRoom.ts JOIN_ERROR.alreadyInMatch. */
  4409: 'already_in',
};

const isTouchOnly = (): boolean => !matchMedia('(any-pointer: fine)').matches;

export class Menu {
  readonly root: HTMLElement;
  private readonly hooks: MenuHooks;
  private readonly tabs = new Map<Tab, { button: HTMLButtonElement; panel: HTMLElement }>();
  private readonly nameInput: HTMLInputElement;
  private readonly tagEl: HTMLElement;
  private readonly nameMsg: HTMLElement;
  private readonly turnstileHost: HTMLElement;
  private readonly status: HTMLElement;
  private readonly result: HTMLElement;
  private readonly playButtons: HTMLButtonElement[] = [];
  private readonly leaderboard = new LeaderboardPanel();
  private readonly settingsPanel: SettingsPanel;
  private readonly rooms: RoomsPanel;
  private readonly hero: HeroSlot;
  private busy = false;
  private before: MeData | null = null;
  private lastMode: GameMode = 'br';

  constructor(hooks: MenuHooks) {
    this.hooks = hooks;
    this.settingsPanel = new SettingsPanel(hooks.showQuality === true);
    this.rooms = new RoomsPanel({
      join: (roomId) => void this.play('br', { roomId }),
      create: () => void this.play('br', { create: true }),
      joinDm: (roomId) => void this.play('dm', { roomId }),
    });
    const id = loadIdentity();

    this.nameInput = h('input', {
      id: 'qm-name',
      class: 'qm-input',
      type: 'text',
      inputmode: 'text',
      autocomplete: 'nickname',
      spellcheck: 'false',
      maxlength: 16,
      placeholder: COPY.namePlaceholder,
      'aria-describedby': 'qm-name-msg',
    });
    this.nameInput.value = id.name ?? suggestName();
    this.tagEl = h('span', { class: 'qm-tag', 'aria-label': 'Your tag' }, id.tag && id.name === this.nameInput.value ? `#${id.tag}` : '#----');
    this.nameMsg = h('p', { id: 'qm-name-msg', class: 'qm-name-msg' }, COPY.nameHint);
    this.turnstileHost = h('div', { class: 'qm-turnstile', hidden: true });
    this.status = h('div', { class: 'qm-status', role: 'status', 'aria-live': 'polite' });
    this.result = h('div', { class: 'qm-result', hidden: true, 'aria-live': 'polite' });

    const nameForm = h(
      'form',
      { class: 'qm-name', novalidate: true },
      h('label', { for: 'qm-name', class: 'qm-label' }, COPY.nameLabel),
      h('div', { class: 'qm-name-field' }, this.nameInput, this.tagEl),
      this.nameMsg,
      this.turnstileHost,
    );
    nameForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.commitName().catch(() => {}); // the error is shown under the field
    });
    this.nameInput.addEventListener('change', () => this.commitName().catch(() => {}));
    this.nameInput.addEventListener('input', () => {
      this.tagEl.textContent = '#----';
      this.setNameMsg(NAME_RE.test(this.nameInput.value.trim()) || this.nameInput.value === '' ? COPY.nameHint : COPY.errors.name_format!, false);
    });

    const brButton = h('button', { type: 'button', class: 'qm-btn qm-btn-play', 'data-mode': 'br' }, h('span', { class: 'qm-btn-title' }, COPY.playBr), h('span', { class: 'qm-btn-sub' }, COPY.playBrSub));
    const dmButton = h('button', { type: 'button', class: 'qm-btn qm-btn-secondary', 'data-mode': 'dm' }, h('span', { class: 'qm-btn-title' }, COPY.playDm), h('span', { class: 'qm-btn-sub' }, COPY.playDmSub));
    for (const b of [brButton, dmButton]) {
      b.addEventListener('click', () => void this.play(b.dataset.mode as GameMode));
      this.playButtons.push(b);
    }

    const mobile = isTouchOnly();
    if (mobile) for (const b of this.playButtons) b.disabled = true;

    const playPanel = h(
      'div',
      { class: 'qm-hero' },
      h('p', { class: 'qm-kicker' }, h('span', { class: 'qm-prompt', 'aria-hidden': 'true' }, '>'), COPY.kicker, h('span', { class: 'qm-cursor', 'aria-hidden': 'true' })),
      h('h1', { class: 'qm-title' }, `${COPY.title} `, h('span', {}, COPY.titleAccent)),
      h('p', { class: 'qm-tagline' }, COPY.tagline),
      mobile ? h('p', { class: 'qm-mobile', role: 'note' }, COPY.desktopOnly) : null,
      nameForm,
      h('div', { class: 'qm-play' }, brButton, dmButton),
      this.status,
      this.result,
      this.rooms.el,
      this.rooms.dmEl,
    );

    const howto = h(
      'div',
      { class: 'qm-panel-inner qm-howto' },
      h('div', { class: 'qm-panel-head' }, h('h2', {}, COPY.howto.heading), h('p', { class: 'qm-sub' }, COPY.howto.intro)),
      h('dl', { class: 'qm-keys' }, ...COPY.howto.keys.flatMap(([k, v]) => [h('dt', {}, ...k.split(' ').map((part) => (part === '/' ? ' / ' : h('kbd', {}, part)))), h('dd', {}, v)])),
      h('p', { class: 'qm-fine' }, COPY.howto.fair),
    );

    const tabBar = h('nav', { class: 'qm-tabs', role: 'tablist', 'aria-label': 'Menu' });
    const main = h('main', { class: 'qm-main' });
    const panels: [Tab, HTMLElement][] = [
      ['play', playPanel],
      ['leaderboard', this.leaderboard.el],
      ['settings', this.settingsPanel.el],
      ['howto', howto],
    ];
    for (const [tab, content] of panels) {
      const button = h('button', { type: 'button', role: 'tab', id: `qm-tab-${tab}`, 'aria-controls': `qm-panel-${tab}` }, COPY.tabs[tab]);
      const panel = h('section', { id: `qm-panel-${tab}`, class: `qm-panel qm-panel-${tab}`, role: 'tabpanel', 'aria-labelledby': `qm-tab-${tab}`, tabindex: tab === 'play' ? undefined : -1 }, content);
      button.addEventListener('click', () => this.select(tab));
      this.tabs.set(tab, { button, panel });
      tabBar.append(button);
      main.append(panel);
    }
    tabBar.addEventListener('keydown', (e) => {
      const order = [...this.tabs.keys()];
      const i = order.findIndex((t) => this.tabs.get(t)!.button === document.activeElement);
      if (i < 0) return;
      let j = -1;
      if (e.key === 'ArrowRight') j = (i + 1) % order.length;
      else if (e.key === 'ArrowLeft') j = (i + order.length - 1) % order.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = order.length - 1;
      if (j < 0) return;
      e.preventDefault();
      this.select(order[j]!);
      this.tabs.get(order[j]!)!.button.focus();
    });

    // The image paints first; the 3D duck that aims at the cursor fades in over it (heroSlot.ts).
    const duck = h('div', { class: 'qm-art-duck' }, h('img', { src: asset('ui/duck-rifle.webp'), alt: '', width: 800, height: 800, decoding: 'async', fetchpriority: 'high' }));
    this.hero = new HeroSlot(duck, hooks.hero?.bind(hooks));
    const art = h('div', { class: 'qm-art', 'aria-hidden': 'true' }, h('div', { class: 'qm-art-glow' }), duck);

    this.root = h(
      'div',
      { id: 'menu', class: 'qm' },
      h('div', { class: 'qm-bg', 'aria-hidden': 'true' }),
      h(
        'header',
        { class: 'qm-top' },
        h('a', { class: 'qm-brand', href: LINKS.home, 'aria-label': 'Qwakk home' }, h('img', { src: asset('ui/brand-mark.svg'), alt: '', width: 32, height: 32 }), h('span', {}, 'Qwakk')),
        tabBar,
      ),
      h('div', { class: 'qm-stage' }, main, art),
      h(
        'footer',
        { class: 'qm-foot' },
        h('nav', { 'aria-label': 'Links' }, h('a', { href: LINKS.home }, COPY.footer.home), h('a', { href: LINKS.terms }, COPY.footer.terms), h('a', { href: LINKS.privacy }, COPY.footer.privacy)),
        h('p', {}, COPY.footer.note),
      ),
      h('div', { class: 'qm-screen', 'aria-hidden': 'true' }),
    );
    this.select('play');
  }

  /** Put the menu on the page (once) and show it, with the last round's result if there is one. */
  show(exit?: { reason: ExitReason; summary?: MatchSummary }): void {
    if (!this.root.isConnected) document.body.append(this.root);
    this.root.hidden = false;
    document.body.classList.add('qm-open');
    this.setBusy(false);
    this.status.replaceChildren();
    this.rooms.start();
    if (exit) void this.showResult(exit.reason, exit.summary);
    this.select('play');
    if (!isTouchOnly()) this.playButtons[0]?.focus({ preventScroll: true });
    // After paint: the 3D duck, then the game bundle (they share the Three.js chunk).
    const later = (): void => {
      if (!this.root.hidden && !this.busy) this.hero.start();
      this.hooks.prefetch?.();
    };
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) idle(later, { timeout: 1500 });
    else setTimeout(later, 300);
    // Get or refresh the #tag quietly (no Turnstile prompt until Play).
    const id = loadIdentity();
    if (id.deviceToken && NAME_RE.test(this.nameInput.value.trim())) this.commitName(true).catch(() => {});
  }

  hide(): void {
    this.rooms.stop();
    this.hero.stop();
    this.root.hidden = true;
    document.body.classList.remove('qm-open');
  }

  private select(tab: Tab): void {
    for (const [t, { button, panel }] of this.tabs) {
      const on = t === tab;
      button.setAttribute('aria-selected', on ? 'true' : 'false');
      button.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
    }
    this.root.dataset.tab = tab;
    this.hero.setActive(tab === 'play');
    if (tab === 'leaderboard') void this.leaderboard.load();
  }

  private setNameMsg(text: string, error: boolean): void {
    this.nameMsg.textContent = text;
    this.nameMsg.classList.toggle('is-error', error);
    this.nameInput.setAttribute('aria-invalid', error ? 'true' : 'false');
  }

  private errorText(err: unknown): string {
    const code = err instanceof ApiError ? err.code : err instanceof Error ? err.message : 'generic';
    return COPY.errors[code] ?? COPY.errors.generic!;
  }

  /** Validate the name and get a session (and #tag) for it. Returns the session token, or null. */
  private async commitName(quiet = false): Promise<{ token: string } | null> {
    const name = this.nameInput.value.trim();
    if (!NAME_RE.test(name)) {
      if (!quiet) this.setNameMsg(COPY.errors.name_format!, true);
      return null;
    }
    rememberName(name);
    if (!quiet) this.setNameMsg(COPY.nameSaving, false);
    try {
      const s = await ensureSession(name, quiet ? undefined : this.turnstileHost);
      if (this.nameInput.value.trim() === name) {
        this.tagEl.textContent = `#${s.tag}`;
        this.setNameMsg(quiet ? COPY.nameHint : COPY.nameSaved, false);
      }
      return { token: s.token };
    } catch (err) {
      if (!quiet) this.setNameMsg(this.errorText(err), true);
      else this.setNameMsg(COPY.nameHint, false);
      throw err;
    }
  }

  private setBusy(on: boolean): void {
    this.busy = on;
    this.root.classList.toggle('is-busy', on);
    for (const b of this.playButtons) b.disabled = on || isTouchOnly();
    this.rooms.setBusy(on || isTouchOnly());
    this.nameInput.disabled = on;
  }

  private setStatus(text: string): void {
    this.status.replaceChildren(h('span', { class: 'qm-spin', 'aria-hidden': 'true' }), h('span', {}, text));
  }

  private async play(mode: GameMode, target: { roomId?: string; create?: boolean } = {}): Promise<void> {
    if (this.busy || isTouchOnly()) return;
    this.lastMode = mode;
    this.setBusy(true);
    this.result.hidden = true;
    this.setStatus(COPY.finding);
    let token: string | undefined;
    try {
      token = (await this.commitName())?.token;
      if (!token) {
        this.setBusy(false);
        this.status.replaceChildren();
        this.nameInput.focus();
        this.hero.start(); // Play may have beaten the idle start of the 3D duck
        return;
      }
    } catch (err) {
      // Dev without a game server API: the server hands out a guest identity.
      const devFallback = import.meta.env.DEV && err instanceof ApiError && err.code === 'unreachable';
      if (!devFallback) {
        this.setBusy(false);
        this.status.replaceChildren();
        this.hero.start(); // Play may have beaten the idle start of the 3D duck
        return;
      }
    }
    this.before = null;
    if (token) {
      const t = token;
      void fetchMe(t, 'all').then((me) => (this.before = me), () => {});
    }
    this.setStatus(COPY.loadingGame);
    // Free the 3D duck's renderer before the game makes its own.
    this.hero.stop();
    try {
      await this.hooks.start({ mode, ...target, token, name: this.nameInput.value.trim(), settings: toGameSettings(this.settingsPanel.current ?? loadSettings()) });
      this.hide();
    } catch (err) {
      console.error('[menu] start failed', err);
      this.setBusy(false);
      this.hero.start();
      const code = (err as { code?: number } | null)?.code ?? 0;
      // A deathmatch room never closes: a refused join by id means it is full.
      const known = mode === 'dm' && code === 522 ? 'dm_room_full' : JOIN_ERRORS[code];
      this.status.replaceChildren(h('p', { class: 'qm-error' }, COPY.errors[known ?? 'start_failed'] ?? COPY.errors.start_failed!));
    }
  }

  private async showResult(reason: ExitReason, summary?: MatchSummary): Promise<void> {
    const R = COPY.result;
    const lines: string[] = [];
    let headline: string = reason === 'disconnected' ? R.disconnected : reason === 'left' ? R.left : R.ended;
    const fill = (s: MatchSummary): void => {
      lines.length = 0;
      if (s.placement === 1 && (s.mode ?? this.lastMode) === 'br') headline = R.win;
      if (s.placement) lines.push(R.placed(s.placement, s.players));
      if (s.kills !== undefined) lines.push(R.kills(s.kills));
      // Same formula as the server, from the game's own numbers, so it never
      // races the server's write. Without them, the before/after diff below.
      const mode = s.mode ?? this.lastMode;
      const points = s.points ?? (s.placement && s.players && s.kills !== undefined ? matchPoints(mode, s.placement, s.players, s.kills) : undefined);
      if (points) lines.push(R.points(points));
    };
    const render = (): void => {
      this.result.replaceChildren(h('p', { class: 'qm-result-head' }, R.heading), h('p', { class: 'qm-result-main' }, headline));
      if (lines.length) this.result.append(h('ul', { class: 'qm-result-stats' }, ...lines.map((l) => h('li', {}, l))));
      this.result.hidden = false;
    };
    if (summary) fill(summary);
    render();
    if ((reason === 'left' && !summary) || lines.some((l) => l.startsWith('+'))) return;
    // Points (and the rest, when the game sent no summary): compare season
    // totals before and after; the server writes the match a moment later.
    const before = this.before;
    const id = loadIdentity();
    if (!before?.leaderboard || !id.token) return;
    for (const wait of [1200, 2500, 5000]) {
      await new Promise((r) => setTimeout(r, wait));
      const after = await fetchMe(id.token, 'all').catch(() => null);
      const a = after?.standing;
      const b = before.standing;
      if (!a || a.matches <= (b?.matches ?? 0)) continue;
      const diff = { mode: this.lastMode, kills: a.kills - (b?.kills ?? 0), points: a.score - (b?.score ?? 0), placement: a.wins > (b?.wins ?? 0) ? 1 : undefined };
      fill(summary ? { ...summary, points: diff.points } : diff);
      render();
      return;
    }
  }
}
