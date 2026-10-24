/**
 * Pond Keep's moving parts on screen (Hunt Season v2): the main gate in its
 * looks (intact, damaged, broken, then the plank barricade while a broken
 * gate is mended), the drawbridge on its hinge with its chains, the lever,
 * the four bread cannons (turning and tilting to where their duck aims, heat
 * glowing, recoil), and the arc preview of the cannon we man. Everything it
 * shows comes from the room state; our own cannon's aim is predicted from
 * our own input (raid/cannon.ts, the same math the server fires with).
 *
 * Models from the prop kit (art/map, `apps/client/public/models/props/`):
 * `castle_gate` (Intact, Damaged, Broken, Planks), `castle_drawbridge`
 * (Hinge, ChainAnchorL/R, ChainL/R), `castle_lever` (Handle), `bread_cannon`
 * (Yaw, Pitch, Muzzle; +Z shoots). Until they load, or without them,
 * greybox stand-ins take their place.
 */
import * as THREE from 'three/webgpu';
import { BridgeState, breadPath, CANNON, cannonAim, emptyAim, GateState, type KeepGeometry, type PlayerSim, type SimWorld } from '@qwakk/shared';
import type { RaidState } from '@qwakk/shared/net';
import { toonMaterial } from '../../render/materials.ts';
import { envMaterial, loadPropGlb, paletteOf } from '../../world/sainte/gltf.ts';

const HALF_PI = Math.PI / 2;
const ease = (k: number): number => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

/** A prop kit GLB as a scene graph with the environment toon material (null when it is missing). */
async function kitModel(name: string): Promise<THREE.Object3D | null> {
  try {
    const gltf = await loadPropGlb(name);
    const mat = envMaterial({ map: paletteOf(gltf), key: `keep-${name}` });
    const root = gltf.scene.clone(true);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = mat;
        m.castShadow = false;
        m.receiveShadow = false;
      }
    });
    return root;
  } catch {
    return null;
  }
}

interface CannonLook {
  root: THREE.Object3D;
  yaw: THREE.Object3D;
  pitch: THREE.Object3D;
  muzzle: THREE.Object3D;
  glow: THREE.Mesh;
  glowMat: THREE.MeshBasicNodeMaterial;
  recoil: number;
  /** Drawn yaw and pitch (eased toward the state's). */
  y: number;
  p: number;
}

export class KeepView {
  readonly group = new THREE.Group();
  private readonly g: KeepGeometry;
  private readonly sim: SimWorld;
  private gate: THREE.Object3D;
  private gateParts: Record<string, THREE.Object3D | null> = {};
  private bridge: THREE.Object3D;
  private hinge: THREE.Object3D;
  private chains: { chain: THREE.Object3D; anchor: THREE.Object3D }[] = [];
  private lever: THREE.Object3D;
  private handle: THREE.Object3D;
  private readonly cannons: CannonLook[] = [];
  private wasBroken = false;
  private handleAngle = -0.7;
  /** Our cannon's aim preview: dots along the arc and a ring where it lands. */
  private readonly dots: THREE.InstancedMesh;
  private readonly ring: THREE.Mesh;
  private readonly path: { x: number; y: number; z: number }[] = [];
  private readonly aim = emptyAim();
  private readonly m4 = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();
  private previewTick = 0;
  /** Models swapped in once loaded. */
  modelsLoaded = 0;

  constructor(scene: THREE.Scene, sim: SimWorld, g: KeepGeometry) {
    this.sim = sim;
    this.g = g;
    scene.add(this.group);
    // Greybox stand-ins first.
    this.gate = this.greyGate();
    this.bridge = this.greyBridge();
    this.hinge = this.bridge.getObjectByName('Hinge') ?? this.bridge;
    this.lever = this.greyLever();
    this.handle = this.lever.getObjectByName('Handle') ?? this.lever;
    this.group.add(this.gate, this.bridge, this.lever);
    g.cannons.forEach((c) => {
      const look = this.greyCannon();
      look.root.position.set(c.x, c.y, c.z);
      look.root.rotation.y = c.yaw + Math.PI;
      look.y = c.yaw;
      this.group.add(look.root);
      this.cannons.push(look);
    });
    this.placeGate(this.gate);
    this.placeBridge(this.bridge, 0);
    this.placeLever(this.lever);
    // The aim preview.
    const dotMat = new THREE.MeshBasicNodeMaterial({ color: 0xffd43b, transparent: true, opacity: 0.85, depthWrite: false });
    this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 4), dotMat, 48);
    this.dots.count = 0;
    this.dots.frustumCulled = false;
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 28), new THREE.MeshBasicNodeMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.9, depthWrite: false }));
    this.ring.rotation.x = HALF_PI;
    this.ring.visible = false;
    this.group.add(this.dots, this.ring);
    void this.loadModels();
  }

  // ---- placement --------------------------------------------------------------

  private placeGate(o: THREE.Object3D): void {
    const gt = this.g.gate;
    o.position.set(gt.x, gt.y, gt.z);
    o.rotation.y = Math.atan2(gt.nx, gt.nz);
  }

  private placeBridge(o: THREE.Object3D, artLength = 8.4): void {
    const b = this.g.bridge;
    o.position.set(b.x, b.y, b.z);
    o.rotation.y = Math.atan2(b.dx, b.dz);
    // A markup span other than the art's deck stretches it (the greybox is built to length: 0).
    o.scale.z = artLength > 0 ? b.len / artLength : 1;
  }

  private placeLever(o: THREE.Object3D): void {
    const [x, y, z] = this.g.lever;
    o.position.set(x, y, z);
    o.rotation.y = Math.atan2(this.g.gate.x - x, this.g.gate.z - z);
  }

  // ---- greyboxes ------------------------------------------------------------------

  private greyGate(): THREE.Object3D {
    const gt = this.g.gate;
    const root = new THREE.Group();
    const wood = toonMaterial(0x8a5a32);
    const dark = toonMaterial(0x5a3a22);
    const intact = new THREE.Group();
    intact.name = 'Intact';
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(gt.halfW * 2, gt.height, 0.3), wood);
    leaf.position.y = gt.height / 2;
    const wicket = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.2, 0.34), dark);
    wicket.position.y = 1.1;
    intact.add(leaf, wicket);
    const damaged = intact.clone();
    damaged.name = 'Damaged';
    damaged.scale.y = 0.97;
    damaged.rotation.z = 0.03;
    const broken = new THREE.Group();
    broken.name = 'Broken';
    for (const s of [-1, 1]) {
      const stump = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 0.3), wood);
      stump.position.set(s * (gt.halfW - 0.3), 0.6, 0);
      stump.rotation.z = s * 0.25;
      broken.add(stump);
    }
    const planks = new THREE.Group();
    planks.name = 'Planks';
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(gt.halfW * 2, 0.25, 0.12), wood);
      p.position.set(0, 0.8 + i * 1.1, 0.12);
      p.rotation.z = (i - 1) * 0.12;
      planks.add(p);
    }
    root.add(intact, damaged, broken, planks);
    this.gateParts = { Intact: intact, Damaged: damaged, Broken: broken, Planks: planks };
    return root;
  }

  private greyBridge(): THREE.Object3D {
    const b = this.g.bridge;
    const root = new THREE.Group();
    const hinge = new THREE.Group();
    hinge.name = 'Hinge';
    const deck = new THREE.Mesh(new THREE.BoxGeometry(b.halfW * 2, 0.3, b.len), toonMaterial(0x9b6b3d));
    deck.position.set(0, -0.15, b.len / 2);
    hinge.add(deck);
    root.add(hinge);
    return root;
  }

  private greyLever(): THREE.Object3D {
    const root = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.0, 0.4), toonMaterial(0x6b6b6b));
    post.position.y = 0.5;
    const handle = new THREE.Group();
    handle.name = 'Handle';
    handle.position.y = 0.9;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), toonMaterial(0x8a5a32));
    bar.position.y = 0.6;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), toonMaterial(0xe5383b));
    knob.position.y = 1.2;
    handle.add(bar, knob);
    root.add(post, handle);
    return root;
  }

  private greyCannon(): CannonLook {
    const root = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 1.1), toonMaterial(0x6b5236));
    base.position.y = 0.25;
    const yaw = new THREE.Group();
    yaw.name = 'Yaw';
    const pitch = new THREE.Group();
    pitch.name = 'Pitch';
    pitch.position.y = CANNON.pivotUp;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, CANNON.barrel, 10), toonMaterial(0xc98a3e));
    barrel.rotation.x = HALF_PI;
    barrel.position.z = CANNON.barrel / 2;
    const muzzle = new THREE.Object3D();
    muzzle.name = 'Muzzle';
    muzzle.position.z = CANNON.barrel;
    pitch.add(barrel, muzzle);
    yaw.add(pitch);
    root.add(base, yaw);
    return this.cannonLook(root, yaw, pitch, muzzle);
  }

  private cannonLook(root: THREE.Object3D, yaw: THREE.Object3D, pitch: THREE.Object3D, muzzle: THREE.Object3D): CannonLook {
    const glowMat = new THREE.MeshBasicNodeMaterial({ color: 0xff5a1a, transparent: true, opacity: 0, depthWrite: false });
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), glowMat);
    muzzle.add(glow);
    return { root, yaw, pitch, muzzle, glow, glowMat, recoil: 0, y: 0, p: 0 };
  }

  // ---- the kit models ---------------------------------------------------------------

  private async loadModels(): Promise<void> {
    const [gate, bridge, lever, cannon] = await Promise.all(['castle_gate', 'castle_drawbridge', 'castle_lever', 'bread_cannon'].map(kitModel));
    if (gate) {
      const parts: Record<string, THREE.Object3D | null> = {};
      for (const n of ['Intact', 'Damaged', 'Broken', 'Planks']) parts[n] = gate.getObjectByName(n) ?? null;
      if (parts.Intact) {
        this.gate.removeFromParent();
        this.gate = gate;
        this.gateParts = parts;
        this.placeGate(gate);
        this.group.add(gate);
        this.modelsLoaded++;
      }
    }
    if (bridge) {
      const hinge = bridge.getObjectByName('Hinge');
      if (hinge) {
        this.bridge.removeFromParent();
        this.bridge = bridge;
        this.hinge = hinge;
        this.chains = (['L', 'R'] as const)
          .map((s) => ({ chain: bridge.getObjectByName(`Chain${s}`), anchor: bridge.getObjectByName(`ChainAnchor${s}`) }))
          .filter((c): c is { chain: THREE.Object3D; anchor: THREE.Object3D } => !!c.chain && !!c.anchor);
        this.placeBridge(bridge);
        this.group.add(bridge);
        this.modelsLoaded++;
      }
    }
    if (lever) {
      const handle = lever.getObjectByName('Handle');
      if (handle) {
        this.lever.removeFromParent();
        this.lever = lever;
        this.handle = handle;
        this.placeLever(lever);
        this.group.add(lever);
        this.modelsLoaded++;
      }
    }
    if (cannon) {
      const ok = cannon.getObjectByName('Yaw') && cannon.getObjectByName('Pitch') && cannon.getObjectByName('Muzzle');
      if (ok) {
        this.cannons.forEach((look, i) => {
          const root = cannon.clone(true);
          const c = this.g.cannons[i]!;
          root.position.set(c.x, c.y, c.z);
          root.rotation.y = c.yaw + Math.PI;
          look.root.removeFromParent();
          const fresh = this.cannonLook(root, root.getObjectByName('Yaw')!, root.getObjectByName('Pitch')!, root.getObjectByName('Muzzle')!);
          Object.assign(look, { ...fresh, y: look.y, p: look.p });
          this.group.add(root);
        });
        this.modelsLoaded++;
      }
    }
  }

  // ---- per frame --------------------------------------------------------------------

  /**
   * Draw the keep as the state says. `mine`: the cannon we man (index) and
   * our predicted state, so our barrel and the arc follow our own aim at once.
   */
  frame(dt: number, st: RaidState, serverNow: number, mine: { cannon: number; sim: PlayerSim; side: number } | null, cam: THREE.Vector3): void {
    this.frameGate(st);
    this.frameBridge(st, serverNow);
    this.frameLever(st, dt);
    this.frameCannons(dt, st, mine);
    this.framePreview(mine, cam);
  }

  private frameGate(st: RaidState): void {
    const broken = st.gate === GateState.Broken;
    if (broken) this.wasBroken = true;
    if (!broken && st.gateHp >= st.gateMax) this.wasBroken = false;
    // Mended after a break: the damaged leaves with the plank barricade nailed over them, until it is whole again.
    const planks = this.wasBroken && !broken;
    const p = this.gateParts;
    if (p.Intact) p.Intact.visible = !broken && !planks && st.gate === GateState.Intact;
    if (p.Damaged) p.Damaged.visible = !broken && (planks || st.gate === GateState.Damaged);
    if (p.Broken) p.Broken.visible = broken;
    if (p.Planks) p.Planks.visible = planks;
  }

  /** The hinge angle from the state's move times (negative is up). */
  private bridgeAngle(st: RaidState, now: number): number {
    const span = Math.max(1, st.bridgeEnds - st.bridgeAt);
    const k = ease((now - st.bridgeAt) / span);
    if (st.bridge === BridgeState.Raising) return -HALF_PI * k;
    if (st.bridge === BridgeState.Lowering) return -HALF_PI * (1 - k);
    return st.bridge === BridgeState.Up ? -HALF_PI : 0;
  }

  private frameBridge(st: RaidState, now: number): void {
    this.hinge.rotation.x = this.bridgeAngle(st, now);
    for (const c of this.chains) {
      c.anchor.getWorldPosition(this.v);
      c.chain.parent?.updateMatrixWorld();
      c.chain.getWorldPosition(this.w);
      c.chain.lookAt(this.v);
      c.chain.scale.z = Math.max(0.01, this.v.distanceTo(this.w));
    }
  }

  private frameLever(st: RaidState, dt: number): void {
    const up = st.bridge === BridgeState.Raising || st.bridge === BridgeState.Up;
    const want = up ? 0.7 : -0.7;
    this.handleAngle += (want - this.handleAngle) * Math.min(1, dt * 8);
    this.handle.rotation.x = this.handleAngle;
  }

  private frameCannons(dt: number, st: RaidState, mine: { cannon: number; sim: PlayerSim; side: number } | null): void {
    this.cannons.forEach((c, i) => {
      const e = st.cannons.get(String(i));
      let yaw = e?.yaw ?? this.g.cannons[i]!.yaw;
      let pitch = e?.pitch ?? 0;
      if (mine && mine.cannon === i) {
        const a = cannonAim(this.sim, this.g, i, mine.sim, mine.side, this.aim);
        yaw = a.yaw;
        pitch = a.pitch;
      }
      const dy = ((yaw - c.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      c.y += dy * Math.min(1, dt * 14);
      c.p += (pitch - c.p) * Math.min(1, dt * 14);
      // The root faces the mount's straight-out yaw (+ PI: the art shoots along +Z); the Yaw node turns the rest.
      c.yaw.rotation.y = c.y - this.g.cannons[i]!.yaw;
      c.pitch.rotation.x = -c.p;
      c.recoil = Math.max(0, c.recoil - dt * 3);
      c.pitch.position.z = -0.35 * Math.sin(Math.min(1, c.recoil) * Math.PI);
      const heat = (e?.heat ?? 0) / 255;
      c.glowMat.opacity = e?.hot ? 0.55 + Math.sin(performance.now() / 90) * 0.2 : heat * 0.45;
    });
  }

  /** The dotted arc and the landing ring of the cannon we man (refreshed every other frame). */
  private framePreview(mine: { cannon: number; sim: PlayerSim; side: number } | null, cam: THREE.Vector3): void {
    if (!mine) {
      this.dots.count = 0;
      this.ring.visible = false;
      return;
    }
    if (++this.previewTick % 2 === 0) return;
    const a = cannonAim(this.sim, this.g, mine.cannon, mine.sim, mine.side, this.aim);
    const n = breadPath(this.sim, a, 1 / 30, this.path, 48);
    let k = 0;
    for (let i = 1; i < n; i += 1) {
      const p = this.path[i]!;
      // About the same size on screen near and far (the arc runs out to 150 m).
      const sc = Math.max(1, Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z) / 6);
      this.m4.makeScale(sc, sc, sc).setPosition(p.x, p.y, p.z);
      this.dots.setMatrixAt(k++, this.m4);
    }
    this.dots.count = k;
    this.dots.instanceMatrix.needsUpdate = true;
    const end = this.path[n - 1];
    this.ring.visible = !!end;
    if (end) {
      this.ring.position.set(end.x, end.y + 0.08, end.z);
      this.ring.scale.setScalar(Math.max(1.2, Math.hypot(end.x - cam.x, end.z - cam.z) / 30));
    }
  }

  /** A loaf left cannon `i`: the barrel kicks back. Returns the muzzle (world) for the puff. */
  fired(i: number, out: THREE.Vector3): THREE.Vector3 | null {
    const c = this.cannons[i];
    if (!c) return null;
    c.recoil = 1;
    return c.muzzle.getWorldPosition(out);
  }

  /** The muzzle of cannon `i` in the world. */
  muzzleOf(i: number, out: THREE.Vector3): THREE.Vector3 | null {
    const c = this.cannons[i];
    return c ? c.muzzle.getWorldPosition(out) : null;
  }

  /** Where the gate is (for sounds and effects). */
  gateAt(out: THREE.Vector3): THREE.Vector3 {
    const gt = this.g.gate;
    return out.set(gt.x + gt.nx * 0.5, gt.y + 1.5, gt.z + gt.nz * 0.5);
  }

  bridgeAt(out: THREE.Vector3): THREE.Vector3 {
    const b = this.g.bridge;
    return out.set(b.x + b.dx * b.len * 0.5, b.y + 1, b.z + b.dz * b.len * 0.5);
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
