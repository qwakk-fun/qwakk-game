/**
 * The player-facing HUD: dynamic crosshair, hit marker, health, ammo, kill
 * feed, round timer, scoreboard (Tab), damage direction, low-health
 * vignette, death and round-end screens. Plain DOM, updated each frame with
 * cheap property writes only.
 */

export interface ScoreRow {
  name: string;
  kills: number;
  deaths: number;
  bot: boolean;
  me: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

export class GameHud {
  private readonly root: HTMLElement;
  private readonly cross: HTMLElement;
  private readonly crossLines: HTMLElement[];
  private readonly marker: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly ammo: HTMLElement;
  private readonly weaponName: HTMLElement;
  private readonly reloadBar: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly score: HTMLElement;
  private readonly board: HTMLElement;
  private readonly vignette: HTMLElement;
  private readonly focus: HTMLElement;
  private lastFocus = -1;
  private readonly flash: HTMLElement;
  private readonly center: HTMLElement;
  private readonly arcs: HTMLElement;
  private readonly protect: HTMLElement;
  private markerT = 0;
  private lastAmmo = '';
  private lastBoard = '';
  private lastMessage: string | null = null;
  private flashT = 0;
  private readonly arcList: { e: HTMLElement; t: number; worldAngle: number }[] = [];

  constructor(app: HTMLElement) {
    this.root = el('div', 'ghud', app);
    this.focus = el('div', 'ghud-focus', this.root);
    this.vignette = el('div', 'ghud-vignette', this.root);
    this.flash = el('div', 'ghud-flash', this.root);
    this.arcs = el('div', 'ghud-arcs', this.root);
    this.cross = el('div', 'ghud-cross', this.root);
    this.crossLines = ['t', 'b', 'l', 'r'].map((k) => el('div', `ghud-cl ghud-cl-${k}`, this.cross));
    el('div', 'ghud-cdot', this.cross);
    this.marker = el('div', 'ghud-marker', this.root);
    for (const k of ['a', 'b', 'c', 'd']) el('div', `ghud-m ghud-m-${k}`, this.marker);

    const hp = el('div', 'ghud-hp', this.root);
    const bar = el('div', 'ghud-hpbar', hp);
    this.hpFill = el('div', 'ghud-hpfill', bar);
    this.hpText = el('div', 'ghud-hptext', hp);

    const am = el('div', 'ghud-ammo', this.root);
    this.weaponName = el('div', 'ghud-wname', am);
    this.ammo = el('div', 'ghud-count', am);
    const rb = el('div', 'ghud-reload', am);
    this.reloadBar = el('div', 'ghud-reloadfill', rb);

    this.feed = el('div', 'ghud-feed', this.root);
    const top = el('div', 'ghud-top', this.root);
    this.timer = el('div', 'ghud-timer', top);
    this.score = el('div', 'ghud-score', top);
    this.board = el('div', 'ghud-board', this.root);
    this.board.hidden = true;
    this.center = el('div', 'ghud-center', this.root);
    this.protect = el('div', 'ghud-protect', this.root);
    this.protect.textContent = 'Spawn protection';
  }

  /** The root element, for mode-specific HUD parts (battle royale) to attach to. */
  get element(): HTMLElement {
    return this.root;
  }

  /** Battle royale hides the deathmatch round bar (it has its own). */
  setMode(mode: 'br' | 'dm'): void {
    this.root.classList.toggle('br', mode === 'br');
  }

  /** Taking zone damage: a short orange tint. */
  zoneHurt(): void {
    this.flashT = 0.35;
    this.flash.classList.add('zone');
    setTimeout(() => this.flash.classList.remove('zone'), 400);
  }

  dispose(): void {
    this.root.remove();
  }

  set visible(v: boolean) {
    this.root.style.display = v ? '' : 'none';
  }

  /** Crosshair gap from the current spread cone (rad) and the vertical field of view. */
  crosshair(spread: number, fovDeg: number, viewportH: number): void {
    const px = (Math.tan(spread) / Math.tan(((fovDeg / 2) * Math.PI) / 180)) * (viewportH / 2);
    const gap = Math.max(4, Math.min(80, px)) + 2;
    const [t, b, l, r] = this.crossLines as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    t.style.transform = `translate(-50%, ${-gap - 9}px)`;
    b.style.transform = `translate(-50%, ${gap}px)`;
    l.style.transform = `translate(${-gap - 9}px, -50%)`;
    r.style.transform = `translate(${gap}px, -50%)`;
  }

  /** Aim down sights: darken the screen edges a little (0 hip to 1 full aim). */
  aimFocus(blend: number): void {
    const v = Math.round(blend * 50) / 50;
    if (v === this.lastFocus) return;
    this.lastFocus = v;
    this.focus.style.opacity = String(v);
    this.cross.classList.toggle('ads', v > 0.5);
  }

  /** Hit marker: white for a hit, yellow for a headshot, red for a kill. */
  hitMarker(kind: 'hit' | 'head' | 'kill'): void {
    this.marker.className = `ghud-marker on ${kind}`;
    this.markerT = kind === 'kill' ? 0.45 : 0.22;
  }

  health(hp: number, max: number): void {
    const f = Math.max(0, hp / max);
    this.hpFill.style.width = `${f * 100}%`;
    this.hpFill.classList.toggle('low', f < 0.35);
    this.hpText.textContent = `${Math.max(0, Math.round(hp))}`;
    this.vignette.style.opacity = f < 0.4 ? `${(0.4 - f) * 2.2}` : '0';
  }

  ammoInfo(name: string, mag: number, reserve: number, reload: number): void {
    const key = `${name}|${mag}|${reserve}`;
    if (key !== this.lastAmmo) {
      this.lastAmmo = key;
      this.weaponName.textContent = name;
      this.ammo.innerHTML = `<b>${mag}</b> / ${reserve}`;
      this.ammo.classList.toggle('empty', mag === 0);
    }
    this.reloadBar.parentElement!.style.visibility = reload > 0 ? 'visible' : 'hidden';
    this.reloadBar.style.width = `${Math.round(reload * 100)}%`;
  }

  /** Damage taken: red flash and an arc pointing at the attacker (world angle, radians). */
  damaged(worldAngle: number): void {
    this.flashT = 0.25;
    const e = el('div', 'ghud-arc', this.arcs);
    this.arcList.push({ e, t: 1.4, worldAngle });
  }

  killFeed(killer: string, victim: string, weapon: string, head: boolean, mine: boolean): void {
    const row = el('div', `ghud-feedrow${mine ? ' mine' : ''}`, this.feed);
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = killer;
    const w = document.createElement('span');
    w.className = 'w';
    w.textContent = head ? `${weapon}, head` : weapon;
    const v = document.createElement('span');
    v.className = 'v';
    v.textContent = victim;
    row.append(k, w, v);
    while (this.feed.children.length > 5) this.feed.firstElementChild?.remove();
    setTimeout(() => row.remove(), 6000);
  }

  round(secondsLeft: number, myKills: number, limit: number, leader: string, leaderKills: number): void {
    const m = Math.floor(secondsLeft / 60);
    const s = secondsLeft % 60;
    this.timer.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    this.score.textContent = `You ${myKills}  |  ${leader} ${leaderKills}  |  First to ${limit}`;
  }

  scoreboard(rows: ScoreRow[] | null): void {
    if (!rows) {
      this.board.hidden = true;
      return;
    }
    const sorted = [...rows].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    const html =
      '<div class="ghud-bhead"><span>Duck</span><span>K</span><span>D</span></div>' +
      sorted.map((r) => `<div class="ghud-brow${r.me ? ' me' : ''}"><span>${esc(r.name)}</span><span>${r.kills}</span><span>${r.deaths}</span></div>`).join('');
    this.board.hidden = false;
    if (html !== this.lastBoard) {
      this.lastBoard = html;
      this.board.innerHTML = html;
    }
  }

  /** Big center message (death, round end); null hides it. */
  message(html: string | null): void {
    if (html === this.lastMessage) return;
    this.lastMessage = html;
    if (html === null) {
      this.center.hidden = true;
      return;
    }
    this.center.hidden = false;
    this.center.innerHTML = html;
  }

  /** Hide the crosshair while dead or spectating a death. */
  crosshairVisible(on: boolean): void {
    this.cross.style.display = on ? '' : 'none';
  }

  protection(on: boolean): void {
    this.protect.hidden = !on;
  }

  private knockedOn = false;

  /** Knocked: the health bar becomes the bleed meter (orange). */
  knocked(on: boolean): void {
    if (on === this.knockedOn) return;
    this.knockedOn = on;
    this.root.classList.toggle('ghud-knocked', on);
  }

  /** Per-frame fades. `cameraYaw` turns world-space damage arcs into screen space. */
  update(dt: number, cameraYaw: number): void {
    if (this.markerT > 0) {
      this.markerT -= dt;
      if (this.markerT <= 0) this.marker.className = 'ghud-marker';
    }
    this.flashT = Math.max(0, this.flashT - dt);
    this.flash.style.opacity = `${this.flashT * 2}`;
    for (let i = this.arcList.length - 1; i >= 0; i--) {
      const a = this.arcList[i] as { e: HTMLElement; t: number; worldAngle: number };
      a.t -= dt;
      if (a.t <= 0) {
        a.e.remove();
        this.arcList.splice(i, 1);
        continue;
      }
      const rel = a.worldAngle - cameraYaw;
      a.e.style.transform = `translate(-50%, -50%) rotate(${-rel}rad)`;
      a.e.style.opacity = `${Math.min(1, a.t)}`;
    }
  }
}
