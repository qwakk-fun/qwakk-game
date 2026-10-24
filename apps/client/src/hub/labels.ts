/**
 * Labels over the ducks in the plaza, as a DOM layer over the canvas: name,
 * #tag and a small level badge ("Guest" for a guest), plus the speech bubble
 * of their latest chat line for a few seconds. The match name tag rules
 * (game/nameTags.ts), widened for a place without combat: labels within
 * HUB.labelRange of the player, fading from HUB.labelFade, never through a
 * wall (a camera ray through opaque geometry), no label over your own duck
 * (only your speech bubble). Text goes in as text nodes, never as HTML.
 */
import * as THREE from 'three/webgpu';
import { OPAQUE_QUERY_GROUPS, type SimWorld } from '@qwakk/shared';
import { HUB } from '@qwakk/shared/hub';
import { COPY } from '../ui/menu/copy.ts';

export interface LabelDuck {
  id: string;
  name: string;
  tag: string;
  level: number;
  /** Feet position as drawn, and the drawn crouch (0..1). */
  x: number;
  y: number;
  z: number;
  crouch: number;
  self: boolean;
  teammate: boolean;
  /** Pointed at (the crosshair or the cursor): drawn brighter. */
  hot: boolean;
}

interface El {
  root: HTMLElement;
  plate: HTMLElement;
  name: HTMLElement;
  tag: HTMLElement;
  level: HTMLElement;
  bubble: HTMLElement;
  key: string;
  bubbleUntil: number;
  /** Occlusion: the last test result and when to test again. */
  clear: boolean;
  testAt: number;
}

const _v = new THREE.Vector3();
const LABEL_Y = 1.95;
const LABEL_CROUCH_Y = 1.5;

export class HubLabels {
  readonly layer: HTMLElement;
  private readonly sim: SimWorld;
  private readonly els = new Map<string, El>();
  private frame = 0;
  /** Labels on screen last frame (test hook). */
  shown = 0;

  constructor(parent: HTMLElement, sim: SimWorld) {
    this.sim = sim;
    this.layer = document.createElement('div');
    this.layer.className = 'hub-labels';
    parent.append(this.layer);
  }

  /** Show `text` in a bubble over this duck for a few seconds. */
  say(id: string, text: string): void {
    const e = this.el(id);
    e.bubble.textContent = text;
    e.bubble.hidden = false;
    e.bubble.classList.remove('pop');
    void e.bubble.offsetWidth;
    e.bubble.classList.add('pop');
    e.bubbleUntil = performance.now() + HUB.bubbleMs;
  }

  /** Screen position of a duck's label anchor (CSS px), or null when off screen. Reused vector. */
  anchor(camera: THREE.PerspectiveCamera, x: number, y: number, z: number): { x: number; y: number } | null {
    _v.set(x, y + LABEL_Y + 0.35, z).project(camera);
    if (_v.z > 1 || _v.z < -1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) return null;
    const w = this.layer.clientWidth || window.innerWidth;
    const h = this.layer.clientHeight || window.innerHeight;
    return { x: (_v.x * 0.5 + 0.5) * w, y: (-_v.y * 0.5 + 0.5) * h };
  }

  update(camera: THREE.PerspectiveCamera, ducks: readonly LabelDuck[], viewer: THREE.Vector3): void {
    this.frame++;
    const now = performance.now();
    const w = this.layer.clientWidth || window.innerWidth;
    const h = this.layer.clientHeight || window.innerHeight;
    const seen = new Set<string>();
    let shown = 0;
    for (const d of ducks) {
      seen.add(d.id);
      const e = this.el(d.id);
      const talking = e.bubbleUntil > now;
      if (!talking && !e.bubble.hidden) e.bubble.hidden = true;
      const dist = Math.hypot(d.x - viewer.x, d.y - viewer.y, d.z - viewer.z);
      const plate = !d.self && dist < HUB.labelRange;
      if ((!plate && !talking) || dist > HUB.labelRange * 1.3) {
        e.root.hidden = true;
        continue;
      }
      const top = d.y + LABEL_Y + (LABEL_CROUCH_Y - LABEL_Y) * d.crouch;
      _v.set(d.x, top, d.z).project(camera);
      if (_v.z > 1 || _v.z < -1 || Math.abs(_v.x) > 1.05 || Math.abs(_v.y) > 1.05) {
        e.root.hidden = true;
        continue;
      }
      // Never through a wall: a camera ray to the head, re-tested every few frames.
      if (!d.self && now >= e.testAt) {
        e.clear = this.clearLine(camera.position, d.x, d.y + 1.3, d.z);
        e.testAt = now + 120 + (this.frame % 5) * 20;
      }
      if (!d.self && !e.clear) {
        e.root.hidden = true;
        continue;
      }
      const key = `${d.name}|${d.tag}|${d.level}|${d.teammate ? 1 : 0}|${d.self ? 1 : 0}`;
      if (key !== e.key) {
        e.key = key;
        e.name.textContent = d.name;
        e.tag.textContent = d.tag ? `#${d.tag}` : '';
        e.level.textContent = d.level > 0 ? COPY.hub.level(d.level) : COPY.hub.guest;
        e.level.classList.toggle('is-guest', d.level === 0);
        e.root.classList.toggle('is-mate', d.teammate);
      }
      e.plate.hidden = !plate;
      e.root.classList.toggle('is-hot', d.hot);
      const fade = d.self ? 0 : Math.max(0, (dist - HUB.labelFade) / (HUB.labelRange - HUB.labelFade));
      e.root.style.opacity = String(d.hot ? 1 : 1 - 0.85 * fade);
      const px = Math.round((_v.x * 0.5 + 0.5) * w);
      const py = Math.round((-_v.y * 0.5 + 0.5) * h);
      const scale = Math.max(0.72, Math.min(1, 9 / Math.max(1, dist)));
      e.root.style.transform = `translate3d(${px}px, ${py}px, 0) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
      e.root.hidden = false;
      if (plate) shown++;
    }
    for (const [id, e] of this.els) {
      if (seen.has(id)) continue;
      e.root.remove();
      this.els.delete(id);
    }
    this.shown = shown;
  }

  private clearLine(cam: THREE.Vector3, x: number, y: number, z: number): boolean {
    const s = this.sim;
    const dist = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
    if (dist < 0.01) return true;
    const dir = { x: (x - cam.x) / dist, y: (y - cam.y) / dist, z: (z - cam.z) / dist };
    return !s.world.castRay(new s.rapier.Ray({ x: cam.x, y: cam.y, z: cam.z }, dir), dist - 0.4, true, undefined, OPAQUE_QUERY_GROUPS);
  }

  private el(id: string): El {
    let e = this.els.get(id);
    if (e) return e;
    const root = document.createElement('div');
    root.className = 'hl';
    root.hidden = true;
    const bubble = document.createElement('div');
    bubble.className = 'hl-bubble';
    bubble.dir = 'auto';
    bubble.hidden = true;
    const plate = document.createElement('div');
    plate.className = 'hl-plate';
    const name = document.createElement('span');
    name.className = 'hl-name';
    const tag = document.createElement('span');
    tag.className = 'hl-tag';
    const level = document.createElement('span');
    level.className = 'hl-level';
    plate.append(level, name, tag);
    root.append(bubble, plate);
    this.layer.append(root);
    e = { root, plate, name, tag, level, bubble, key: '', bubbleUntil: 0, clear: true, testAt: 0 };
    this.els.set(id, e);
    return e;
  }

  dispose(): void {
    this.layer.remove();
    this.els.clear();
  }
}
