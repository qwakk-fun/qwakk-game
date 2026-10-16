/**
 * Openable loot crates: the map's small crates, large crates and ammo boxes
 * (drawn here in place of their static props, which keep their colliders),
 * plus dead ducks' crates. Each crate is a body and a lid, instanced per
 * variant (body, lid and their outline hulls), with the lid swung around its
 * hinge by the open state the server sends (closed until a viewer is told
 * otherwise). Models: `models/crates/crates.glb` from
 * art/map/blender/crates_open.py, with a code greybox until it loads.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toonMaterial } from '../../render/materials.ts';
import { BRAND } from '../../render/palette.ts';
import { envMaterial, mergeSimple, paletteOf } from './gltf.ts';

export const CrateVariant = { Small: 0, Large: 1, Ammo: 2 } as const;

/** Prop names of the map's loot containers, by variant. */
export const CRATE_PROPS: Record<string, number> = { crate_small: CrateVariant.Small, crate_large: CrateVariant.Large, ammo_box: CrateVariant.Ammo };

export interface CrateSpot {
  key: string;
  variant: number;
  /** Base (on the ground) and facing, as the map prop. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

/** Per variant: outer size, body height (lid on top), the straw bed's height and how big loot looks inside. */
const DIMS = [
  { sx: 0.75, sy: 0.75, h: 0.63, lid: 0.07, bed: 0.4, itemScale: 0.62, cols: 2 },
  { sx: 1.45, sy: 0.85, h: 0.78, lid: 0.07, bed: 0.49, itemScale: 0.85, cols: 3 },
  { sx: 0.5, sy: 0.22, h: 0.25, lid: 0.05, bed: 0.145, itemScale: 0.45, cols: 2 },
] as const;

/** Lid angle when open (rad, past upright so it rests back) and the swing time (s). */
const OPEN_ANGLE = 1.95;
const SWING_S = 0.5;
const DRAW_DIST = 130;
const OUTLINE_PX = 0.016;
const OUTLINE_COLOR = 0x151619;

interface Crate extends CrateSpot {
  open: boolean;
  /** Lid angle now and the swing clock (-1: at rest). */
  angle: number;
  t: number;
}

interface Part {
  mesh: THREE.InstancedMesh;
  outline: THREE.InstancedMesh;
}

interface Variant {
  body: Part;
  lid: Part;
  /** Hinge position in crate space (glTF axes: +z front, the hinge at the back top edge). */
  hinge: THREE.Vector3;
}

const easeOutBack = (t: number): number => {
  const c1 = 1.5;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

function paint(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

const boxAt = (w: number, h: number, d: number, color: number, x: number, y: number, z: number) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);

/** Greybox body and lid (lid in hinge space, reaching toward +z) until the GLB loads. */
function greybox(v: number): { body: THREE.BufferGeometry; lid: THREE.BufferGeometry; hinge: THREE.Vector3 } {
  const d = DIMS[v] as (typeof DIMS)[number];
  const wood = v === CrateVariant.Ammo ? 0x6b6c3c : 0xb89068;
  const dark = v === CrateVariant.Ammo ? 0x50522d : 0x6b4f38;
  const t = 0.05;
  const body = mergeSimple([
    boxAt(d.sx, d.h, t, wood, 0, d.h / 2, d.sy / 2 - t / 2),
    boxAt(d.sx, d.h, t, wood, 0, d.h / 2, -d.sy / 2 + t / 2),
    boxAt(t, d.h, d.sy, wood, d.sx / 2 - t / 2, d.h / 2, 0),
    boxAt(t, d.h, d.sy, wood, -d.sx / 2 + t / 2, d.h / 2, 0),
    boxAt(d.sx - 2 * t, 0.04, d.sy - 2 * t, 0xe2c46a, 0, d.bed - 0.02, 0),
    boxAt(d.sx * 0.4, d.h * 0.4, 0.01, BRAND.yellow, 0, d.h / 2, d.sy / 2 + 0.005),
  ]);
  const lid = mergeSimple([boxAt(d.sx + 0.02, d.lid, d.sy + 0.02, dark, 0, d.lid / 2, (d.sy + 0.02) / 2), boxAt(d.sx * 0.3, 0.01, d.sy * 0.3, BRAND.yellow, 0, d.lid + 0.005, d.sy / 2)]);
  body.computeVertexNormals();
  lid.computeVertexNormals();
  return { body, lid, hinge: new THREE.Vector3(0, d.h, -d.sy / 2 - 0.01) };
}

function outlineGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const og = geo.clone();
  og.computeBoundingBox();
  const box = og.boundingBox as THREE.Box3;
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  og.translate(-c.x, -c.y, -c.z);
  og.scale(1 + (2 * OUTLINE_PX) / Math.max(0.05, size.x), 1 + (2 * OUTLINE_PX) / Math.max(0.05, size.y), 1 + (2 * OUTLINE_PX) / Math.max(0.05, size.z));
  og.translate(c.x, c.y, c.z);
  return og;
}

export class CratesView {
  readonly group = new THREE.Group();
  private readonly crates = new Map<string, Crate>();
  private readonly variants: Variant[] = [];
  private readonly outlineMat = new THREE.MeshBasicNodeMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });
  private readonly drawDist: number;
  private readonly m = new THREE.Matrix4();
  private readonly lidM = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly frustum = new THREE.Frustum();
  private readonly projView = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private readonly lastPos = new THREE.Vector3(1e9, 0, 0);
  private readonly lastQuat = new THREE.Quaternion();
  private dirty = true;
  private swinging = 0;
  /** Draw calls last frame (stats). */
  drawCalls = 0;

  constructor(spots: readonly CrateSpot[], quality: 'high' | 'low') {
    this.group.name = 'crates';
    this.drawDist = DRAW_DIST * (quality === 'low' ? 0.6 : 1);
    for (const s of spots) this.crates.set(s.key, { ...s, open: false, angle: 0, t: -1 });
    const cap = Math.max(16, spots.length + 32);
    const mat = toonMaterial(0xffffff, { vertexColors: true });
    for (let v = 0; v < DIMS.length; v++) {
      const g = greybox(v);
      this.variants.push({ body: this.part(g.body, mat, cap, `crate-body-${v}`), lid: this.part(g.lid, mat, cap, `crate-lid-${v}`), hinge: g.hinge });
    }
  }

  private part(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, name: string): Part {
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.count = 0;
    mesh.name = name;
    const outline = new THREE.InstancedMesh(outlineGeometry(geo), this.outlineMat, cap);
    outline.instanceMatrix = mesh.instanceMatrix;
    outline.frustumCulled = false;
    outline.count = 0;
    outline.name = `${name}-outline`;
    this.group.add(mesh, outline);
    return { mesh, outline };
  }

  private swap(part: Part, geo: THREE.BufferGeometry, mat: THREE.Material): void {
    const old = part.mesh.geometry;
    part.mesh.geometry = geo;
    part.mesh.material = mat;
    part.outline.geometry.dispose();
    part.outline.geometry = outlineGeometry(geo);
    old.dispose();
  }

  /** Swap the greybox for the art (keeps the greybox if the file is missing). */
  async load(url: string): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url).catch(() => null);
    if (!gltf) return;
    const mat = envMaterial({ key: 'crates', map: paletteOf(gltf) });
    gltf.scene.updateMatrixWorld(true);
    const names = ['small', 'large', 'ammo'];
    names.forEach((n, v) => {
      const body = gltf.scene.getObjectByName(`${n}_body`) as THREE.Mesh | undefined;
      const lid = gltf.scene.getObjectByName(`${n}_lid`) as THREE.Mesh | undefined;
      const variant = this.variants[v];
      if (!body?.isMesh || !lid?.isMesh || !variant) return;
      // Body in crate space; lid in hinge space (its node's local transform is the hinge).
      const bodyGeo = body.geometry.clone().applyMatrix4(body.matrixWorld);
      const lidGeo = lid.geometry.clone();
      variant.hinge.copy(lid.position).applyMatrix4(body.matrixWorld);
      this.swap(variant.body, bodyGeo, mat);
      this.swap(variant.lid, lidGeo, mat);
    });
    this.dirty = true;
  }

  /** A crate the map does not place (a dead duck's), drawn open. */
  addDynamic(key: string, variant: number, x: number, y: number, z: number, yaw: number): void {
    if (this.crates.has(key)) return;
    this.crates.set(key, { key, variant, x, y, z, yaw, scale: 1, open: true, angle: OPEN_ANGLE, t: -1 });
    this.dirty = true;
  }

  removeDynamic(key: string): void {
    if (this.crates.delete(key)) this.dirty = true;
  }

  has(key: string): boolean {
    return this.crates.has(key);
  }

  isOpen(key: string): boolean {
    return this.crates.get(key)?.open ?? false;
  }

  /** Open or close a crate: swing the lid when `animate`, else snap. */
  setOpen(key: string, open: boolean, animate: boolean): void {
    const c = this.crates.get(key);
    if (!c || c.open === open) return;
    c.open = open;
    if (open && animate) {
      if (c.t < 0) this.swinging++;
      c.t = 0;
    } else {
      if (c.t >= 0) this.swinging--;
      c.t = -1;
      c.angle = open ? OPEN_ANGLE : 0;
    }
    this.dirty = true;
  }

  /** Where the i-th of n items rests inside the crate (on its straw bed), facing with it. */
  slot(key: string, i: number, n: number): { x: number; y: number; z: number; yaw: number; scale: number } | null {
    const c = this.crates.get(key);
    if (!c) return null;
    const d = DIMS[c.variant] as (typeof DIMS)[number];
    const cols = Math.min(d.cols, Math.max(1, n));
    const rows = Math.ceil(n / cols);
    const col = i % cols;
    const row = Math.floor(i / cols);
    const lx = ((col + 0.5) / cols - 0.5) * (d.sx - 0.2) * c.scale;
    const lz = rows > 1 ? ((row + 0.5) / rows - 0.5) * (d.sy - 0.2) * c.scale : 0;
    const cs = Math.cos(c.yaw);
    const sn = Math.sin(c.yaw);
    return { x: c.x + lx * cs + lz * sn, y: c.y + d.bed * c.scale + 0.01, z: c.z - lx * sn + lz * cs, yaw: c.yaw + (i % 2 === 0 ? 0.2 : -0.25), scale: d.itemScale * c.scale };
  }

  update(dt: number, camera: THREE.PerspectiveCamera): void {
    if (this.swinging > 0) {
      for (const c of this.crates.values()) {
        if (c.t < 0) continue;
        c.t += dt / SWING_S;
        if (c.t >= 1) {
          c.t = -1;
          c.angle = OPEN_ANGLE;
          this.swinging--;
        } else c.angle = OPEN_ANGLE * easeOutBack(c.t);
      }
      this.dirty = true;
    }
    const moved = camera.position.distanceToSquared(this.lastPos) > 0.25;
    const turned = Math.abs(camera.quaternion.dot(this.lastQuat)) < 0.99998;
    if (!moved && !turned && !this.dirty) return;
    this.dirty = false;
    this.lastPos.copy(camera.position);
    this.lastQuat.copy(camera.quaternion);
    camera.updateMatrixWorld();
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView, camera.coordinateSystem);
    const counts = this.variants.map(() => 0);
    const d2 = this.drawDist * this.drawDist;
    for (const c of this.crates.values()) {
      const dx = c.x - camera.position.x;
      const dz = c.z - camera.position.z;
      if (dx * dx + dz * dz > d2) continue;
      const d = DIMS[c.variant] as (typeof DIMS)[number];
      this.sphere.center.set(c.x, c.y + d.h * 0.5, c.z);
      this.sphere.radius = (Math.max(d.sx, d.sy) + d.h) * c.scale;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const v = this.variants[c.variant];
      if (!v) continue;
      const n = counts[c.variant] as number;
      if (n >= v.body.mesh.instanceMatrix.count) continue;
      this.q.setFromAxisAngle(this.up, c.yaw);
      this.m.compose(this.p.set(c.x, c.y, c.z), this.q, this.s.setScalar(c.scale));
      v.body.mesh.setMatrixAt(n, this.m);
      // Lid: crate space, then the hinge, then the swing (front edge up and back).
      this.lidM.makeRotationX(-c.angle).setPosition(v.hinge);
      this.lidM.premultiply(this.m);
      v.lid.mesh.setMatrixAt(n, this.lidM);
      counts[c.variant] = n + 1;
    }
    let calls = 0;
    this.variants.forEach((v, i) => {
      const n = counts[i] as number;
      for (const part of [v.body, v.lid]) {
        part.mesh.count = n;
        part.outline.count = n;
        part.mesh.visible = n > 0;
        part.outline.visible = n > 0;
        if (n > 0) {
          part.mesh.instanceMatrix.clearUpdateRanges();
          part.mesh.instanceMatrix.addUpdateRange(0, n * 16);
          part.mesh.instanceMatrix.needsUpdate = true;
          calls += 2;
        }
      }
    });
    this.drawCalls = calls;
  }

  /** Show one of each part for shader warm-up (or restore the culled lists). */
  showAllForWarmup(on: boolean): void {
    for (const v of this.variants) {
      for (const part of [v.body, v.lid]) {
        if (on) part.mesh.setMatrixAt(0, this.m.identity());
        const n = on ? Math.max(1, part.mesh.count) : part.mesh.count;
        part.mesh.count = n;
        part.outline.count = n;
        part.mesh.visible = n > 0;
        part.outline.visible = n > 0;
        part.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    if (!on) this.dirty = true;
  }

  dispose(): void {
    for (const v of this.variants) {
      for (const part of [v.body, v.lid]) {
        part.mesh.geometry.dispose();
        part.outline.geometry.dispose();
        part.mesh.dispose();
      }
    }
    this.group.removeFromParent();
  }
}
