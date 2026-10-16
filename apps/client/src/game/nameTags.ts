/**
 * Name tags over ducks, as a DOM layer over the canvas:
 *
 * - Allies (teammates, party allies in a deathmatch): always, in green, with a
 *   marker that shows through walls (the server sends allies' poses whatever
 *   is in between), the distance when far, and a knocked badge.
 * - Enemies: only the one under the crosshair, within NAMETAG.enemyRange,
 *   whose pose the server sent (it passed the anti-wallhack culling) AND that
 *   this client can see right now along a clear line from the camera (the
 *   culling keeps close or just-hidden ducks for a moment; a tag must not
 *   reveal them). It lingers NAMETAG.enemyHoldMs after the crosshair leaves.
 */
import * as THREE from 'three/webgpu';
import { NAMETAG, OPAQUE_QUERY_GROUPS, type SimWorld } from '@qwakk/shared';

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

const HEAD_STAND = 1.95;
const HEAD_CROUCH = 1.5;
const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();

export class NameTags {
  private readonly layer: HTMLElement;
  private readonly sim: SimWorld;
  private readonly tags = new Map<string, TagEl>();
  private enemyId: string | null = null;
  private enemyUntil = 0;
  /** Counters for the test hook. */
  readonly stats = { allyTags: 0, enemyTags: 0, enemyId: '' as string };

  constructor(parent: HTMLElement, sim: SimWorld) {
    this.sim = sim;
    this.layer = document.createElement('div');
    this.layer.className = 'nt-layer';
    parent.appendChild(this.layer);
  }

  /** Once per frame, after the ducks were placed. */
  update(camera: THREE.PerspectiveCamera, ducks: readonly TagDuck[], now: number): void {
    const w = this.layer.clientWidth || window.innerWidth;
    const h = this.layer.clientHeight || window.innerHeight;
    camera.getWorldDirection(_fwd);
    const cam = camera.position;
    const enemy = this.pickEnemy(cam, ducks, now);
    const seen = new Set<string>();
    let allies = 0;
    for (const d of ducks) {
      const show = d.ally ? d.alive : d.id === enemy;
      if (!show) continue;
      const head = d.y + (d.down ? HEAD_CROUCH - 0.2 : HEAD_STAND + (HEAD_CROUCH - HEAD_STAND) * d.crouch);
      _v.set(d.x, head, d.z);
      const dist = _v.distanceTo(cam);
      _v.project(camera);
      if (_v.z > 1 || _v.z < -1) continue; // behind the camera
      const t = this.tag(d.id);
      const key = `${d.name}|${d.ally ? 1 : 0}|${d.down ? 1 : 0}|${d.ally && dist > 30 ? Math.round(dist) : 0}`;
      if (key !== t.key) {
        t.key = key;
        t.root.className = `nt${d.ally ? ' ally' : ' enemy'}${d.down ? ' down' : ''}`;
        t.name.textContent = d.name;
        t.meta.textContent = d.down ? 'knocked' : d.ally && dist > 30 ? `${Math.round(dist)} m` : '';
        t.meta.hidden = t.meta.textContent === '';
      }
      const px = Math.round((_v.x * 0.5 + 0.5) * w);
      const py = Math.round((-_v.y * 0.5 + 0.5) * h);
      t.root.style.transform = `translate3d(${px}px, ${py}px, 0) translate(-50%, -100%)`;
      if (!t.shown) {
        t.shown = true;
        t.root.hidden = false;
      }
      seen.add(d.id);
      if (d.ally) allies++;
    }
    for (const [id, t] of this.tags) {
      if (seen.has(id) || !t.shown) continue;
      t.shown = false;
      t.root.hidden = true;
    }
    for (const id of [...this.tags.keys()]) if (!ducks.some((d) => d.id === id)) this.drop(id);
    this.stats.allyTags = allies;
    this.stats.enemyId = enemy ?? '';
    if (enemy) this.stats.enemyTags++;
  }

  /** The enemy whose tag shows: under the crosshair, in range, in clear sight from the camera. */
  private pickEnemy(cam: THREE.Vector3, ducks: readonly TagDuck[], now: number): string | null {
    let best: TagDuck | null = null;
    let bestAngle = Infinity;
    for (const d of ducks) {
      if (d.ally || !d.alive) continue;
      const chest = d.y + (d.down ? 0.5 : 1.0 - 0.3 * d.crouch);
      const dx = d.x - cam.x;
      const dy = chest - cam.y;
      const dz = d.z - cam.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > NAMETAG.enemyRange || dist < 0.5) continue;
      const cos = (dx * _fwd.x + dy * _fwd.y + dz * _fwd.z) / dist;
      const angle = Math.acos(Math.min(1, Math.max(-1, cos)));
      // Close ducks are wide on screen: half a meter around the chest counts as "under the crosshair".
      if (angle > Math.max(NAMETAG.enemyAngle, Math.atan2(0.5, dist))) continue;
      if (angle < bestAngle && this.clear(cam, d.x, chest, d.z, dist)) {
        best = d;
        bestAngle = angle;
      }
    }
    if (best) {
      this.enemyId = best.id;
      this.enemyUntil = now + NAMETAG.enemyHoldMs;
      return best.id;
    }
    // Linger a moment, but only while that duck is still drawn (its pose still arrives).
    if (this.enemyId && now < this.enemyUntil && ducks.some((d) => d.id === this.enemyId && d.alive && !d.ally)) return this.enemyId;
    this.enemyId = null;
    return null;
  }

  /** A clear line through opaque geometry from the camera to that point (the same groups as the server's culling). */
  private clear(cam: THREE.Vector3, x: number, y: number, z: number, dist: number): boolean {
    const s = this.sim;
    const dir = { x: (x - cam.x) / dist, y: (y - cam.y) / dist, z: (z - cam.z) / dist };
    const hit = s.world.castRay(new s.rapier.Ray({ x: cam.x, y: cam.y, z: cam.z }, dir), dist, true, undefined, OPAQUE_QUERY_GROUPS);
    return !hit || hit.timeOfImpact > dist - 0.3;
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
