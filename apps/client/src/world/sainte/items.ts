/**
 * World pickups (server-owned items, drawn here): one InstancedMesh per item
 * kind plus one for the soft yellow glow discs under them, so loot reads from
 * a distance. Items bob and turn slowly; the item the pickup prompt targets
 * gets a pulsing ring and grows a little. Items inside an open crate lie
 * still (no bob, no glow); crates themselves are drawn by crates.ts and are
 * only markers here (the ring when the prompt targets one).
 */
import * as THREE from 'three/webgpu';
import { Item } from '@qwakk/shared';
import { toonMaterial } from '../../render/materials.ts';
import { BRAND } from '../../render/palette.ts';
import { itemGeometry } from './itemMeshes.ts';

/** How an entry is drawn: a loose item (bobs, turns, glows), an item lying still in a crate, or a marker (the prompt ring only). */
export interface ItemLook {
  still?: { yaw: number; scale: number };
  marker?: boolean;
  /** Ring size for a marker. */
  ring?: number;
}

interface Entry {
  kind: number;
  x: number;
  y: number;
  z: number;
  phase: number;
  look: ItemLook | null;
}

interface KindMesh {
  mesh: THREE.InstancedMesh;
  cap: number;
}

const KINDS = [Item.Rifle, Item.Pistol, Item.RifleAmmo, Item.PistolAmmo, Item.Vest1, Item.Vest2, Item.Helmet1, Item.Helmet2, Item.Bandage, Item.Medkit, Item.Backpack1, Item.Backpack2, Item.Backpack3];
/** Items farther than this are not drawn (the server only sends nearby items anyway). */
const DRAW_DIST = 160;
const HOVER = 0.12;

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,212,59,0.85)');
  grad.addColorStop(0.45, 'rgba(255,212,59,0.35)');
  grad.addColorStop(1, 'rgba(255,212,59,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class ItemsView {
  readonly group = new THREE.Group();
  private readonly items = new Map<string, Entry>();
  private readonly meshes = new Map<number, KindMesh>();
  private readonly glow: THREE.InstancedMesh;
  /** More nearby items than this simply go without a glow. */
  private readonly glowCap = 1024;
  private readonly ring: THREE.Mesh;
  private highlighted: string | null = null;
  private t = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

  constructor(scene: THREE.Scene) {
    this.group.name = 'items';
    scene.add(this.group);
    const mat = toonMaterial(0xffffff, { vertexColors: true });
    for (const k of KINDS) this.meshes.set(k, this.makeKind(itemGeometry(k), mat, 64));
    const glowMat = new THREE.MeshBasicNodeMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.glow = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.3, 1.3), glowMat, this.glowCap);
    this.glow.frustumCulled = false;
    this.glow.count = 0;
    this.glow.renderOrder = 3;
    this.group.add(this.glow);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.035, 6, 32), new THREE.MeshBasicNodeMaterial({ color: BRAND.yellow }));
    this.ring.rotation.x = Math.PI / 2;
    this.ring.visible = false;
    this.group.add(this.ring);
  }

  private makeKind(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number): KindMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.count = 0;
    mesh.visible = false;
    this.group.add(mesh);
    return { mesh, cap };
  }

  upsert(id: string, kind: number, x: number, y: number, z: number, look: ItemLook | null = null): void {
    const e = this.items.get(id);
    if (e) {
      e.kind = kind;
      e.x = x;
      e.y = y;
      e.z = z;
      e.look = look;
      return;
    }
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    this.items.set(id, { kind, x, y, z, phase: (h & 1023) / 163, look });
  }

  remove(id: string): void {
    this.items.delete(id);
    if (this.highlighted === id) this.highlighted = null;
  }

  clear(): void {
    this.items.clear();
    this.highlighted = null;
  }

  highlight(id: string | null): void {
    this.highlighted = id;
  }

  get size(): number {
    return this.items.size;
  }

  update(dt: number, camera: THREE.Camera): void {
    this.t += dt;
    const counts = new Map<number, number>();
    let glows = 0;
    const cx = camera.position.x;
    const cz = camera.position.z;
    const d2max = DRAW_DIST * DRAW_DIST;
    this.ring.visible = false;
    for (const [id, e] of this.items) {
      const dx = e.x - cx;
      const dz = e.z - cz;
      if (dx * dx + dz * dz > d2max) continue;
      const hot = id === this.highlighted;
      if (hot) {
        this.ring.visible = true;
        this.ring.position.set(e.x, e.y + 0.06, e.z);
        const pulse = 1 + Math.sin(this.t * 6) * 0.08;
        this.ring.scale.setScalar((e.look?.ring ?? 1) * pulse);
      }
      if (e.look?.marker) continue;
      let km = this.meshes.get(e.kind);
      if (!km) continue;
      const n = counts.get(e.kind) ?? 0;
      if (n >= km.cap) km = this.grow(e.kind, km);
      const still = e.look?.still;
      if (still) {
        this.q.setFromAxisAngle(this.up, still.yaw);
        this.m.compose(this.p.set(e.x, e.y, e.z), this.q, this.s.setScalar(still.scale));
      } else {
        const bob = Math.sin(this.t * 2.2 + e.phase) * 0.04;
        this.q.setFromAxisAngle(this.up, this.t * 0.6 + e.phase);
        this.m.compose(this.p.set(e.x, e.y + HOVER + bob, e.z), this.q, this.s.setScalar(hot ? 1.22 : 1));
      }
      km.mesh.setMatrixAt(n, this.m);
      counts.set(e.kind, n + 1);
      if (!still && glows < this.glowCap) {
        this.m.compose(this.p.set(e.x, e.y + 0.03, e.z), this.flat, this.s.setScalar(1));
        this.glow.setMatrixAt(glows++, this.m);
      }
    }
    for (const [kind, km] of this.meshes) {
      const n = counts.get(kind) ?? 0;
      km.mesh.count = n;
      km.mesh.visible = n > 0;
      if (n > 0) {
        km.mesh.instanceMatrix.clearUpdateRanges();
        km.mesh.instanceMatrix.addUpdateRange(0, n * 16);
        km.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    this.glow.count = glows;
    this.glow.visible = glows > 0;
    if (glows > 0) {
      this.glow.instanceMatrix.clearUpdateRanges();
      this.glow.instanceMatrix.addUpdateRange(0, glows * 16);
      this.glow.instanceMatrix.needsUpdate = true;
    }
  }

  private grow(kind: number, km: KindMesh): KindMesh {
    const next = this.makeKind(km.mesh.geometry, km.mesh.material as THREE.Material, km.cap * 2);
    (next.mesh.instanceMatrix.array as Float32Array).set(km.mesh.instanceMatrix.array as Float32Array);
    this.group.remove(km.mesh);
    km.mesh.dispose();
    this.meshes.set(kind, next);
    return next;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const km of this.meshes.values()) km.mesh.dispose();
    this.glow.dispose();
  }
}
