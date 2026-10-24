/**
 * Instanced map props with chunk culling and per-instance LOD.
 *
 * One InstancedMesh per prop type per LOD level (draw calls stay near the
 * number of prop types on screen). The instance lists are refilled from the
 * visible chunks whenever the camera moves or turns: chunks outside the
 * frustum or past every cull distance are skipped whole, then each instance
 * picks its LOD by camera distance (manifest `lods[].until`, scaled by the
 * quality preset) and is frustum tested on its bounding sphere.
 */
import * as THREE from 'three/webgpu';
import type { PropInstance } from '@qwakk/shared';
import { envMaterial, loadPropGlb, nodeGeometry, paletteOf, PROPS_BASE } from './gltf.ts';

interface ManifestProp {
  file?: string;
  bounds?: { min: number[]; max: number[] };
  lods?: { node: string; until: number; triangles: number }[];
  cullDistance?: number;
  outline?: boolean;
}

interface Manifest {
  props: Record<string, ManifestProp>;
}

interface Lod {
  until: number;
  triangles: number;
  mesh: THREE.InstancedMesh;
  outline: THREE.InstancedMesh | null;
  count: number;
}

interface PropType {
  name: string;
  lods: Lod[];
  cull: number;
  /** Instance indices (into the flat arrays) per chunk. */
  perChunk: Map<number, number[]>;
}

/** Culling grid: 8 x 8 chunks of 105 m (finer than the file's 4 x 4 so culling bites). */
const GRID = 8;
const OUTLINE_PX = 0.016;
const OUTLINE_COLOR = 0x151619;

export interface PropsStats {
  drawCalls: number;
  triangles: number;
  instances: number;
}

export class SainteProps {
  readonly group = new THREE.Group();
  private readonly types: PropType[] = [];
  private mats = new Float32Array(0);
  /** Per instance: bounding sphere center x, y, z, radius. */
  private spheres = new Float32Array(0);
  private readonly chunkBoxes: THREE.Box3[] = [];
  private readonly chunkTypes: number[][] = [];
  private readonly lodScale: number;
  private readonly frustum = new THREE.Frustum();
  private readonly projView = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private readonly lastPos = new THREE.Vector3(1e9, 0, 0);
  private readonly lastQuat = new THREE.Quaternion();
  private framesSince = 0;
  private maxCull = 0;
  readonly stats: PropsStats = { drawCalls: 0, triangles: 0, instances: 0 };

  private constructor(lodScale: number) {
    this.lodScale = lodScale;
    this.group.name = 'props';
  }

  /**
   * `extraManifests`: more manifests next to the kit's (a map's own props, such as
   * Duck Plaza's plaza_manifest.json, named by its map_v1.json `propManifests`).
   */
  static async create(props: readonly PropInstance[], half: number, quality: 'high' | 'low', extraManifests: readonly string[] = []): Promise<SainteProps> {
    const self = new SainteProps(quality === 'low' ? 0.6 : 1);
    const manifest = (await (await fetch(`${PROPS_BASE}manifest.json`)).json()) as Manifest;
    for (const name of extraManifests) {
      if (!/^[a-z0-9_-]+\.json$/.test(name)) continue;
      const extra = (await (await fetch(`${PROPS_BASE}${name}`)).json()) as Manifest;
      manifest.props = { ...extra.props, ...manifest.props };
    }
    await self.build(props, half, manifest);
    return self;
  }

  private async build(props: readonly PropInstance[], half: number, manifest: Manifest): Promise<void> {
    const byType = new Map<string, number[]>();
    props.forEach((p, i) => {
      let l = byType.get(p.prop);
      if (!l) byType.set(p.prop, (l = []));
      l.push(i);
    });
    const names = [...byType.keys()].filter((n) => manifest.props[n]);
    const glbs = await Promise.all(names.map((n) => loadPropGlb(n).catch(() => null)));

    this.mats = new Float32Array(props.length * 16);
    this.spheres = new Float32Array(props.length * 4);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const v = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let g = 0; g < GRID * GRID; g++) {
      this.chunkBoxes.push(new THREE.Box3());
      this.chunkTypes.push([]);
    }
    const cell = (2 * half) / GRID;
    const chunkOf = (x: number, z: number) => {
      const cx = Math.min(GRID - 1, Math.max(0, Math.floor((x + half) / cell)));
      const cz = Math.min(GRID - 1, Math.max(0, Math.floor((z + half) / cell)));
      return cz * GRID + cx;
    };

    let palette: THREE.Texture | null = null;
    for (const g of glbs) if (g && !palette) palette = paletteOf(g);
    const material = envMaterial({ key: 'props', map: palette, side: THREE.DoubleSide });
    const outlineMat = new THREE.MeshBasicNodeMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });

    names.forEach((name, ti) => {
      const gltf = glbs[ti];
      const info = manifest.props[name] as ManifestProp;
      const ids = byType.get(name) as number[];
      if (!gltf) return;
      const bmin = info.bounds?.min ?? [-1, 0, -1];
      const bmax = info.bounds?.max ?? [1, 2, 1];
      const cy = ((bmin[1] ?? 0) + (bmax[1] ?? 2)) / 2;
      const r0 = 0.5 * Math.hypot((bmax[0] ?? 1) - (bmin[0] ?? -1), (bmax[1] ?? 2) - (bmin[1] ?? 0), (bmax[2] ?? 1) - (bmin[2] ?? -1));
      const off = Math.hypot(((bmin[0] ?? 0) + (bmax[0] ?? 0)) / 2, ((bmin[2] ?? 0) + (bmax[2] ?? 0)) / 2);
      const lodsInfo = info.lods && info.lods.length > 0 ? info.lods : [{ node: 'LOD0', until: info.cullDistance ?? 300, triangles: 0 }];
      const type: PropType = { name, lods: [], cull: (info.cullDistance ?? lodsInfo[lodsInfo.length - 1]?.until ?? 300) * this.lodScale, perChunk: new Map() };
      for (const l of lodsInfo) {
        const geo = nodeGeometry(gltf, l.node);
        if (!geo) continue;
        geo.computeBoundingSphere();
        const mesh = new THREE.InstancedMesh(geo, material, ids.length);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.count = 0;
        mesh.visible = false;
        mesh.name = `prop:${name}:${l.node}`;
        this.group.add(mesh);
        let outline: THREE.InstancedMesh | null = null;
        if (info.outline) {
          const og = geo.clone();
          og.computeBoundingBox();
          const box = og.boundingBox as THREE.Box3;
          const c = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          og.translate(-c.x, -c.y, -c.z);
          og.scale(1 + (2 * OUTLINE_PX) / Math.max(0.05, size.x), 1 + (2 * OUTLINE_PX) / Math.max(0.05, size.y), 1 + (2 * OUTLINE_PX) / Math.max(0.05, size.z));
          og.translate(c.x, c.y, c.z);
          outline = new THREE.InstancedMesh(og, outlineMat, ids.length);
          // Same instance buffer as the prop itself: one upload serves both.
          outline.instanceMatrix = mesh.instanceMatrix;
          outline.frustumCulled = false;
          outline.count = 0;
          outline.visible = false;
          outline.name = `prop-outline:${name}:${l.node}`;
          this.group.add(outline);
        }
        type.lods.push({ until: l.until * this.lodScale, triangles: l.triangles || (geo.index ? geo.index.count / 3 : geo.getAttribute('position').count / 3), mesh, outline, count: 0 });
      }
      if (type.lods.length === 0) return;
      // The last LOD lasts until the cull distance.
      (type.lods[type.lods.length - 1] as Lod).until = Math.max((type.lods[type.lods.length - 1] as Lod).until, type.cull);
      this.maxCull = Math.max(this.maxCull, type.cull);
      const typeIndex = this.types.length;
      this.types.push(type);
      for (const i of ids) {
        const p = props[i] as PropInstance;
        q.setFromAxisAngle(up, p.rotY);
        s.setScalar(p.scale);
        m.compose(v.set(p.x, p.y, p.z), q, s);
        m.toArray(this.mats, i * 16);
        const k = i * 4;
        this.spheres[k] = p.x;
        this.spheres[k + 1] = p.y + cy * p.scale;
        this.spheres[k + 2] = p.z;
        this.spheres[k + 3] = (r0 + off) * p.scale;
        const ch = chunkOf(p.x, p.z);
        let list = type.perChunk.get(ch);
        if (!list) {
          type.perChunk.set(ch, (list = []));
          (this.chunkTypes[ch] as number[]).push(typeIndex);
        }
        list.push(i);
        const r = this.spheres[k + 3] as number;
        (this.chunkBoxes[ch] as THREE.Box3).expandByPoint(v.set(p.x - r, this.spheres[k + 1]! - r, p.z - r)).expandByPoint(v.set(p.x + r, this.spheres[k + 1]! + r, p.z + r));
      }
    });
  }

  /** Refill the instance lists for this camera (cheap no-op when the camera did not move). */
  update(camera: THREE.PerspectiveCamera): void {
    this.framesSince++;
    const moved = camera.position.distanceToSquared(this.lastPos) > 0.25;
    const turned = Math.abs(camera.quaternion.dot(this.lastQuat)) < 0.99998;
    if (!moved && !turned && this.framesSince < 30) return;
    this.framesSince = 0;
    this.lastPos.copy(camera.position);
    this.lastQuat.copy(camera.quaternion);
    camera.updateMatrixWorld();
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView, camera.coordinateSystem);

    for (const t of this.types) for (const l of t.lods) l.count = 0;
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    const sp = this.spheres;
    const mats = this.mats;
    const maxCull2 = this.maxCull * this.maxCull;
    for (let ch = 0; ch < this.chunkBoxes.length; ch++) {
      const box = this.chunkBoxes[ch] as THREE.Box3;
      if (box.isEmpty()) continue;
      if (box.distanceToPoint(camera.position) ** 2 > maxCull2) continue;
      if (!this.frustum.intersectsBox(box)) continue;
      for (const ti of this.chunkTypes[ch] as number[]) {
        const t = this.types[ti] as PropType;
        const ids = t.perChunk.get(ch) as number[];
        const cull2 = t.cull * t.cull;
        for (const i of ids) {
          const k = i * 4;
          const dx = (sp[k] as number) - cx;
          const dy = (sp[k + 1] as number) - cy;
          const dz = (sp[k + 2] as number) - cz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > cull2) continue;
          this.sphere.center.set(sp[k] as number, sp[k + 1] as number, sp[k + 2] as number);
          this.sphere.radius = sp[k + 3] as number;
          if (!this.frustum.intersectsSphere(this.sphere)) continue;
          const d = Math.sqrt(d2);
          let lod = t.lods[t.lods.length - 1] as Lod;
          for (const l of t.lods) {
            if (d <= l.until) {
              lod = l;
              break;
            }
          }
          const arr = lod.mesh.instanceMatrix.array as Float32Array;
          arr.set(mats.subarray(i * 16, i * 16 + 16), lod.count * 16);
          lod.count++;
        }
      }
    }
    let calls = 0;
    let tris = 0;
    let inst = 0;
    for (const t of this.types) {
      for (const l of t.lods) {
        const im = l.mesh.instanceMatrix;
        l.mesh.count = l.count;
        l.mesh.visible = l.count > 0;
        if (l.count > 0) {
          im.clearUpdateRanges();
          im.addUpdateRange(0, l.count * 16);
          im.needsUpdate = true;
          calls++;
          tris += l.count * l.triangles;
          inst += l.count;
        }
        if (l.outline) {
          l.outline.count = l.count;
          l.outline.visible = l.count > 0;
          if (l.count > 0) calls++;
        }
      }
    }
    this.stats.drawCalls = calls;
    this.stats.triangles = tris;
    this.stats.instances = inst;
  }

  /** Show one instance of every LOD mesh (or restore the culled lists), for shader and buffer warm-up. */
  showAllForWarmup(on: boolean): void {
    for (const t of this.types) {
      for (const l of t.lods) {
        if (on) (l.mesh.instanceMatrix.array as Float32Array).set(this.mats.subarray(0, 16), 0);
        const n = on ? Math.max(1, l.count) : l.count;
        l.mesh.count = n;
        l.mesh.visible = n > 0;
        l.mesh.instanceMatrix.needsUpdate = true;
        if (l.outline) {
          l.outline.count = n;
          l.outline.visible = n > 0;
        }
      }
    }
    if (!on) this.lastPos.set(1e9, 0, 0); // force a refill on the next update
  }

  dispose(): void {
    for (const t of this.types) {
      for (const l of t.lods) {
        l.mesh.geometry.dispose();
        l.outline?.geometry.dispose();
        l.mesh.dispose();
      }
    }
    this.group.removeFromParent();
  }
}
