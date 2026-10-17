import { t as translate } from '../i18n/game.ts';
/**
 * Name tags over ducks, as a DOM layer over the canvas:
 *
 * - All names are small and faint, fading out over NAMETAG.fadeStart..range.
 *   Range is measured from the player's feet, not the camera boom. No self tag.
 * - Allies keep their green marker and knocked badge within the same range.
 * - Enemies need a received pose and a currently visible head or chest.
 *   Close or recently hidden poses can still arrive, so check occlusion here.
 */
import * as THREE from 'three/webgpu';
import { HITBOX, NAMETAG, OPAQUE_QUERY_GROUPS, type SimWorld } from '@qwakk/shared';

export interface TagDuck {
  id: string;
  name: string;
  ally: boolean;
  alive: boolean;
  down: boolean;
  /** Feet position as drawn, and the drawn crouch (0..1). */
  x: number;
  y: number;
  z: number;
  crouch: number;
}

interface TagEl {
  root: HTMLElement;
  name: HTMLElement;
  meta: HTMLElement;
  key: string;
  shown: boolean;
}

const _v = new THREE.Vector3();

export class NameTags {
  private readonly layer: HTMLElement;
  private readonly sim: SimWorld;
  private readonly tags = new Map<string, TagEl>();
  /** Counters for the test hook. */
  readonly stats = { allyTags: 0, enemyTags: 0 };

  constructor(parent: HTMLElement, sim: SimWorld) {
    this.sim = sim;
    this.layer = document.createElement('div');
    this.layer.className = 'nt-layer';
    parent.appendChild(this.layer);
  }

  /** Once per frame, after the ducks were placed. */
  update(camera: THREE.PerspectiveCamera, ducks: readonly TagDuck[], viewer: THREE.Vector3): void {
    const w = this.layer.clientWidth || window.innerWidth;
    const h = this.layer.clientHeight || window.innerHeight;
    const cam = camera.position;
    const seen = new Set<string>();
    let allies = 0;
    let enemies = 0;
    for (const d of ducks) {
      if (!d.alive) continue;
      const dist = Math.hypot(d.x - viewer.x, d.y - viewer.y, d.z - viewer.z);
      if (dist >= NAMETAG.range) continue;
      const head = d.y + (d.down ? NAMETAG.labelCrouch - 0.2 : NAMETAG.labelStand + (NAMETAG.labelCrouch - NAMETAG.labelStand) * d.crouch);
      _v.set(d.x, head, d.z);
      _v.project(camera);
      if (_v.z > 1 || _v.z < -1 || Math.abs(_v.x) > 1 || Math.abs(_v.y) > 1) continue;
      if (!d.ally) {
        const chest = d.y + (d.down ? 0.5 : 1.0 - 0.3 * d.crouch);
        // Test the duck itself, not the floating label above its head.
        const crouch = d.down ? 1 : d.crouch;
        const stand = HITBOX.stand.headY + HITBOX.stand.headR * 0.75;
        const low = HITBOX.crouch.headY + HITBOX.crouch.headR * 0.75;
        const eye = d.y + stand + (low - stand) * crouch;
        if (!this.clear(cam, d.x, chest, d.z) && !this.clear(cam, d.x, eye, d.z)) continue;
      }
      const t = this.tag(d.id);
      const kind = d.ally ? 'ally' : 'enemy';
      const key = `${d.name}|${kind}|${d.down ? 1 : 0}`;
      if (key !== t.key) {
        t.key = key;
        t.root.className = `nt ${kind}${d.down ? ' down' : ''}`;
        t.name.textContent = d.name;
        t.meta.textContent = d.down ? translate('knocked') : '';
        t.meta.hidden = t.meta.textContent === '';
      }
      const px = Math.round((_v.x * 0.5 + 0.5) * w);
      const py = Math.round((-_v.y * 0.5 + 0.5) * h);
      const fade = Math.max(0, (dist - NAMETAG.fadeStart) / (NAMETAG.range - NAMETAG.fadeStart));
      t.root.style.opacity = String(NAMETAG.maxOpacity * (1 - fade));
      t.root.style.transform = `translate3d(${px}px, ${py}px, 0) translate(-50%, -100%)`;
      if (!t.shown) {
        t.shown = true;
        t.root.hidden = false;
      }
      seen.add(d.id);
      if (d.ally) allies++;
      else enemies++;
    }
    for (const [id, t] of this.tags) {
      if (seen.has(id) || !t.shown) continue;
      t.shown = false;
      t.root.hidden = true;
    }
    for (const id of [...this.tags.keys()]) if (!ducks.some((d) => d.id === id)) this.drop(id);
    this.stats.allyTags = allies;
    this.stats.enemyTags = enemies;
  }

  /** A clear line through opaque geometry from the camera to that point (the same groups as the server's culling). */
  private clear(cam: THREE.Vector3, x: number, y: number, z: number): boolean {
    const s = this.sim;
    const dist = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
    if (dist < 0.001) return true;
    const dir = { x: (x - cam.x) / dist, y: (y - cam.y) / dist, z: (z - cam.z) / dist };
    const hit = s.world.castRay(new s.rapier.Ray({ x: cam.x, y: cam.y, z: cam.z }, dir), dist, true, undefined, OPAQUE_QUERY_GROUPS);
    return !hit;
  }

  private tag(id: string): TagEl {
    let t = this.tags.get(id);
    if (t) return t;
    const root = document.createElement('div');
    root.className = 'nt';
    root.hidden = true;
    const mark = document.createElement('span');
    mark.className = 'nt-mark';
    const name = document.createElement('span');
    name.className = 'nt-name';
    const meta = document.createElement('span');
    meta.className = 'nt-meta';
    root.append(mark, name, meta);
    this.layer.appendChild(root);
    t = { root, name, meta, key: '', shown: false };
    this.tags.set(id, t);
    return t;
  }

  private drop(id: string): void {
    this.tags.get(id)?.root.remove();
    this.tags.delete(id);
  }

  dispose(): void {
    this.layer.remove();
    this.tags.clear();
  }
}
