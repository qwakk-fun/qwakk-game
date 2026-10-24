/**
 * The way into play.qwakk.fun: the entry screens (account/entry.ts: sign in
 * or play as a guest, then the Metin2 style character select), a guest's
 * name and look (guestCard.ts, first time only), then Duck Plaza, the shared
 * 3D square (src/hub/, a dynamic import like the game) where ducks meet,
 * team up and walk through portals into the modes. After a match the duck
 * comes back to the plaza, in front of the portal it used.
 *
 * Everything the old main menu had lives in the small sheet over the plaza
 * (hubSheet.ts, Esc): a plain list of the modes (for accessibility, and for
 * devices where the plaza cannot draw), the team box, leaderboard, settings,
 * how to play and the account. This file owns the flow (who plays, sessions,
 * the party, the plaza and Play); each part is its own module. Pure DOM and
 * no game imports, so it paints before the Three.js and Rapier bundle.
 */
import { isTouchOnly } from '../../input/touch/device.ts';
import { changeLocale, locale } from '../../i18n/locale.ts';
import { loadSettings, toGameSettings } from '../../settings.ts';
import { ACCOUNT_ERROR, type CharacterView } from '@qwakk/shared/accounts';
import { LOBBY_ERROR, partyCodeOf, TEAM_ERROR, teamSizeFor, type PartyGo, type PartyView } from '@qwakk/shared/lobby';
import { ApiError, fetchMe, type MeData } from './api.ts';
import { AccountPanel } from './account/accountPanel.ts';
import { ActiveDuck } from './account/activeDuck.ts';
import { Entry, type Screen } from './account/entry.ts';
import { LoginScreen } from './account/loginScreen.ts';
import { showStorageNotice } from './account/storageNotice.ts';
import { characterOfLook, gameId, type Character } from './characters.ts';
import { characterById, loadCharacter } from './characters.ts';
import { COPY, LINKS } from './copy.ts';
import { asset, h } from './dom.ts';
import { DuckStore } from './duck/duckStore.ts';
import { MyDuckPanel } from './duck/myDuckPanel.ts';
import { ShopPanel, type ShopKind } from './duck/shopPanel.ts';
import { GuestCard } from './guestCard.ts';
import { howtoPanel } from './howtoPanel.ts';
import { HubSheet, type SheetTab } from './hubSheet.ts';
import { icon } from './icons.ts';
import { loadIdentity, NAME_RE } from './identity.ts';
import { LeaderboardPanel } from './leaderboardPanel.ts';
import { errorText } from './nameStep.ts';
import { devWithoutApi, PartyController } from './partyController.ts';
import { ResultCard } from './resultCard.ts';
import { RoomsPanel } from './roomsPanel.ts';
import { SettingsPanel } from './settingsPanel.ts';
import { StatusBar } from './statusBar.ts';
import type { ExitReason, GameMode, HubHandleLike, MatchSummary, MenuHooks, PlayTarget } from './types.ts';
import '@fontsource-variable/geist/wght.css';
import '@fontsource-variable/geist-mono/wght.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/play.css';
import './styles/lobby.css';
import './styles/panels.css';
import './styles/account.css';
import './styles/ducks.css';
import './styles/hub.css';
import './styles/duck.css';

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

/** The plaza connection closes with this when the same duck opened it again elsewhere (server hub/HubRoom.ts HUB_ELSEWHERE). */
const HUB_ELSEWHERE = 4409;

export class Menu {
  readonly root: HTMLElement;
  private readonly hooks: MenuHooks;
  private readonly entry: Entry;
  private readonly guest: GuestCard;
  private readonly sheet: HubSheet;
  private readonly result = new ResultCard();
  private readonly resultFloat: HTMLElement;
  private readonly leaderboard = new LeaderboardPanel();
  private readonly settingsPanel: SettingsPanel;
  private readonly party: PartyController;
  private readonly rooms: RoomsPanel;
  private readonly status: StatusBar;
  private readonly accountPanel: AccountPanel;
  private readonly activeDuck: ActiveDuck;
  private readonly accountBox: HTMLElement;
  private readonly badgeSlot: HTMLElement;
  /** Hunt Season progression of the signed-in duck: My Duck (the sheet) and the stalls' shop panel. */
  private readonly duckStore: DuckStore;
  private readonly myDuck: MyDuckPanel;
  private readonly shop: ShopPanel;
  /** The plaza we are in (null: not in it, or it is loading). */
  private hub: HubHandleLike | null = null;
  /** Bumped on every plaza entry and exit, so a late load from an older one is dropped. */
  private hubSeq = 0;
  /** The plaza could not be reached: the sheet's mode list is the way to play. */
  private plazaDown = false;
  private retriedPlaza = false;
  /** A party code from the share link (?party=), joined once the plaza shows. */
  private pendingCode: string | null = null;
  private busy = false;
  private before: MeData | null = null;
  private lastMode: GameMode = 'dm';
  /** Who plays: an account duck, or a guest. */
  private signedIn = false;
  private booted = false;
  private partySize = 1;

  constructor(hooks: MenuHooks) {
    this.hooks = hooks;
    this.settingsPanel = new SettingsPanel(hooks.showQuality === true);
    this.party = new PartyController({
      token: () => this.partyToken(),
      changed: () => this.partyChanged(),
      follow: (g, leader) => this.follow(g, leader),
      busy: () => this.busy,
    });
    this.pendingCode = takePartyCode();
    this.rooms = new RoomsPanel({
      join: (roomId) => void this.play('br', { roomId }),
      create: () => void this.play('br', { create: true }),
      joinDm: (roomId) => void this.play('dm', { roomId }),
    });
    this.status = new StatusBar((rules) => this.rooms.setRules(rules));

    this.entry = new Entry(
      {
        screen: (s) => this.setScreen(s),
        main: (tab) => this.enterMain(true, tab),
        guest: () => this.enterMain(false),
        identityChanged: () => {
          this.party.leave();
          this.duckStore.reset();
        },
      },
      hooks.hero?.bind(hooks),
    );
    this.guest = new GuestCard({ enter: () => void this.enterAsGuest(), signIn: () => this.signIn() });
    this.activeDuck = new ActiveDuck(() => this.switchDuck());
    this.accountPanel = new AccountPanel(this.entry.session, {
      signIn: () => this.signIn(),
      switchDuck: () => this.switchDuck(),
      logout: () => void this.logout(),
      deleted: () => this.toEntry(() => this.entry.deleted()),
      expired: () => this.toEntry(() => this.entry.expired()),
      inMatch: () => false,
    });
    this.accountBox = h('div', { class: 'qm-sheet-account' });
    this.duckStore = new DuckStore(async () => (this.signedIn ? this.sessionToken(true) : null));
    this.myDuck = new MyDuckPanel(this.duckStore);
    this.shop = new ShopPanel(this.duckStore, () => this.shopClosed());

    this.badgeSlot = h('div', { class: 'qm-badge-slot' });
    const language = (): HTMLSelectElement => {
      const s = h('select', { class: 'qm-language', 'aria-label': 'Language / Dil' }, h('option', { value: 'en' }, 'English'), h('option', { value: 'tr' }, 'Türkçe'));
      s.value = locale;
      s.addEventListener('change', () => changeLocale(s.value === 'tr' ? 'tr' : 'en'));
      return s;
    };
    const sheetBadge = h('div', { class: 'qm-badge-slot' });
    this.sheet = new HubSheet(
      {
        resume: () => this.resume(),
        play: (mode) => void this.play(mode),
        tab: (tab) => this.onSheetTab(tab),
      },
      {
        status: this.status.el,
        rooms: h('section', { class: 'qm-card qm-live qm-sheet-rooms' }, h('div', { class: 'qm-card-head' }, h('span', { class: 'qm-card-icon is-live', 'aria-hidden': 'true' }, h('span', { class: 'qm-live-dot' })), h('div', { class: 'qm-rooms-titles' }, h('h2', {}, COPY.lobby.heading), h('p', { class: 'qm-rooms-rule' }, COPY.lobby.sub))), this.rooms.el, this.rooms.dmEl),
        result: h('div'),
        party: this.party.panel.el,
        leaderboard: this.leaderboard.el,
        settings: this.settingsPanel.el,
        howto: howtoPanel(),
        account: this.accountBox,
        duck: this.myDuck.el,
        language: language(),
        badge: sheetBadge,
      },
    );
    this.resultFloat = h('div', { class: 'qm qm-float', hidden: true }, this.result.el);
    this.resultFloat.addEventListener('click', () => (this.resultFloat.hidden = true));

    const touchOnly = isTouchOnly();
    this.root = h(
      'div',
      { id: 'menu', class: `qm${touchOnly ? ' is-touch' : ''}` },
      h('div', { class: 'qm-bg', 'aria-hidden': 'true' }),
      h(
        'header',
        { class: 'qm-top' },
        h('a', { class: 'qm-brand', href: LINKS.home, 'aria-label': COPY.aria.home }, h('img', { src: asset('ui/brand-mark.svg'), alt: '', width: 36, height: 36 }), h('span', {}, 'Qwakk')),
        h('span'),
        h('div', { class: 'qm-top-end' }, language(), this.badgeSlot),
      ),
      this.entry.el,
      this.guest.el,
      h(
        'footer',
        { class: 'qm-foot' },
        h('nav', { 'aria-label': COPY.aria.links }, h('a', { href: LINKS.home }, COPY.footer.home), h('a', { href: LINKS.terms }, COPY.footer.terms), h('a', { href: LINKS.privacy }, COPY.footer.privacy), h('a', { href: LINKS.cookies }, COPY.footer.storage)),
        h('p', {}, COPY.footer.note),
      ),
    );
  }

  /** The first show (the entry screens), and the way back after a match (the plaza). */
  show(exit?: { reason: ExitReason; summary?: MatchSummary }): void {
    if (!this.root.isConnected) document.body.append(this.root, this.resultFloat);
    this.setBusy(false);
    if (!this.booted) {
      this.booted = true;
      this.showPage();
      this.entry.boot();
      this.warm();
      return;
    }
    // Hunt Season "Play again": straight into the next hunt.
    if (exit?.summary?.mode === 'raid' && exit.summary.again && this.signedIn) {
      void this.entry.session.refresh().catch(() => {});
      void this.play('raid');
      return;
    }
    if (exit) {
      this.resultFloat.hidden = false;
      void this.result.show(exit.reason, exit.summary, this.lastMode, this.before);
      setTimeout(() => (this.resultFloat.hidden = true), 9000);
    }
    if (this.signedIn) void this.entry.session.refresh().then(() => this.renderAccount(), () => {});
    void this.enterPlaza(exit?.summary?.mode ?? this.lastMode);
  }

  /** After paint: warm the game bundle (the plaza and the matches share it). */
  private warm(): void {
    const later = (): void => this.hooks.prefetch?.();
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) idle(later, { timeout: 1500 });
    else setTimeout(later, 300);
  }

  /** The look a game or the plaza wears (characters.ts); an account duck wears its own. */
  get character(): Character {
    const duck = this.duck;
    return duck ? characterOfLook(duck.look) : (characterById(loadCharacter()) ?? characterById('classic')!);
  }

  private get duck(): CharacterView | null {
    return this.signedIn ? this.entry.session.active : null;
  }

  // ---- pages: the entry screens and the guest card -----------------------------------

  /** The full-page menu (entry screens, guest card) on screen; the plaza and the sheet away. */
  private showPage(): void {
    this.root.hidden = false;
    document.body.classList.add('qm-open');
    const badge = document.getElementById('build-badge');
    if (badge) this.badgeSlot.append(badge);
    showStorageNotice(this.root);
  }

  private hidePage(): void {
    this.root.hidden = true;
    document.body.classList.remove('qm-open');
    const badge = document.getElementById('build-badge');
    if (badge) document.body.append(badge);
  }

  private setScreen(s: Screen | 'guest'): void {
    this.root.dataset.screen = s;
    this.guest.el.hidden = s !== 'guest';
    if (s !== 'main') {
      this.leaveHub();
      this.showPage();
      this.root.scrollTo({ top: 0 });
    }
  }

  /** Out of the entry screens: the plaza as the account's duck, or as a guest (its name and look first, once). */
  private enterMain(signedIn: boolean, tab?: 'account'): void {
    this.signedIn = signedIn && this.entry.session.signedIn;
    this.entry.leftEntry();
    if (!this.signedIn) {
      const id = loadIdentity();
      if (!id.tag || !id.name || !NAME_RE.test(id.name)) return this.showGuestCard();
    }
    void this.enterPlaza(null, tab);
  }

  private showGuestCard(): void {
    this.leaveHub();
    this.setScreen('guest');
    this.guest.show();
    if (!isTouchOnly()) this.guest.name.focus();
  }

  private async enterAsGuest(): Promise<void> {
    this.guest.setBusy(true);
    try {
      const s = await this.guest.name.commit();
      if (!s) {
        this.guest.setBusy(false);
        return;
      }
    } catch (err) {
      this.guest.setBusy(false);
      if (!devWithoutApi(err)) return;
    }
    this.signedIn = false;
    this.guest.hide();
    void this.enterPlaza(null);
  }

  // ---- the plaza -----------------------------------------------------------------

  /** Into Duck Plaza (`portal`: back from that mode, at its gate). On failure the sheet's mode list is the way to play. */
  private async enterPlaza(portal: GameMode | null, tab?: SheetTab | 'account'): Promise<void> {
    const seq = ++this.hubSeq;
    this.leaveHub(false);
    this.root.dataset.screen = 'main';
    this.hidePage();
    if (this.signedIn && LoginScreen.needsLegal(this.entry.session)) {
      this.entry.openDucks({ refetch: false });
      return;
    }
    if (this.signedIn && !this.duck) {
      this.switchDuck();
      return;
    }
    let token: string | undefined;
    try {
      token = (await this.sessionToken(true)) ?? undefined;
      if (!token) {
        if (!this.signedIn) return this.showGuestCard();
        return;
      }
    } catch (err) {
      if (!devWithoutApi(err)) return this.plazaFailed(seq, err);
    }
    try {
      const game = await this.hooks.load();
      if (seq !== this.hubSeq) return;
      const hub = await game.enterHub({
        token,
        character: gameId(this.character.id),
        account: this.signedIn,
        portal,
        settings: toGameSettings(this.settingsPanel.current ?? loadSettings()),
        hooks: {
          portal: (id) => void this.play(id, {}, false),
          party: (code) => void this.party.join(code),
          leaveTeam: () => this.leaveTeam(),
          signIn: () => this.signIn(),
          pause: () => this.openSheet(),
          shop: (id) => this.openShop(id),
          closed: (code) => this.plazaClosed(seq, code),
        },
      });
      if (seq !== this.hubSeq) {
        hub.leave();
        return;
      }
      this.hub = hub;
      this.plazaDown = false;
      this.retriedPlaza = false;
      this.partyChanged();
      if (this.pendingCode) {
        const code = this.pendingCode;
        this.pendingCode = null;
        void this.party.join(code);
      }
      if (tab) this.openSheet(tab === 'account' ? 'account' : tab);
    } catch (err) {
      this.plazaFailed(seq, err);
    }
  }

  private plazaFailed(seq: number, err: unknown): void {
    if (seq !== this.hubSeq) return;
    console.error('[menu] the plaza failed', err);
    if (err instanceof ApiError && err.status === 401 && this.signedIn) return this.toEntry(() => this.entry.expired());
    this.hub = null;
    this.plazaDown = true;
    this.openSheet('play');
  }

  private plazaClosed(seq: number, code: number): void {
    if (seq !== this.hubSeq) return;
    this.hub = null;
    if (code !== HUB_ELSEWHERE && !this.retriedPlaza) {
      this.retriedPlaza = true;
      setTimeout(() => seq === this.hubSeq && void this.enterPlaza(null), 1500);
      return;
    }
    this.plazaDown = true;
    this.openSheet('play');
  }

  /** Leave the plaza (a match, the entry screens). `bump`: drop any plaza still loading. */
  private leaveHub(bump = true): void {
    if (bump) this.hubSeq++;
    const hub = this.hub;
    this.hub = null;
    this.shop.close();
    hub?.leave();
    this.closeSheet();
  }

  /** At a market stall (E or a tap): its shop over the paused plaza. */
  private openShop(kind: ShopKind): void {
    if (!this.hub || !this.signedIn || this.sheet.isOpen || this.busy) return;
    this.hub.setPaused(true);
    this.shop.open(kind);
  }

  /** The shop closed (a click or a tap: the mouse may be locked again). */
  private shopClosed(): void {
    if (!this.hub || this.sheet.isOpen) return;
    this.hub.setPaused(false);
    this.hub.resume();
  }

  private openSheet(tab?: SheetTab): void {
    const duck = this.duck;
    const who = duck ? `${duck.name}#${duck.tag}` : (() => {
      const id = loadIdentity();
      return id.name ? `${id.name}${id.tag ? `#${id.tag}` : ''}` : '';
    })();
    this.sheet.set(who, !this.signedIn, this.plazaDown || !this.hub);
    this.renderAccount();
    this.hub?.setPaused(true);
    this.rooms.setGuest(!this.signedIn);
    this.rooms.setPartySize(this.party.size);
    this.sheet.open(tab);
    this.status.start();
    this.rooms.start();
    const badge = document.getElementById('build-badge');
    const slot = this.sheet.root.querySelector('.qm-badge-slot');
    if (badge && slot) slot.append(badge);
  }

  private closeSheet(): void {
    if (!this.sheet.isOpen) return;
    this.sheet.close();
    this.status.stop();
    this.rooms.stop();
    const badge = document.getElementById('build-badge');
    if (badge && this.root.hidden) document.body.append(badge);
  }

  /** "Back to the plaza" (a click or a tap, so the mouse may be locked again). */
  private resume(): void {
    if (!this.hub) {
      if (this.plazaDown) {
        this.plazaDown = false;
        this.retriedPlaza = false;
        this.closeSheet();
        void this.enterPlaza(null);
      }
      return;
    }
    this.closeSheet();
    this.hub.applySettings(toGameSettings(this.settingsPanel.current ?? loadSettings()));
    this.hub.setPaused(false);
    this.hub.resume();
  }

  private onSheetTab(tab: SheetTab): void {
    if (tab === 'leaderboard') void this.leaderboard.load();
    if (tab === 'account') this.renderAccount();
    if (tab === 'duck' && this.signedIn) this.myDuck.show();
  }

  private renderAccount(): void {
    if (this.signedIn) {
      this.activeDuck.set(this.duck);
      this.accountPanel.render();
      this.accountBox.replaceChildren(h('section', { class: 'qm-card' }, this.activeDuck.el), this.accountPanel.el);
      return;
    }
    const change = h('button', { type: 'button', class: 'qm-btn qm-btn-ghost' }, icon('swap'), COPY.sheet.changeGuest);
    change.addEventListener('click', () => this.showGuestCard());
    this.accountPanel.render();
    this.accountBox.replaceChildren(h('section', { class: 'qm-card qm-sheet-guest' }, h('p', { class: 'qm-sub' }, COPY.guestCard.note), h('div', { class: 'qm-account-actions' }, change)), this.accountPanel.el);
  }

  // ---- account and identity ---------------------------------------------------------

  private toEntry(go: () => void): void {
    this.leaveHub();
    this.showPage();
    go();
  }

  private signIn(): void {
    this.toEntry(() => this.entry.openLogin({ canGoBack: true }));
  }

  private switchDuck(): void {
    if (this.busy) return;
    if (!this.entry.session.signedIn) return this.signIn();
    this.toEntry(() => this.entry.openDucks({ refetch: true }));
  }

  private async logout(): Promise<void> {
    this.toEntry(() => undefined);
    await this.entry.logout();
  }

  /** A game session token for whoever plays: the account duck's, or the guest's (the name must be valid). */
  private async sessionToken(quiet: boolean): Promise<string | null> {
    if (this.signedIn) {
      try {
        return (await this.entry.session.gameSession()).token;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          this.toEntry(() => this.entry.expired());
          return null;
        }
        if (!quiet) this.hub?.toast(errorText(err));
        throw err;
      }
    }
    return (await this.guest.name.commit(quiet))?.token ?? null;
  }

  // ---- the team (a party) ------------------------------------------------------------

  private async partyToken(): Promise<string | null | undefined> {
    try {
      const t = await this.sessionToken(true);
      if (!t) {
        if (!this.signedIn) this.party.panel.message(COPY.party.needName, true);
        return null;
      }
      return t;
    } catch (err) {
      return devWithoutApi(err) ? undefined : null;
    }
  }

  private partyChanged(): void {
    const v: PartyView | null = this.party.view;
    const members = v?.members ?? [];
    this.hub?.setTeam(members);
    const size = members.length;
    // Just joined someone else's team.
    if (size > 1 && this.partySize <= 1) {
      const lead = members.find((m) => m.leader);
      if (lead && !lead.you) this.hub?.toast(COPY.hub.notes.joinedTeam(lead.name));
    }
    this.partySize = Math.max(1, size);
  }

  private leaveTeam(): void {
    if (!this.party.view) return;
    this.party.leave();
    this.hub?.toast(COPY.hub.notes.left);
  }

  /** The leader went into a room: a member in the plaza follows (in a match the server does not send it anyway). */
  private follow(g: PartyGo, leader: string): void {
    if (this.busy || this.root.dataset.screen !== 'main') return;
    if ((g.mode === 'br' || g.mode === 'raid') && !this.signedIn) {
      this.hub?.toast(COPY.errors.needs_account!);
      return;
    }
    this.hub?.toast(COPY.hub.notes.following(leader));
    void this.play(g.mode, { roomId: g.roomId }, true);
  }

  // ---- play ---------------------------------------------------------------------------

  private setBusy(on: boolean): void {
    this.busy = on;
    this.sheet.setBusy(on);
    this.rooms.setBusy(on || this.party.followsLeader);
    this.party.panel.setBusy(on);
  }

  private say(text: string): void {
    if (this.hub) this.hub.toast(text);
    else if (this.sheet.isOpen) this.party.panel.message(text, true);
  }

  /** Into a match: from a portal, the sheet's mode list, or following the party leader. */
  private async play(mode: GameMode, target: PlayTarget = {}, follow = false): Promise<void> {
    if (this.busy) return;
    if (this.party.followsLeader && !follow) {
      this.say(COPY.hub.notes.leaderPicks);
      return;
    }
    // Guests play deathmatch only: the other modes ask to sign in (the server refuses them too).
    if ((mode === 'br' || mode === 'raid') && !this.signedIn) {
      this.signIn();
      return;
    }
    if ((mode === 'br' || mode === 'raid') && this.party.view?.members.some((m) => m.guest)) {
      this.say(COPY.errors.party_has_guest!);
      return;
    }
    // A team leader opens a fresh room that fits the team (the members follow); alone, Quick Play.
    const size = this.party.size;
    if (!target.roomId && size > 1 && mode === 'br') target = { create: true, team: teamSizeFor(size) };
    if (!target.roomId && size > 1 && mode === 'raid') target = { create: true };
    this.lastMode = mode;
    this.setBusy(true);
    this.result.hide();
    this.resultFloat.hidden = true;
    let token: string | undefined;
    try {
      token = (await this.sessionToken(false)) ?? undefined;
      if (!token) {
        this.setBusy(false);
        if (!this.signedIn) this.showGuestCard();
        return;
      }
    } catch (err) {
      if (!(import.meta.env.DEV && err instanceof ApiError && err.code === 'unreachable')) {
        this.setBusy(false);
        return;
      }
    }
    this.before = null;
    if (token) {
      const t = token;
      void fetchMe(t, 'all').then((me) => (this.before = me), () => {});
    }
    // The plaza goes first: one renderer for the page.
    this.leaveHub();
    const duck = this.duck;
    try {
      const joined = await this.hooks.start({ mode, ...target, token, name: duck?.name ?? loadIdentity().name ?? '', character: gameId(this.character.id), settings: toGameSettings(this.settingsPanel.current ?? loadSettings()) });
      // The leader tells the party where it went; the members in the plaza follow.
      if (joined) this.party.went(mode, joined.roomId);
      this.party.panel.message(null);
    } catch (err) {
      console.error('[menu] start failed', err);
      this.setBusy(false);
      const code = (err as { code?: number } | null)?.code ?? 0;
      const known = mode === 'dm' && code === 522 ? 'dm_room_full' : JOIN_ERRORS[code];
      if (known === 'needs_account' && this.signedIn) this.entry.session.dropGameSession();
      const text = COPY.errors[known ?? 'start_failed'] ?? COPY.errors.start_failed!;
      await this.enterPlaza(mode);
      this.say(text);
    }
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
