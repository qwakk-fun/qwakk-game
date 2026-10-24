/**
 * The katana's HUD (Hunt Season v3): the combo counter (grows while the duck
 * keeps cutting, its XP bonus beside it, fades when the 3 s window runs
 * out), the skill bar (Dash, Quack, Blade Storm: cooldown sweeps from the
 * predicted sim state, the storm's meter), the damage numbers that pop out
 * of hunters (the server's numbers: crits bigger and orange, kills with a
 * star) and the kill streak call-outs. DOM only, cheap: pooled elements,
 * transforms only.
 */
import * as THREE from 'three/webgpu';
import { t } from '../../i18n/game.ts';
import './blade.css';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.append(e);
  return e;
};

interface Floater {
  e: HTMLElement;
  x: number;
  y: number;
  z: number;
  age: number;
  life: number;
  rise: number;
  dx: number;
}

export interface SkillView {
  /** 0 ready, else the share of the cooldown left. */
  dash: number;
  quack: number;
  /** The storm meter 0..1, and whether it is spinning now (share left). */
  meter: number;
  storm: number;
  pistol: boolean;
}

const STREAK_TEXT: [number, string][] = [
  [30, 'Duck of Legend!'],
  [20, 'Feather Storm!'],
  [12, 'Unstoppable!'],
  [8, 'Rampage!'],
  [5, 'Quintuple Quack!'],
  [3, 'Triple Cut!'],
];

export class BladeHud {
  readonly root: HTMLElement;
  private readonly combo: HTMLElement;
  private readonly comboN: HTMLElement;
  private readonly comboBonus: HTMLElement;
  private readonly comboBar: HTMLElement;
  private readonly callout: HTMLElement;
  private readonly numbers: HTMLElement;
  private readonly skills: HTMLElement;
  private readonly dash: HTMLElement;
  private readonly quack: HTMLElement;
  private readonly storm: HTMLElement;
  private readonly floaters: Floater[] = [];
  private readonly pool: HTMLElement[] = [];
  private comboCount = 0;
  private comboAt = 0;
  private calloutUntil = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly touch: boolean;

  constructor(parent: HTMLElement, touch: boolean) {
    this.touch = touch;
    this.root = el('div', 'blade-hud', parent);
    this.numbers = el('div', 'blade-numbers', this.root);
    this.combo = el('div', 'blade-combo', this.root);
    this.comboN = el('div', 'n', this.combo);
    el('div', 'label', this.combo, t('Combo'));
    this.comboBonus = el('div', 'bonus', this.combo);
    const bar = el('div', 'bar', this.combo);
    this.comboBar = el('div', 'fill', bar);
    this.callout = el('div', 'blade-callout', this.root);
    this.skills = el('div', 'blade-skills', this.root);
    const skill = (cls: string, key: string, name: string): HTMLElement => {
      const s = el('div', `blade-skill ${cls}`, this.skills);
      el('div', 'sweep', s);
      el('div', 'icon', s);
      if (!touch) el('div', 'key', s, key);
      el('div', 'name', s, name);
      return s;
    };
    this.dash = skill('dash', 'X', t('Dash'));
    this.quack = skill('quack', 'Q', t('VAK!'));
    this.storm = skill('storm', 'F', t('Blade Storm'));
    this.combo.hidden = true;
    this.callout.hidden = true;
  }

  /** The skill bar from the predicted sim state (hidden while out or when not a katana duck). */
  skillsFrame(v: SkillView | null): void {
    this.skills.hidden = !v;
    if (!v) return;
    const set = (e: HTMLElement, left: number): void => {
      e.style.setProperty('--left', String(Math.max(0, Math.min(1, left))));
      e.classList.toggle('ready', left <= 0);
    };
    set(this.dash, v.dash);
    set(this.quack, v.quack);
    this.storm.style.setProperty('--left', String(v.storm > 0 ? 1 - v.storm : 1 - v.meter));
    this.storm.classList.toggle('ready', v.meter >= 1 && v.storm <= 0);
    this.storm.classList.toggle('spinning', v.storm > 0);
    this.skills.classList.toggle('pistol', v.pistol);
  }

  /** The server's combo count (0 hides it after its window) and the bonus it gives on kill XP. */
  setCombo(n: number, now: number): void {
    if (n <= 0) return;
    const grew = n > this.comboCount;
    this.comboCount = n;
    this.comboAt = now;
    this.combo.hidden = n < 2;
    this.comboN.textContent = String(n);
    this.comboBonus.textContent = n >= 2 ? t('+{n}% XP', { n: Math.min(50, n) }) : '';
    this.combo.classList.toggle('hot', n >= 10);
    this.combo.classList.toggle('blaze', n >= 25);
    if (grew) {
      this.combo.classList.remove('bump');
      void this.combo.offsetWidth;
      this.combo.classList.add('bump');
    }
  }

  /** A streak call-out: Triple Cut, Rampage... */
  streak(n: number, now: number): void {
    const text = STREAK_TEXT.find(([k]) => n >= k)?.[1];
    if (!text) return;
    this.callout.hidden = false;
    this.callout.textContent = t(text);
    this.callout.classList.remove('pop');
    void this.callout.offsetWidth;
    this.callout.classList.add('pop');
    this.calloutUntil = now + 1500;
  }

  /** A damage number at a world point (the server's hit), rising and fading. */
  number(x: number, y: number, z: number, damage: number, crit: boolean, kill: boolean, skill: boolean, crate: boolean): void {
    if (damage <= 0) return;
    if (this.floaters.length > 48) this.recycle(this.floaters.shift()!);
    const e = this.pool.pop() ?? el('div', 'blade-num');
    e.className = `blade-num${crit ? ' crit' : ''}${kill ? ' kill' : ''}${skill ? ' skill' : ''}${crate ? ' crate' : ''}`;
    e.textContent = `${damage}${crit ? '!' : ''}`;
    this.numbers.append(e);
    this.floaters.push({ e, x, y, z, age: 0, life: crit ? 0.95 : 0.75, rise: crit ? 1.3 : 0.9, dx: (Math.random() - 0.5) * 0.8 });
  }

  private recycle(f: Floater): void {
    f.e.remove();
    this.pool.push(f.e);
  }

  /** Every frame: the numbers follow their spot on screen, the combo bar runs down. */
  frame(dt: number, camera: THREE.Camera, now: number, comboWindowMs: number): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i]!;
      f.age += dt;
      if (f.age >= f.life) {
        this.floaters.splice(i, 1);
        this.recycle(f);
        continue;
      }
      const k = f.age / f.life;
      this.tmp.set(f.x + f.dx * k, f.y + f.rise * (1 - (1 - k) * (1 - k)), f.z).project(camera);
      if (this.tmp.z > 1) {
        f.e.style.opacity = '0';
        continue;
      }
      const sx = (this.tmp.x * 0.5 + 0.5) * w;
      const sy = (-this.tmp.y * 0.5 + 0.5) * h;
      const pop = k < 0.12 ? 0.6 + (k / 0.12) * 0.7 : 1.3 - Math.min(0.3, (k - 0.12) * 0.6);
      f.e.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%) scale(${pop.toFixed(3)})`;
      f.e.style.opacity = String(k > 0.7 ? (1 - k) / 0.3 : 1);
    }
    const left = this.comboCount > 0 ? 1 - (now - this.comboAt) / comboWindowMs : 0;
    if (left <= 0 && this.comboCount > 0) {
      this.comboCount = 0;
      this.combo.hidden = true;
    }
    this.comboBar.style.width = `${Math.max(0, left) * 100}%`;
    if (!this.callout.hidden && now > this.calloutUntil) this.callout.hidden = true;
  }

  get comboShown(): number {
    return this.combo.hidden ? 0 : this.comboCount;
  }

  dispose(): void {
    this.root.remove();
  }

  /** Touch play has its own skill buttons (input/touch): the bar is only a meter there. */
  get isTouch(): boolean {
    return this.touch;
  }
}
