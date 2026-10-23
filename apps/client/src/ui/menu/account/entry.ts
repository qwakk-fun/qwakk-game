/**
 * The way into the menu, Metin2 style: sign in (or play as a guest), pick a
 * duck on the character select, then the main menu as that duck. This owns
 * the two entry screens (loginScreen.ts, duckSelect.ts) and the account
 * session; the menu (menu.ts) owns the main screen and is told what to show.
 *
 * On boot: a stored account session goes to the character select (its
 * ducks load, the last one is picked), a browser that chose "Play as guest"
 * goes straight to the main menu, anything else starts at sign-in.
 */
import type { CharacterView, SignedIn } from '@qwakk/shared/accounts';
import { ApiError } from '../api.ts';
import { characterById, gameId, loadCharacter } from '../characters.ts';
import { COPY } from '../copy.ts';
import { h } from '../dom.ts';
import type { HeroModule } from '../heroSlot.ts';
import { forgetGuest, guestToClaim } from '../identity.ts';
import { errorText } from '../nameStep.ts';
import { DuckSelect } from './duckSelect.ts';
import { LoginScreen } from './loginScreen.ts';
import { AccountSession, entryMode, setEntryMode } from './session.ts';

export type Screen = 'login' | 'ducks' | 'main';

export interface EntryHooks {
  /** Show this screen (the menu hides or shows its main parts). */
  screen(s: Screen): void;
  /** The main menu as the signed-in account's active duck (null: none yet), optionally on a tab. */
  main(tab?: 'account'): void;
  /** The main menu as a guest. */
  guest(): void;
  /** The player behind this browser changed (another duck, signed out): leave the party. */
  identityChanged(): void;
}

export class Entry {
  readonly el: HTMLElement;
  readonly session = new AccountSession();
  readonly login: LoginScreen;
  readonly ducks: DuckSelect;
  private readonly hooks: EntryHooks;
  private current: Screen | null = null;

  constructor(hooks: EntryHooks, loadHero?: () => Promise<HeroModule>) {
    this.hooks = hooks;
    this.login = new LoginScreen({
      signedIn: (s) => this.signedIn(s),
      guest: () => this.playAsGuest(),
      back: () => this.hooks.guest(),
      legalDone: (accepted) => (accepted ? this.openDucks({ refetch: false }) : this.hooks.main('account')),
      guestCarry: () => this.guestCarry(),
    });
    this.ducks = new DuckSelect(
      this.session,
      {
        play: (duck) => this.play(duck),
        account: () => this.hooks.main('account'),
        logout: () => void this.logout(),
        guestCarry: () => this.guestCarry(),
        claimed: () => forgetGuest(),
        expired: () => this.expired(),
      },
      loadHero,
    );
    this.el = h('main', { class: 'qa-entry' }, this.login.el, this.ducks.el);
  }

  get screen(): Screen | null {
    return this.current;
  }

  /** First show: where this browser starts. */
  boot(): void {
    if (this.session.signedIn) this.openDucks();
    else if (entryMode() === 'guest') this.hooks.guest();
    else this.openLogin();
  }

  /** Called by the menu when it shows its main screen. */
  leftEntry(): void {
    this.set('main');
  }

  private set(s: Screen): void {
    if (this.current === s) return;
    if (this.current === 'ducks') this.ducks.hide();
    if (this.current === 'login') this.login.close();
    this.current = s;
    this.login.el.hidden = s !== 'login';
    this.ducks.el.hidden = s !== 'ducks';
    this.hooks.screen(s);
  }

  openLogin(opts: { canGoBack?: boolean; message?: string; error?: boolean } = {}): void {
    this.set('login');
    this.login.open(opts);
  }

  /** The character select; `refetch` loads the account first (default). */
  openDucks(opts: { refetch?: boolean; message?: string } = {}): void {
    this.set('ducks');
    if (opts.refetch === false && this.session.account) {
      if (LoginScreen.needsLegal(this.session)) return this.openLegal();
      this.ducks.show(opts.message);
      return;
    }
    this.ducks.loading(COPY.ducks.loading);
    this.session.refresh().then(
      () => {
        if (this.current !== 'ducks') return;
        if (LoginScreen.needsLegal(this.session)) return this.openLegal();
        this.ducks.show(opts.message);
      },
      (err: unknown) => {
        if (this.current !== 'ducks') return;
        if (err instanceof ApiError && err.status === 401) return this.expired();
        this.ducks.loading(errorText(err), true, () => this.openDucks(opts));
      },
    );
  }

  private openLegal(): void {
    this.set('login');
    this.login.openLegal(this.session);
  }

  private signedIn(s: SignedIn): void {
    this.session.adopt(s);
    if (s.claimed) forgetGuest();
    this.hooks.identityChanged();
    const duck = s.claimed ?? null;
    if (duck) this.session.select(duck.id);
    const first = this.session.active;
    this.openDucks({ refetch: false, message: first ? COPY.account.welcomeBack(first.name) : undefined });
  }

  private playAsGuest(): void {
    setEntryMode('guest');
    this.hooks.guest();
  }

  private play(duck: CharacterView): void {
    this.session.select(duck.id);
    this.hooks.identityChanged();
    // Warm the game session now, so Play in the menu starts at once.
    void this.session.gameSession().catch(() => {});
    this.hooks.main();
  }

  async logout(): Promise<void> {
    await this.session.logout();
    setEntryMode(null);
    this.hooks.identityChanged();
    this.openLogin({ message: COPY.account.loggedOut });
  }

  deleted(): void {
    this.session.clear();
    setEntryMode(null);
    this.hooks.identityChanged();
    this.openLogin({ message: COPY.deleteAccount.done });
  }

  expired(): void {
    this.session.clear();
    this.hooks.identityChanged();
    this.openLogin({ message: COPY.errors.session_expired, error: true });
  }

  /** This device's guest duck that would move into the account (with the look it last wore). */
  private guestCarry(): { deviceToken: string; name: string; tag: string; look: number } | null {
    const g = guestToClaim();
    if (!g) return null;
    return { ...g, look: gameId(characterById(loadCharacter())?.id ?? 'classic') };
  }
}
