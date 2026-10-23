/**
 * The main menu at play.qwakk.fun, behind the entry screens (account/entry.ts:
 * sign in or play as a guest, then the character select). The Play tab's
 * join flow depends on who plays:
 *   signed in: 1 the duck you picked (Switch duck), 2 drop in (Quick Play
 *     battle royale or Deathmatch);
 *   guest: 1 name and #tag, 2 pick a look, 3 drop in (Deathmatch; Quick Play
 *     asks to sign in, guests do not play battle royale).
 * Plus the stage with the duck, parties and the live room lists, and the
 * leaderboard, settings, how to play and account tabs. Pure DOM and no game
 * imports, so it paints before the Three.js and Rapier bundle has loaded.
 * This file wires the parts together and owns the Play flow; each part is
 * its own module.
 */
import { isTouchOnly } from '../../input/touch/device.ts';
import { changeLocale, locale } from '../../i18n/locale.ts';
import { loadSettings, toGameSettings } from '../../settings.ts';
import { ACCOUNT_ERROR, type CharacterView } from '@qwakk/shared/accounts';
import { ApiError, fetchMe, type MeData } from './api.ts';
import { AccountPanel } from './account/accountPanel.ts';
import { ActiveDuck, guestGate } from './account/activeDuck.ts';
import { Entry, type Screen } from './account/entry.ts';
import { LoginScreen } from './account/loginScreen.ts';
import { showStorageNotice } from './account/storageNotice.ts';
import { CharacterStep } from './characterStep.ts';
import { characterById, characterOfLook, gameId, loadCharacter, type Character } from './characters.ts';
import { COPY, LINKS } from './copy.ts';
import { asset, h } from './dom.ts';
import { howtoPanel } from './howtoPanel.ts';
import { icon } from './icons.ts';
import { loadIdentity, NAME_RE } from './identity.ts';
import { LOBBY_ERROR, partyCodeOf, pickQuickRoom, TEAM_ERROR, type PartyGo } from '@qwakk/shared/lobby';
import { LeaderboardPanel } from './leaderboardPanel.ts';
import { errorText, NameStep } from './nameStep.ts';
import { devWithoutApi, PartyController } from './partyController.ts';
import { PlayStep } from './playStep.ts';
import { ResultCard } from './resultCard.ts';
import { RoomsPanel } from './roomsPanel.ts';
import { SettingsPanel } from './settingsPanel.ts';
import { Stage } from './stage.ts';
import { StatusBar } from './statusBar.ts';
import { Tabs, type Tab } from './tabs.ts';
import type { ExitReason, GameMode, MatchSummary, MenuHooks, PlayTarget } from './types.ts';
import '@fontsource-variable/geist/wght.css';
import '@fontsource-variable/geist-mono/wght.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/play.css';
import './styles/lobby.css';
import './styles/panels.css';
import './styles/account.css';
import './styles/ducks.css';

export type { ExitReason, GameMode, MatchSummary, MenuHooks, StartOptions } from './types.ts';

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
  [TEAM_ERROR.partyTooBig]: 'party_too_big',
  [TEAM_ERROR.noTeam]: 'no_team',
  [LOBBY_ERROR.maintenance]: 'maintenance',
  [LOBBY_ERROR.modeOff]: 'mode_off',
  [ACCOUNT_ERROR.needsAccount]: 'needs_account',
  [ACCOUNT_ERROR.roomNeedsAccount]: 'needs_account',
  [ACCOUNT_ERROR.partyHasGuest]: 'party_has_guest',
  [ACCOUNT_ERROR.roomPartyHasGuest]: 'party_has_guest',
  /** RaidRoom RAID_ERROR.full: the hunt started, or no seats for the party. */
  4414: 'raid_full',
};

/** One numbered step of the join flow. */
function step(n: number, title: string, body: HTMLElement, extra?: HTMLElement): HTMLElement {
  return h(
    'li',
    { class: 'qm-step', 'data-step': n },
    h('div', { class: 'qm-step-head' }, h('span', { class: 'qm-step-num', 'aria-hidden': 'true' }, String(n)), h('h2', { class: 'qm-step-title' }, title), extra ?? null),
    h('div', { class: 'qm-step-body' }, body),
  );
}

export class Menu {
  readonly root: HTMLElement;
  private readonly hooks: MenuHooks;
  private readonly tabs: Tabs;
  private readonly name: NameStep;
  private readonly characters: CharacterStep;
  private readonly playStep: PlayStep;
  private readonly stage: Stage;
  private readonly result = new ResultCard();
  private readonly leaderboard = new LeaderboardPanel();
  private readonly settingsPanel: SettingsPanel;
  private readonly rooms: RoomsPanel;
  private readonly party: PartyController;
  private readonly status: StatusBar;
  private readonly entry: Entry;
  private readonly accountPanel: AccountPanel;
  private readonly activeDuck: ActiveDuck;
  private readonly nameStepEl: HTMLElement;
  private readonly lookStepEl: HTMLElement;
  private readonly duckStepEl: HTMLElement;
  private readonly playStepEl: HTMLElement;
  private readonly gateEl: HTMLElement;
  private readonly whoBtn: HTMLButtonElement;
  /** The header's right corner: the version badge (ui/buildBadge.ts) sits here while the menu is up. */
  private readonly badgeSlot: HTMLElement;
  /** A party code from the share link (?party=), joined once the main menu shows. */
  private pendingCode: string | null = null;
  private busy = false;
  private before: MeData | null = null;
  private lastMode: GameMode = 'br';
  /** Who plays: an account duck, or a guest. */
  private signedIn = false;
  private booted = false;

  constructor(hooks: MenuHooks) {
    this.hooks = hooks;
    this.settingsPanel = new SettingsPanel(hooks.showQuality === true);
    this.rooms = new RoomsPanel({
      join: (roomId) => void this.play('br', { roomId }),
      create: () => void this.play('br', { create: true }),
      joinDm: (roomId) => void this.play('dm', { roomId }),
    });
    this.party = new PartyController({
      token: () => this.partyToken(),
      changed: () => {
        this.rooms.setPartySize(this.party.size);
        this.playStep.team.setPartySize(this.party.size);
        this.playStep.setPartySize(this.party.size);
        this.applyLock();
      },
      follow: (g, leader) => this.follow(g, leader),
      busy: () => this.busy,
    });
    this.pendingCode = takePartyCode();
    this.status = new StatusBar((rules) => {
      this.rooms.setRules(rules);
      this.playStep.team.setModes(rules.teamModes);
    });

    const touchOnly = isTouchOnly();
    const character = characterById(loadCharacter()) ?? characterById('classic')!;
    this.stage = new Stage(character, hooks.hero?.bind(hooks));
    this.name = new NameStep(() => this.syncPlayer());
    this.characters = new CharacterStep(character.id, (c) => this.stage.setCharacter(c));
    this.playStep = new PlayStep(touchOnly, (mode) => void this.play(mode));
    this.activeDuck = new ActiveDuck(() => this.switchDuck());
    this.gateEl = guestGate(() => this.signIn());

    this.entry = new Entry(
      {
        screen: (s) => this.setScreen(s),
        main: (tab) => this.enterMain(true, tab),
        guest: () => this.enterMain(false),
        identityChanged: () => this.party.leave(),
      },
      hooks.hero?.bind(hooks),
    );
    this.accountPanel = new AccountPanel(this.entry.session, {
      signIn: () => this.signIn(),
      switchDuck: () => this.switchDuck(),
      logout: () => void this.entry.logout(),
      deleted: () => this.entry.deleted(),
      expired: () => this.entry.expired(),
      inMatch: () => false,
    });

    this.nameStepEl = step(1, COPY.steps.name, this.name.el);
    this.lookStepEl = step(2, COPY.steps.character, this.characters.el);
    this.duckStepEl = step(1, COPY.account.activeDuck, this.activeDuck.el);
    this.playStepEl = step(3, COPY.steps.play, this.playStep.el);
    const steps = h('ol', { class: 'qm-steps', 'aria-label': COPY.aria.steps }, this.duckStepEl, this.nameStepEl, this.lookStepEl, this.playStepEl);

    const playPanel = h(
      'div',
      { class: 'qm-play-layout' },
      h(
        'div',
        { class: 'qm-intro' },
        h('p', { class: 'qm-kicker' }, h('span', { class: 'qm-live-dot', 'aria-hidden': 'true' }), COPY.kicker),
        h('h1', { class: 'qm-title' }, h('span', {}, COPY.title), ' ', h('span', { class: 'qm-title-accent' }, COPY.titleAccent)),
        h('p', { class: 'qm-tagline' }, COPY.tagline),
      ),
      this.stage.el,
      h('div', { class: 'qm-join' }, this.status.el, this.result.el, this.gateEl, steps),
      h(
        'aside',
        { class: 'qm-lobby', 'aria-label': COPY.aria.lobby },
        this.party.panel.el,
        h(
          'section',
          { class: 'qm-card qm-live' },
          h('div', { class: 'qm-card-head' }, h('span', { class: 'qm-card-icon is-live', 'aria-hidden': 'true' }, h('span', { class: 'qm-live-dot' })), h('div', { class: 'qm-rooms-titles' }, h('h2', {}, COPY.lobby.heading), h('p', { class: 'qm-rooms-rule' }, COPY.lobby.sub))),
          this.rooms.el,
          this.rooms.dmEl,
        ),
      ),
    );

    this.tabs = new Tabs(
      [
        ['play', playPanel],
        ['leaderboard', this.leaderboard.el],
        ['settings', this.settingsPanel.el],
        ['howto', howtoPanel()],
        ['account', this.accountPanel.el],
      ],
      (tab) => this.onTab(tab),
    );

    this.badgeSlot = h('div', { class: 'qm-badge-slot' });
    const language = h('select', { class: 'qm-language', 'aria-label': 'Language / Dil' },
      h('option', { value: 'en' }, 'English'), h('option', { value: 'tr' }, 'Türkçe'));
    language.value = locale;
    language.addEventListener('change', () => changeLocale(language.value === 'tr' ? 'tr' : 'en'));
    this.whoBtn = h('button', { type: 'button', class: 'qm-btn qm-btn-ghost qm-btn-sm qm-who' }, icon('user'), h('span', { class: 'qm-who-text' }));
    this.whoBtn.addEventListener('click', () => (this.signedIn ? this.tabs.select('account') : this.signIn()));
    this.root = h(
      'div',
      { id: 'menu', class: `qm${touchOnly ? ' is-touch' : ''}` },
      h('div', { class: 'qm-bg', 'aria-hidden': 'true' }),
      h(
        'header',
        { class: 'qm-top' },
        h('a', { class: 'qm-brand', href: LINKS.home, 'aria-label': COPY.aria.home }, h('img', { src: asset('ui/brand-mark.svg'), alt: '', width: 36, height: 36 }), h('span', {}, 'Qwakk')),
        this.tabs.bar,
        h('div', { class: 'qm-top-end' }, this.whoBtn, language, this.badgeSlot),
      ),
      this.entry.el,
      this.tabs.main,
      h(
        'footer',
        { class: 'qm-foot' },
        h('nav', { 'aria-label': COPY.aria.links }, h('a', { href: LINKS.home }, COPY.footer.home), h('a', { href: LINKS.terms }, COPY.footer.terms), h('a', { href: LINKS.privacy }, COPY.footer.privacy), h('a', { href: LINKS.cookies }, COPY.footer.storage)),
        h('p', {}, COPY.footer.note),
      ),
    );
    this.applyMode();
    this.tabs.select('play');
  }

  /** Put the menu on the page (once) and show it: the entry screens first, the main menu after a match. */
  show(exit?: { reason: ExitReason; summary?: MatchSummary }): void {
    if (!this.root.isConnected) document.body.append(this.root);
    this.root.hidden = false;
    document.body.classList.add('qm-open');
    // The badge scrolls with the header instead of floating over the menu.
    const badge = document.getElementById('build-badge');
    if (badge) this.badgeSlot.append(badge);
    showStorageNotice(this.root);
    this.setBusy(false);
    this.playStep.clear();
    if (exit) void this.result.show(exit.reason, exit.summary, this.lastMode, this.before);
    if (!this.booted) {
      this.booted = true;
      this.entry.boot();
    } else {
      this.enterMain(this.signedIn);
    }
    // After a hunt: the duck's new XP and level (granted by the game server), and "Play again".
    if (exit?.summary?.mode === 'raid' && this.signedIn) {
      void this.entry.session.refresh().then(() => this.activeDuck.set(this.duck), () => {});
      if (exit.summary.again) setTimeout(() => void this.play('raid'), 50);
    }
    // After paint: warm the game bundle (it shares the Three.js chunk with the 3D ducks).
    const later = (): void => this.hooks.prefetch?.();
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) idle(later, { timeout: 1500 });
    else setTimeout(later, 300);
  }

  hide(): void {
    this.rooms.stop();
    this.status.stop();
    this.stage.hero.stop();
    this.root.hidden = true;
    document.body.classList.remove('qm-open');
    // Back to its fixed corner for the game.
    const badge = document.getElementById('build-badge');
    if (badge) document.body.append(badge);
  }

  /** The look Play sends as the `character` join option (characters.ts); an account duck wears its own. */
  get character(): Character {
    const duck = this.duck;
    return duck ? characterOfLook(duck.look) : this.characters.selected;
  }

  /** The account duck playing now, or null for a guest. */
  private get duck(): CharacterView | null {
    return this.signedIn ? this.entry.session.active : null;
  }

  // ---- screens and modes ----------------------------------------------------

  /** The entry screens hide the tabs and the main panels; the main screen brings them back. */
  private setScreen(s: Screen): void {
    this.root.dataset.screen = s;
    if (s !== 'main') {
      this.rooms.stop();
      this.status.stop();
      this.stage.hero.stop();
      this.root.scrollTo({ top: 0 });
    }
  }

  /** The main menu, as the account's duck (`signedIn`) or as a guest. */
  private enterMain(signedIn: boolean, tab: Tab = 'play'): void {
    this.signedIn = signedIn && this.entry.session.signedIn;
    this.applyMode();
    this.entry.leftEntry();
    this.root.dataset.screen = 'main';
    this.rooms.start();
    this.status.start();
    this.tabs.select(tab);
    if (tab === 'play' && !isTouchOnly()) this.playStep.primary.focus({ preventScroll: true });
    // After paint: the 3D duck on the stage.
    requestAnimationFrame(() => requestAnimationFrame(() => !this.root.hidden && !this.busy && this.root.dataset.screen === 'main' && this.stage.hero.start()));
    // Get or refresh the guest's #tag quietly (no Turnstile prompt until Play).
    if (!this.signedIn && loadIdentity().deviceToken && NAME_RE.test(this.name.value)) this.name.commit(true).catch(() => {});
    this.applyLock();
    if (this.pendingCode) {
      const code = this.pendingCode;
      this.pendingCode = null;
      void this.party.join(code);
    }
  }

  /** Show what fits who plays: the duck card or the name and look steps, the guest locks, the account tab. */
  private applyMode(): void {
    const account = this.signedIn;
    this.root.classList.toggle('is-account', account);
    this.root.classList.toggle('is-guest', !account);
    this.duckStepEl.hidden = !account;
    this.nameStepEl.hidden = account;
    this.lookStepEl.hidden = account;
    this.gateEl.hidden = account;
    const num = (el: HTMLElement, n: number): void => {
      el.dataset.step = String(n);
      const s = el.querySelector('.qm-step-num');
      if (s) s.textContent = String(n);
    };
    num(this.playStepEl, account ? 2 : 3);
    this.playStep.setGuest(!account);
    this.rooms.setGuest(!account);
    this.activeDuck.set(this.duck);
    const duck = this.duck;
    (this.whoBtn.lastElementChild as HTMLElement).textContent = duck ? `${duck.name}#${duck.tag}` : account ? COPY.account.title : COPY.account.signIn;
    this.whoBtn.classList.toggle('is-signin', !account);
    this.stage.setCharacter(this.character);
    this.syncPlayer();
    this.accountPanel.render();
  }

  private signIn(): void {
    this.entry.openLogin({ canGoBack: true });
  }

  private switchDuck(): void {
    if (this.busy) return;
    if (!this.entry.session.signedIn) return this.signIn();
    this.entry.openDucks({ refetch: true });
  }

  private onTab(tab: Tab): void {
    this.root.dataset.tab = tab;
    this.stage.hero.setActive(tab === 'play');
    if (tab === 'leaderboard') void this.leaderboard.load();
    if (tab === 'account') this.accountPanel.render();
    if (this.root.isConnected) this.root.scrollTo({ top: 0 });
  }

  /** Name, tag and the done mark of step 1, on the stage plate too. */
  private syncPlayer(): void {
    const duck = this.duck;
    if (duck) {
      this.stage.setPlayer(duck.name, `#${duck.tag}`);
      return;
    }
    this.stage.setPlayer(this.name.value, this.name.tag);
    this.nameStepEl.classList.toggle('is-done', this.name.valid && this.name.tag !== null);
  }

  private setBusy(on: boolean): void {
    this.busy = on;
    this.root.classList.toggle('is-busy', on);
    this.applyLock();
    this.name.setDisabled(on);
    this.characters.setDisabled(on);
  }

  private applyLock(): void {
    const follows = this.party.followsLeader;
    this.playStep.lock(this.busy, follows);
    this.rooms.setBusy(this.busy || follows);
    this.party.panel.setBusy(this.busy);
  }

  // ---- sessions -----------------------------------------------------------

  /** A game session token for whoever plays: the account duck's, or the guest's (the name must be valid). */
  private async sessionToken(quiet: boolean): Promise<string | null> {
    if (this.signedIn) {
      try {
        return (await this.entry.session.gameSession()).token;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) this.entry.expired();
        else if (!quiet) this.playStep.error(errorText(err));
        return null;
      }
    }
    return (await this.name.commit())?.token ?? null;
  }

  /** A session token for party actions, or null with a message. */
  private async partyToken(): Promise<string | null | undefined> {
    try {
      const t = await this.sessionToken(true);
      if (!t) {
        if (!this.signedIn) {
          this.party.panel.message(COPY.party.needName, true);
          this.name.focus();
        }
        return null;
      }
      return t;
    } catch (err) {
      return devWithoutApi(err) ? undefined : null;
    }
  }

  /** The leader went into a room: members in the menu follow (in a match the server does not send it anyway). */
  private follow(g: PartyGo, leader: string): void {
    if (this.root.hidden || this.busy || this.root.dataset.screen !== 'main') return;
    if ((g.mode === 'br' || g.mode === 'raid') && !this.signedIn) {
      this.playStep.error(COPY.errors.needs_account!);
      return;
    }
    this.party.panel.message(COPY.party.following(leader));
    void this.play(g.mode, { roomId: g.roomId }, true);
  }

  // ---- play ---------------------------------------------------------------

  private async play(mode: GameMode, target: PlayTarget = {}, follow = false): Promise<void> {
    if (this.busy) return;
    if (this.party.followsLeader && !follow) {
      this.playStep.error(COPY.errors.party_lead!);
      return;
    }
    // Guests play deathmatch only: battle royale and Hunt Season ask to sign in (the server refuses it too).
    if ((mode === 'br' || mode === 'raid') && !this.signedIn) {
      this.signIn();
      return;
    }
    if (this.signedIn && LoginScreen.needsLegal(this.entry.session)) {
      this.entry.openDucks({ refetch: false });
      return;
    }
    if ((mode === 'br' || mode === 'raid') && this.party.view?.members.some((m) => m.guest)) {
      this.playStep.error(COPY.errors.party_has_guest!);
      return;
    }
    if (this.signedIn && !this.duck) {
      this.switchDuck();
      return;
    }
    // Battle royale: the room's team size, and Quick Play picks from the live list a room
    // whose teams fit the whole party (else it opens one in the picked mode).
    if (mode === 'br' && !target.roomId) {
      const size = this.party.size;
      const team = this.playStep.team.mode;
      target = { ...target, team };
      const { live, rooms } = this.rooms.list;
      if (!target.create && live) {
        const pick = pickQuickRoom(rooms, size, team) ?? pickQuickRoom(rooms, size);
        target = pick ? { roomId: pick.roomId } : { create: true, team };
      }
    }
    // Hunt Season: a party leader opens a fresh hunt for the party (the members follow); alone, Quick Play joins an open lobby.
    if (mode === 'raid' && !target.roomId && this.party.size > 1) target = { create: true };
    this.lastMode = mode;
    this.setBusy(true);
    this.result.hide();
    this.playStep.progress(COPY.finding);
    let token: string | undefined;
    try {
      token = (await this.sessionToken(false)) ?? undefined;
      if (!token) return this.backToMenu(!this.signedIn);
    } catch (err) {
      // Dev without a game server API: the server hands out a guest identity.
      if (!(import.meta.env.DEV && err instanceof ApiError && err.code === 'unreachable')) return this.backToMenu(false);
    }
    this.before = null;
    if (token) {
      const t = token;
      void fetchMe(t, 'all').then((me) => (this.before = me), () => {});
    }
    this.playStep.progress(COPY.loadingGame);
    // Free the 3D duck's renderer before the game makes its own.
    this.stage.hero.stop();
    const duck = this.duck;
    try {
      const joined = await this.hooks.start({ mode, ...target, token, name: duck?.name ?? this.name.value, character: gameId(this.character.id), settings: toGameSettings(this.settingsPanel.current ?? loadSettings()) });
      // The leader tells the party where it went; the members in the menu follow.
      if (joined) this.party.went(mode, joined.roomId);
      this.party.panel.message(null);
      this.hide();
    } catch (err) {
      console.error('[menu] start failed', err);
      this.setBusy(false);
      this.stage.hero.start();
      const code = (err as { code?: number } | null)?.code ?? 0;
      // A deathmatch room never closes: a refused join by id means it is full.
      const known = mode === 'dm' && code === 522 ? 'dm_room_full' : JOIN_ERRORS[code];
      if (known === 'needs_account' && this.signedIn) this.entry.session.dropGameSession();
      this.playStep.error(COPY.errors[known ?? 'start_failed'] ?? COPY.errors.start_failed!);
    }
  }

  /** Play stopped before the game loaded (no valid name, or the session failed: the name step says why). */
  private backToMenu(focusName: boolean): void {
    this.setBusy(false);
    if (this.root.dataset.screen !== 'main') return;
    // A guest's name step says why; an account's error stays on the Play step.
    if (!this.signedIn) this.playStep.clear();
    if (focusName) {
      this.name.focus();
      this.nameStepEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    this.stage.hero.start(); // Play may have beaten the idle start of the 3D duck
  }
}

/** A party code from the share link (?party=CODE); the address drops it so a reload does not rejoin. */
function takePartyCode(): string | null {
  try {
    const params = new URLSearchParams(location.search);
    const code = partyCodeOf(params.get('party') ?? '');
    if (params.has('party')) {
      params.delete('party');
      const q = params.toString();
      history.replaceState(history.state, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`);
    }
    return code;
  } catch {
    return null; // no history API: the link still works, the address keeps the code
  }
}
