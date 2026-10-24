/**
 * The Hunt Season HUD (v3, the push): the objective bar (objective n of 4,
 * what it asks and how far along it is, the timer, hunters out), the gate's
 * health once hunters hurt it, the drawbridge near the keep, the bread
 * cannon's heat while we man one, the
 * action prompt (man a cannon, pull the lever, repair the gate), the Big
 * Hunter's bar, banners, the upgrade cards, the duck's own upgrades, the
 * knocked and out notes, and the end screen with the XP and the level bar.
 * DOM only; everything it shows comes from the room state and the server's
 * messages.
 */
import { GateState, levelProgress, newUnlocks, RAID, treePoints, Upgrade, type SkillId, type UpgradeId } from '@qwakk/shared';
import { t } from '../../i18n/game.ts';
import './raid.css';

const UPGRADE_TEXT: Record<UpgradeId, { name: string; line: string; icon: string }> = {
  [Upgrade.Damage]: { name: 'Sharper blade', line: '+{n}% damage with the katana and the pistol', icon: '✦' },
  [Upgrade.MaxHealth]: { name: 'Max health', line: '+{n} max health, healed now', icon: '♥' },
  [Upgrade.Armor]: { name: 'Armor', line: '{n}% less damage taken', icon: '⛨' },
  [Upgrade.Regen]: { name: 'Regen', line: '+{n} health a second when not hit for 3 s', icon: '✚' },
  [Upgrade.Reach]: { name: 'Wider arcs', line: 'Every swing reaches {n}% further', icon: '◠' },
  [Upgrade.Revive]: { name: 'Faster revive', line: 'Revive {n}% faster', icon: '⇡' },
  [Upgrade.Crit]: { name: 'Keen edge', line: '+{n}% crit damage (back-stabs, full heavy spins)', icon: '✸' },
  [Upgrade.Lifesteal]: { name: 'Lifesteal', line: '+{n} health for every cut that lands', icon: '❦' },
  [Upgrade.Storm]: { name: 'Storm charge', line: 'The Blade Storm fills {n}% faster', icon: '❂' },
  [Upgrade.Bleed]: { name: 'Bleed', line: 'Cuts make hunters bleed {n} a second for 3 s', icon: '❖' },
  [Upgrade.Chain]: { name: 'Chain lightning', line: 'Heavy spins arc {n}% of their damage to 3 more hunters', icon: 'ϟ' },
  [Upgrade.Finisher]: { name: 'Finisher', line: 'The combo\'s third cut hits {n}% harder', icon: '⚔' },
};

export function upgradeName(id: number): string {
  return t(UPGRADE_TEXT[id as UpgradeId]?.name ?? '?');
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.append(e);
  return e;
};

const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export interface RaidEndView {
  reason: number;
  waves: number;
  kills: number;
  bossKills: number;
  revives: number;
  xp: number;
  /** -1 when the server has not stored it (yet). */
  xpBefore: number;
  xpAfter: number;
  runMs: number;
  bestWave: number;
  newBest: boolean;
  granted: boolean;
  /** The server could not store the XP this time (no database, or the write failed). */
  failed: boolean;
  /** Tüy the run earned (the daily bonus inside once stored), the balance after (-1 until stored), the daily bonus. */
  feathers: number;
  feathersAfter: number;
  daily: number;
}

/** A move's name for the end screen's "new skill" line. */
export const SKILL_NAMES: Record<SkillId, string> = { dash: 'Dash', pistol: 'Pistol', quack: 'VAK!', heavy: 'Charged heavy', storm: 'Blade Storm' };

export class RaidHud {
  readonly root: HTMLElement;
  private readonly wave: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly left: HTMLElement;
  private readonly goalBox: HTMLElement;
  private readonly goalName: HTMLElement;
  private readonly goalFill: HTMLElement;
  private readonly goalCount: HTMLElement;
  private readonly towerFill: HTMLElement;
  private readonly towerText: HTMLElement;
  private readonly gateBox: HTMLElement;
  private readonly gateLabel: HTMLElement;
  private readonly gateFill: HTMLElement;
  private readonly gateText: HTMLElement;
  private readonly bridgeChip: HTMLElement;
  private readonly cannonBox: HTMLElement;
  private readonly cannonFill: HTMLElement;
  private readonly cannonState: HTMLElement;
  private readonly cannonHint: HTMLElement;
  private readonly promptBox: HTMLElement;
  private gateFlashUntil = 0;
  private readonly boss: HTMLElement;
  private readonly bossFill: HTMLElement;
  private readonly bossText: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly bannerBig: HTMLElement;
  private readonly bannerSmall: HTMLElement;
  private readonly cards: HTMLElement;
  private readonly cardRow: HTMLElement;
  private readonly cardTimer: HTMLElement;
  private readonly self: HTMLElement;
  private readonly note: HTMLElement;
  private readonly end: HTMLElement;
  readonly markers: HTMLElement;
  private flashUntil = 0;
  private bannerUntil = 0;
  private cardDeadline = 0;
  private cardButtons: HTMLButtonElement[] = [];
  private endAnim = 0;
  private onPick: (i: number) => void = () => {};
  private onEnd: (again: boolean) => void = () => {};

  constructor(parent: HTMLElement, touch: boolean) {
    this.root = el('div', `raid-hud${touch ? ' touch' : ''}`, parent);
    const top = el('div', 'raid-top', this.root);
    const row = el('div', 'raid-row', top);
    this.wave = el('span', 'raid-wave', row);
    this.timer = el('span', 'raid-timer', row);
    this.left = el('span', 'raid-left', row);
    this.goalBox = el('div', 'raid-goal', top);
    this.goalName = el('span', 'raid-goal-name', this.goalBox);
    const gbarOuter = el('div', 'raid-bar', this.goalBox);
    this.goalFill = el('div', 'raid-bar-fill', gbarOuter);
    this.goalCount = el('span', 'raid-goal-count', this.goalBox);
    const keep = el('div', 'raid-keep', top);
    const tower = el('div', 'raid-tower raid-core', keep);
    tower.hidden = true;
    el('span', 'raid-tower-label', tower, t('QoreChain core'));
    const bar = el('div', 'raid-bar', tower);
    this.towerFill = el('div', 'raid-bar-fill', bar);
    this.towerText = el('span', 'raid-tower-hp', tower);
    this.gateBox = el('div', 'raid-tower raid-gate', keep);
    this.gateLabel = el('span', 'raid-tower-label', this.gateBox, t('Gate'));
    const gbar = el('div', 'raid-bar', this.gateBox);
    this.gateFill = el('div', 'raid-bar-fill', gbar);
    this.gateText = el('span', 'raid-tower-hp', this.gateBox);
    this.bridgeChip = el('div', 'raid-bridge', top);
    this.cannonBox = el('div', 'raid-cannon', this.root);
    el('span', 'raid-cannon-label', this.cannonBox, t('Bread cannon'));
    const cbar = el('div', 'raid-bar heat', this.cannonBox);
    this.cannonFill = el('div', 'raid-bar-fill', cbar);
    this.cannonState = el('span', 'raid-cannon-state', this.cannonBox);
    this.cannonHint = el('div', 'raid-cannon-hint', this.cannonBox);
    this.promptBox = el('div', 'raid-prompt', this.root);
    this.boss = el('div', 'raid-boss', this.root);
    el('span', 'raid-boss-name', this.boss, t('Big Hunter'));
    const bb = el('div', 'raid-bar', this.boss);
    this.bossFill = el('div', 'raid-bar-fill', bb);
    this.bossText = el('span', 'raid-boss-hp', this.boss);
    this.banner = el('div', 'raid-banner', this.root);
    this.bannerBig = el('div', 'big', this.banner);
    this.bannerSmall = el('div', 'small', this.banner);
    this.cards = el('div', 'raid-cards', this.root);
    el('div', 'raid-cards-title', this.cards, t('Pick an upgrade'));
    this.cardRow = el('div', 'raid-card-row', this.cards);
    this.cardTimer = el('div', 'raid-cards-timer', this.cards);
    this.self = el('div', 'raid-self', this.root);
    this.note = el('div', 'raid-note', this.root);
    this.markers = el('div', 'raid-markers', this.root);
    this.end = el('div', 'raid-end', this.root);
    this.boss.hidden = true;
    this.cannonBox.hidden = true;
    this.promptBox.hidden = true;
    this.cards.hidden = true;
    this.end.hidden = true;
    this.note.hidden = true;
    this.banner.hidden = true;
  }

  set pick(cb: (i: number) => void) {
    this.onPick = cb;
  }

  set ended(cb: (again: boolean) => void) {
    this.onEnd = cb;
  }

  /**
   * The bar at the top: the objective (n of 4) and what it asks, how far
   * along (done of need), the timer (lobby and break count down, an
   * objective counts up) and the hunters out in the field.
   */
  goal(index: number, name: string, done: number, need: number, seconds: number, countdown: boolean, out: number, fighting: boolean): void {
    this.wave.textContent = index > 0 ? t('Objective {n} / {total}', { n: index, total: RAID.objectives }) : t('Hunt Season');
    this.wave.classList.toggle('boss', index === RAID.objectives && fighting);
    this.timer.textContent = clock(Math.max(0, seconds));
    this.timer.classList.toggle('down', countdown);
    this.left.hidden = !fighting;
    this.left.textContent = t('{n} hunters out', { n: out });
    this.goalBox.hidden = !fighting || !name;
    if (!this.goalBox.hidden) {
      if (this.goalName.textContent !== name) this.goalName.textContent = name;
      this.goalCount.textContent = need > 1 ? `${Math.min(done, need)} / ${need}` : '';
      this.goalFill.style.width = `${need > 0 ? Math.min(1, done / need) * 100 : 0}%`;
    }
  }

  /** The QoreChain core's health (the run is lost at 0). */
  core(hp: number, max: number, now: number): void {
    const f = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
    this.towerFill.style.width = `${f * 100}%`;
    this.towerFill.classList.toggle('low', f < 0.3);
    this.towerText.textContent = `${Math.max(0, Math.round(hp))}`;
    this.root.classList.toggle('tower-hit', now < this.flashUntil);
  }

  coreHit(now: number): void {
    this.flashUntil = now + 450;
  }

  /** The gate's health and look (intact, damaged, broken); shown only while it matters. */
  gate(hp: number, max: number, state: number, now: number, show = true): void {
    this.gateBox.hidden = !show;
    const f = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
    this.gateFill.style.width = `${f * 100}%`;
    this.gateFill.classList.toggle('low', state !== GateState.Intact);
    this.gateText.textContent = `${Math.max(0, Math.round(hp))}`;
    const look = state === GateState.Broken ? t('Gate broken') : state === GateState.Damaged ? t('Gate damaged') : t('Gate');
    if (this.gateLabel.textContent !== look) this.gateLabel.textContent = look;
    this.gateBox.dataset.state = String(state);
    this.gateBox.classList.toggle('hit', now < this.gateFlashUntil);
  }

  gateHit(now: number): void {
    this.gateFlashUntil = now + 450;
  }

  /** The drawbridge line: where it is, when it comes down by itself, the lever's cooldown (empty: hidden). */
  bridge(text: string, up: boolean): void {
    this.bridgeChip.hidden = !text;
    if (this.bridgeChip.textContent !== text) this.bridgeChip.textContent = text;
    this.bridgeChip.classList.toggle('up', up);
  }

  /** The cannon we man: its heat (0..1), overheated, ready; hidden when we man none. */
  cannon(show: boolean, heat: number, hot: boolean, ready: boolean, touch: boolean): void {
    this.cannonBox.hidden = !show;
    if (!show) return;
    this.cannonFill.style.width = `${Math.max(0, Math.min(1, heat)) * 100}%`;
    this.cannonFill.classList.toggle('low', hot);
    this.cannonState.textContent = hot ? t('Overheated! Cooling down') : ready ? t('Ready') : t('Reloading...');
    this.cannonBox.classList.toggle('hot', hot);
    this.cannonHint.textContent = touch ? t('Fire: lob a loaf · Use or Jump: leave') : t('Click: lob a loaf · E or Space: leave');
  }

  /** The action prompt under the crosshair (empty: hidden). */
  prompt(text: string): void {
    this.promptBox.hidden = !text;
    if (text && this.promptBox.textContent !== text) this.promptBox.textContent = text;
  }

  bossBar(hp: number, max: number): void {
    this.boss.hidden = max <= 0;
    if (max <= 0) return;
    this.bossFill.style.width = `${Math.max(0, Math.min(1, hp / max)) * 100}%`;
    this.bossText.textContent = `${Math.max(0, Math.round(hp))}`;
  }

  /** A big line in the middle for a while (or until replaced). */
  say(big: string, small = '', ms = 2600, kind = ''): void {
    this.banner.hidden = false;
    this.banner.className = `raid-banner ${kind}`;
    this.bannerBig.textContent = big;
    this.bannerSmall.textContent = small;
    this.bannerUntil = performance.now() + ms;
  }

  /** A lasting line (lobby, break) shown while no timed banner is up. */
  idle(big: string, small: string): void {
    if (performance.now() < this.bannerUntil) return;
    if (!big) {
      this.banner.hidden = true;
      return;
    }
    this.banner.hidden = false;
    this.banner.className = 'raid-banner quiet';
    this.bannerBig.textContent = big;
    this.bannerSmall.textContent = small;
  }

  /** The cards (empty: close them). Keys 1 to 3 or a tap pick. */
  offer(cards: [number, number][], deadline: number, touch: boolean): void {
    this.cardRow.replaceChildren();
    this.cardButtons = [];
    this.cards.hidden = cards.length === 0;
    this.root.classList.toggle('cards-open', cards.length > 0);
    this.cardDeadline = deadline;
    cards.forEach(([id, value], i) => {
      const text = UPGRADE_TEXT[id as UpgradeId];
      const b = el('button', 'raid-card', this.cardRow);
      b.type = 'button';
      b.dataset.upgrade = String(id);
      el('span', 'key', b, touch ? '' : String(i + 1));
      el('span', 'icon', b, text?.icon ?? '?');
      el('span', 'name', b, t(text?.name ?? '?'));
      el('span', 'line', b, t(text?.line ?? '', { n: value }));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onPick(i);
      });
      this.cardButtons.push(b);
    });
    this.cards.querySelector('.raid-cards-title')!.textContent = `${t('Pick an upgrade')} · ${touch ? t('Tap a card') : t('Press 1, 2 or 3')}`;
  }

  get cardsOpen(): boolean {
    return !this.cards.hidden;
  }

  /** The picked card lights up a moment before the cards close. */
  picked(i: number): void {
    this.cardButtons.forEach((b, k) => b.classList.toggle('picked', k === i));
  }

  cardsFrame(serverNow: number): void {
    if (this.cards.hidden) return;
    this.cardTimer.textContent = t('A random card in {n} s', { n: Math.max(0, Math.ceil((this.cardDeadline - serverNow) / 1000)) });
  }

  /** The duck's own upgrades, short. */
  selfLine(text: string): void {
    this.self.textContent = text;
    this.self.hidden = !text;
  }

  /** Knocked or out notes. */
  noteLine(big: string | null, small = ''): void {
    this.note.hidden = !big;
    if (!big) return;
    this.note.replaceChildren(el('div', 'big', undefined, big), el('div', 'small', undefined, small));
  }

  frame(now: number): void {
    if (now > this.bannerUntil && !this.banner.classList.contains('quiet')) this.banner.hidden = true;
  }

  // ---- the end screen ---------------------------------------------------------

  showEnd(v: RaidEndView, closesIn: number): void {
    this.cards.hidden = true;
    this.root.classList.remove('cards-open');
    this.end.hidden = false;
    this.end.replaceChildren();
    const card = el('div', 'raid-end-card', this.end);
    const won = v.reason === 1;
    el('div', 'kicker', card, t('Hunt Season'));
    el('h2', won ? 'won' : 'lost', card, won ? t('The field is ours!') : v.reason === 2 ? t('The core fell') : t('Every duck is down'));
    el('p', 'sub', card, won ? t('The Big Hunter is down and the hunters went home.') : t('You took {n} of {total} objectives.', { n: v.waves, total: RAID.objectives }));
    const stats = el('div', 'raid-end-stats', card);
    const stat = (label: string, value: string) => {
      const s = el('div', 'stat', stats);
      el('small', '', s, label);
      el('strong', '', s, value);
    };
    stat(t('Objectives'), `${v.waves} / ${RAID.objectives}`);
    stat(t('Hunters bagged'), String(v.kills));
    stat(t('Bosses'), String(v.bossKills));
    stat(t('Revives'), String(v.revives));
    stat(t('Time'), clock(v.runMs / 1000));
    const xp = el('div', 'raid-end-xp', card);
    const gains = el('div', 'gains', xp);
    el('div', 'gain', gains, t('+{n} XP', { n: v.xp }));
    // Tüy (Feathers): earned only here, spent at the Blacksmith and the Armorer in Duck Plaza.
    const tuy = el('div', 'gain tuy', gains);
    el('span', 'tuy-icon', tuy);
    el('span', '', tuy, t('+{n} Tüy', { n: v.feathers }));
    if (v.daily > 0) el('div', 'daily', xp, t('First hunt of the day: +{n} Tüy', { n: v.daily }));
    const unlocks = el('div', 'unlocks', xp);
    const lv = el('div', 'level', xp);
    const label = el('span', 'lv', lv);
    const bar = el('div', 'raid-bar xp', lv);
    const fill = el('div', 'raid-bar-fill', bar);
    const saved = v.granted ? t('XP is saved to your duck.') : v.failed ? t('XP could not be saved this time.') : t('Saving your XP...');
    const status = el('p', `xp-note${v.failed ? ' failed' : ''}`, xp, saved);
    if (v.newBest) el('div', 'best', xp, t('New best!'));
    else if (v.bestWave > 0) el('div', 'best quiet', xp, t('Best: {n} objectives', { n: v.bestWave }));
    // The level bar fills from the XP before the run to the XP after it.
    cancelAnimationFrame(this.endAnim);
    const from = v.xpBefore >= 0 ? v.xpBefore : 0;
    const to = v.xpBefore >= 0 ? v.xpAfter : v.xp;
    const startLevel = levelProgress(from).level;
    const t0 = performance.now();
    const step = (): void => {
      const k = Math.min(1, (performance.now() - t0) / 1600);
      const e = 1 - (1 - k) ** 3;
      const p = levelProgress(from + (to - from) * e);
      label.textContent = t('Level {n}', { n: p.level });
      fill.style.width = `${p.share * 100}%`;
      lv.classList.toggle('up', p.level > startLevel);
      if (p.level > startLevel) status.textContent = v.failed ? saved : `${t('Level up!')} ${v.granted ? saved : ''}`;
      if (k < 1) this.endAnim = requestAnimationFrame(step);
      else if (v.granted) this.unlockLines(unlocks, startLevel, p.level);
    };
    step();
    const buttons = el('div', 'raid-end-buttons', card);
    const again = el('button', 'again', buttons, t('Play again'));
    const back = el('button', 'back', buttons, t('Back to the pond'));
    again.type = 'button';
    back.type = 'button';
    again.addEventListener('click', () => this.onEnd(true));
    back.addEventListener('click', () => this.onEnd(false));
    el('p', 'closes', card, t('Closes in {n} s', { n: closesIn }));
  }

  /** After a level-up: the moves it unlocked and the new tree points. */
  private unlockLines(box: HTMLElement, from: number, to: number): void {
    box.replaceChildren();
    if (to <= from) return;
    for (const id of newUnlocks(from, to)) el('div', 'unlock', box, t('New skill unlocked: {name}', { name: t(SKILL_NAMES[id]) }));
    const pts = treePoints(to) - treePoints(from);
    if (pts > 0) el('div', 'unlock points', box, pts === 1 ? t('+1 skill point: spend it in My Duck (Esc)') : t('+{n} skill points: spend them in My Duck (Esc)', { n: pts }));
  }

  get endOpen(): boolean {
    return !this.end.hidden;
  }

  endCountdown(n: number): void {
    const c = this.end.querySelector('.closes');
    if (c) c.textContent = t('Closes in {n} s', { n: Math.max(0, n) });
  }

  dispose(): void {
    cancelAnimationFrame(this.endAnim);
    this.root.remove();
  }
}
