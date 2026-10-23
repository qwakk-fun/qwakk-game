/**
 * Deathmatch kill stacks and caped hero HUD: your stack meter, your flight
 * energy while you wear the cape, the hero compass (the coarse public ping,
 * never a pose) and the center announcement. Reads only authoritative state
 * and server messages.
 */
import { HERO_FLIGHT, KILL_STACKS } from '@qwakk/shared';
import { t } from '../i18n/game.ts';
import './dmHero.css';

const el = (tag: string, cls: string, parent: HTMLElement): HTMLElement => {
  const e = document.createElement(tag);
  e.className = cls;
  parent.append(e);
  return e;
};

/** How long a ping stays on the compass (s): a bit longer than the ping cadence. */
const PING_SHOW_S = 7.5;

export class DmHeroHud {
  readonly root: HTMLElement;
  private readonly stacks: HTMLElement;
  private readonly pips: HTMLElement[] = [];
  private readonly fly: HTMLElement;
  private readonly flyFill: HTMLElement;
  private readonly compass: HTMLElement;
  private readonly arrow: HTMLElement;
  private readonly compassText: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly bannerTitle: HTMLElement;
  private readonly bannerDetail: HTMLElement;
  private bannerTimer: ReturnType<typeof setTimeout> | null = null;
  private lastStacks = -1;
  private ping: { x: number; z: number; at: number; name: string } | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'dmh', parent);
    this.stacks = el('div', 'dmh-stacks', this.root);
    el('span', 'dmh-label', this.stacks).textContent = t('Power');
    const row = el('span', 'dmh-pips', this.stacks);
    for (let i = 0; i < KILL_STACKS.max; i++) this.pips.push(el('i', 'dmh-pip', row));
    this.fly = el('div', 'dmh-fly', this.root);
    el('span', 'dmh-label', this.fly).textContent = t('Flight');
    const bar = el('span', 'dmh-flybar', this.fly);
    this.flyFill = el('b', 'dmh-flyfill', bar);
    this.compass = el('div', 'dmh-compass', this.root);
    this.arrow = el('span', 'dmh-arrow', this.compass);
    this.arrow.textContent = '▲';
    this.compassText = el('span', 'dmh-ctext', this.compass);
    this.banner = el('div', 'dmh-banner', this.root);
    el('small', 'dmh-kicker', this.banner).textContent = t('CAPED HERO');
    this.bannerTitle = el('strong', '', this.banner);
    this.bannerDetail = el('span', '', this.banner);
    this.stacks.hidden = true;
    this.fly.hidden = true;
    this.compass.hidden = true;
    this.banner.hidden = true;
  }

  /** The center announcement. */
  announce(title: string, detail: string, mine: boolean): void {
    this.bannerTitle.textContent = title;
    this.bannerDetail.textContent = detail;
    this.bannerDetail.hidden = detail === '';
    this.banner.hidden = false;
    this.banner.classList.toggle('mine', mine);
    // Restart the pop-in animation.
    this.banner.classList.remove('pop');
    void this.banner.offsetWidth;
    this.banner.classList.add('pop');
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => (this.banner.hidden = true), 3200);
  }

  /** A coarse hero ping arrived (grid meters). */
  pinged(x: number, z: number, name: string, now: number): void {
    this.ping = { x, z, at: now, name };
  }

  clearPing(): void {
    this.ping = null;
  }

  /**
   * Every frame. `stacks` and `energy` are yours (energy null without the
   * cape); `me` and `yaw` place the compass arrow (yaw: the camera's).
   */
  update(now: number, show: boolean, stacks: number, energy: number | null, me: { x: number; z: number } | null, yaw: number): void {
    this.root.hidden = !show;
    if (!show) return;
    if (stacks !== this.lastStacks) {
      this.lastStacks = stacks;
      this.stacks.hidden = stacks === 0;
      this.pips.forEach((p, i) => p.classList.toggle('on', i < stacks));
      this.stacks.classList.toggle('max', stacks >= KILL_STACKS.max);
    }
    this.fly.hidden = energy === null;
    if (energy !== null) {
      const f = Math.max(0, Math.min(1, energy / HERO_FLIGHT.energyTicks));
      this.flyFill.style.width = `${Math.round(f * 100)}%`;
      this.fly.classList.toggle('low', f < 0.25);
    }
    const p = this.ping;
    const fresh = p !== null && me !== null && energy === null && (now - p.at) / 1000 < PING_SHOW_S;
    this.compass.hidden = !fresh;
    if (!fresh || !p || !me) return;
    const dx = p.x - me.x;
    const dz = p.z - me.z;
    const d = Math.hypot(dx, dz);
    // World angle toward the ping (three.js yaw: forward is -z), relative to where the camera looks.
    const toward = Math.atan2(-dx, -dz);
    const rel = toward - yaw;
    this.arrow.style.transform = `rotate(${-rel}rad)`;
    this.compassText.textContent = t('{name} · about {n} m', { name: p.name, n: Math.max(10, Math.round(d / 10) * 10) });
    this.compass.style.opacity = String(Math.max(0.35, 1 - (now - p.at) / 1000 / PING_SHOW_S));
  }

  dispose(): void {
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.root.remove();
  }
}
