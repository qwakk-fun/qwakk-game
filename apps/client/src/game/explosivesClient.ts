/**
 * Deathmatch explosives on the client: draws what the server announces
 * (grenades, rockets, blasts, the launcher pickup), plus feel-only extras.
 *
 * - Grenades the server told us about fly with the shared flight step
 *   (projectiles.ts) from the announced launch, so they arc and bounce here
 *   as on the server; the blast (Msg.Boom) ends them where the server says.
 * - Our own throw or launch is predicted for feel only: the local sim step
 *   reports it (session.localExplosive), we draw it at once and hand the
 *   drawing over to the server's projectile when it arrives. Damage, kills
 *   and the blast always come from the server.
 * - Holding G shows a short dotted arc of where the throw would go (the same
 *   flight step from our predicted state) and a ring where it lands.
 * - Juice: toony fireball, shockwave ring, debris, smoke and a scorch mark
 *   (fx/explosion.ts), camera shake by distance, synthesized boom, whoosh
 *   and bounce ticks (audio/sound.ts), a small HUD for grenades and rockets.
 *
 * Nothing here sends anything: the throw is the G button in the input frame.
 */
import * as THREE from 'three/webgpu';
import {
  Button,
  copyPlayerSim,
  createPlayerSim,
  DT,
  emptyFlight,
  EXPLOSIVE,
  exLauncher,
  exNades,
  exRockets,
  ExplosiveKind,
  grenadeLaunch,
  grenadePath,
  Mode,
  rocketLaunch,
  stepBread,
  stepGrenade,
  type Flight,
  type PlayerSim,
  type SimWorld,
  type Vec3Like,
} from '@qwakk/shared';
import { KillWeapon, MatchPhase } from '@qwakk/shared/net';
import type { Sound } from '../audio/sound.ts';
import type { TpsCamera } from '../camera/tpsCamera.ts';
import type { Effects } from '../fx/effects.ts';
import { ExplosionFx } from '../fx/explosion.ts';
import { t } from '../i18n/game.ts';
import type { Controls } from '../input/controls.ts';
import type { Session } from '../net/session.ts';
import type { Avatar } from '../player/avatar.ts';
import { createLauncher } from '../player/launcherModel.ts';
import { toonMaterial } from '../render/materials.ts';
import { BRAND } from '../render/palette.ts';
import { envMaterial, loadPropGlb, paletteOf } from '../world/sainte/gltf.ts';
import '../hud/explosives.css';

export interface ExplosivesViews {
  localAvatar: Avatar;
  remoteAvatar(id: string): Avatar | null;
  myPosition(): THREE.Vector3;
}

interface Shown {
  id: number;
  kind: number;
  ownerPid: number;
  flight: Flight;
  /** Grenade: the previous step's position, for smooth drawing between 30 Hz steps. */
  px: number;
  py: number;
  pz: number;
  acc: number;
  mesh: THREE.Object3D;
  /** performance.now() when it started here. */
  born: number;
  /** Predicted (our own, not confirmed by the server yet). */
  predicted: boolean;
  trailAt: number;
  whooshed: boolean;
}

/** Longest a drawn grenade or rocket may live without its blast (the fuse setting tops out at 5 s). */
const MAX_LIFE_MS = 9000;
/** An unconfirmed own throw is dropped after this long (the server refused it, or the round ended). */
const PREDICTED_MS = 1500;
const PREVIEW_DOTS = 28;

export class ExplosivesClient {
  private readonly session: Session;
  private readonly sim: SimWorld;
  private readonly scene: THREE.Scene;
  private readonly effects: Effects;
  private readonly sound: Sound;
  private readonly cam: TpsCamera;
  private readonly controls: Controls;
  private readonly views: ExplosivesViews;
  readonly fx: ExplosionFx;
  private readonly shown = new Map<number, Shown>();
  private readonly pending: Shown[] = [];
  private readonly group = new THREE.Group();
  private readonly grenadeGeo = new THREE.SphereGeometry(EXPLOSIVE.grenade.radius * 1.5, 10, 8);
  private readonly bandGeo = new THREE.TorusGeometry(EXPLOSIVE.grenade.radius * 1.5, 0.018, 5, 14);
  private readonly rocketGeo: THREE.BufferGeometry;
  private readonly noseGeo: THREE.BufferGeometry;
  private readonly finGeo = new THREE.BoxGeometry(0.16, 0.012, 0.1);
  private readonly preview: THREE.InstancedMesh;
  private readonly landing: THREE.Mesh;
  private readonly path: Vec3Like[] = [];
  private readonly scratch: PlayerSim = createPlayerSim(0, 0, 0);
  private readonly pickups = new Map<string, THREE.Group>();
  private readonly hud = document.createElement('div');
  private readonly toastEl = document.createElement('div');
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private hudKey = '';
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private nextLocalId = -1;

  constructor(opts: { session: Session; sim: SimWorld; scene: THREE.Scene; effects: Effects; sound: Sound; cam: TpsCamera; controls: Controls; hudRoot: HTMLElement; groundAt: (x: number, y: number, z: number) => number; views: ExplosivesViews }) {
    this.session = opts.session;
    this.sim = opts.sim;
    this.scene = opts.scene;
    this.effects = opts.effects;
    this.sound = opts.sound;
    this.cam = opts.cam;
    this.controls = opts.controls;
    this.views = opts.views;
    this.fx = new ExplosionFx(opts.scene, opts.groundAt);
    this.scene.add(this.group);
    this.rocketGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.42, 8);
    this.rocketGeo.rotateX(Math.PI / 2);
    this.noseGeo = new THREE.ConeGeometry(0.05, 0.14, 8);
    this.noseGeo.rotateX(Math.PI / 2);
    this.noseGeo.translate(0, 0, 0.28);
    const dot = new THREE.SphereGeometry(0.045, 6, 4);
    this.preview = new THREE.InstancedMesh(dot, new THREE.MeshBasicNodeMaterial({ color: 0xfff6d8, transparent: true, opacity: 0.85, depthWrite: false }), PREVIEW_DOTS);
    this.preview.frustumCulled = false;
    this.preview.visible = false;
    for (let i = 0; i < PREVIEW_DOTS; i++) this.preview.setMatrixAt(i, this.hidden);
    this.scene.add(this.preview);
    const ring = new THREE.RingGeometry(0.42, 0.55, 28);
    ring.rotateX(-Math.PI / 2);
    this.landing = new THREE.Mesh(ring, new THREE.MeshBasicNodeMaterial({ color: BRAND.yellow, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    this.landing.visible = false;
    this.scene.add(this.landing);
    this.hud.className = 'ex-hud';
    this.toastEl.className = 'ex-toast';
    this.toastEl.hidden = true;
    opts.hudRoot.append(this.hud, this.toastEl);
  }

  private get myPid(): number {
    return this.session.mine?.pid ?? -1;
  }

  // ---- meshes ----

  private grenadeMesh(): THREE.Object3D {
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.grenadeGeo, toonMaterial(0x6d8f3c));
    const band = new THREE.Mesh(this.bandGeo, toonMaterial(BRAND.yellow));
    band.rotation.x = Math.PI / 2;
    g.add(body, band);
    return g;
  }

  private rocketMesh(): THREE.Object3D {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.rocketGeo, toonMaterial(0xe9e4d6)), new THREE.Mesh(this.noseGeo, toonMaterial(BRAND.beak)));
    for (let i = 0; i < 2; i++) {
      const fin = new THREE.Mesh(this.finGeo, toonMaterial(BRAND.yellow));
      fin.position.z = -0.18;
      fin.rotation.z = (i * Math.PI) / 2;
      g.add(fin);
    }
    return g;
  }

  /** Hunt Season: a decoy thrower's wooden decoy (the art's decoy.glb when loaded, else a small painted duck shape). */
  decoyModel: THREE.Object3D | null = null;

  private decoyMesh(): THREE.Object3D {
    if (this.decoyModel) return this.decoyModel.clone();
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.grenadeGeo, toonMaterial(0x8a5a32));
    body.scale.set(1.3, 0.9, 2);
    const head = new THREE.Mesh(this.grenadeGeo, toonMaterial(0x2f6b3a));
    head.scale.setScalar(0.7);
    head.position.set(0, 0.08, -0.14);
    const bill = new THREE.Mesh(this.bandGeo, toonMaterial(BRAND.yellow));
    bill.position.set(0, 0.07, -0.22);
    g.add(body, head, bill);
    return g;
  }

  /** Hunt Season: a bread cannon's loaf (the prop kit's bread_loaf.glb when it loads, else a toon loaf). */
  private loafModel: THREE.Object3D | null = null;
  private loafTried = false;

  private loafMesh(): THREE.Object3D {
    if (!this.loafTried) {
      this.loafTried = true;
      void loadPropGlb('bread_loaf').then(
        (gltf) => {
          const mat = envMaterial({ map: paletteOf(gltf), key: 'keep-bread_loaf' });
          const root = gltf.scene.clone(true);
          root.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = mat;
          });
          // Twice the art's size: easy to follow in flight.
          root.scale.setScalar(2);
          this.loafModel = root;
        },
        () => undefined,
      );
    }
    if (this.loafModel) return this.loafModel.clone();
    const g = new THREE.Group();
    const crust = new THREE.Mesh(this.grenadeGeo, toonMaterial(0xc98a3e));
    crust.scale.set(2.6, 1.6, 4.2);
    const top = new THREE.Mesh(this.grenadeGeo, toonMaterial(0xf2d49b));
    top.scale.set(2.0, 0.8, 3.4);
    top.position.y = 0.09;
    g.add(crust, top);
    return g;
  }

  private add(id: number, kind: number, ownerPid: number, flight: Flight, predicted: boolean): Shown {
    const mesh = kind === ExplosiveKind.Grenade ? this.grenadeMesh() : kind === ExplosiveKind.Decoy ? this.decoyMesh() : kind === ExplosiveKind.Bread ? this.loafMesh() : this.rocketMesh();
    mesh.position.set(flight.x, flight.y, flight.z);
    this.group.add(mesh);
    const s: Shown = { id, kind, ownerPid, flight, px: flight.x, py: flight.y, pz: flight.z, acc: 0, mesh, born: performance.now(), predicted, trailAt: 0, whooshed: false };
    this.orient(s);
    return s;
  }

  private remove(s: Shown): void {
    s.mesh.removeFromParent();
  }

  private orient(s: Shown): void {
    if (s.kind !== ExplosiveKind.Rocket) return;
    const f = s.flight;
    this.v.set(f.x + f.vx, f.y + f.vy, f.z + f.vz);
    s.mesh.lookAt(this.v);
  }

  // ---- server messages ----

  /** A grenade or rocket the server announced (ownerPid 0: a resting grenade whose thrower we did not see). */
  projectile(id: number, kind: number, ownerPid: number, at: [number, number, number], vel: [number, number, number]): void {
    if (this.shown.has(id)) return;
    this.counts.projectiles++;
    const mine = ownerPid !== 0 && ownerPid === this.myPid;
    if (mine) {
      // Our own throw: the predicted drawing becomes this projectile (it flies the same path).
      const i = this.pending.findIndex((p) => p.kind === kind);
      if (i >= 0) {
        const p = this.pending.splice(i, 1)[0] as Shown;
        p.id = id;
        p.predicted = false;
        // A rocket takes the server's heading (its aim point may be a duck we did not aim at locally).
        if (kind === ExplosiveKind.Rocket) {
          p.flight.vx = vel[0];
          p.flight.vy = vel[1];
          p.flight.vz = vel[2];
        }
        this.shown.set(id, p);
        return;
      }
    }
    const f = emptyFlight(kind);
    f.x = at[0];
    f.y = at[1];
    f.z = at[2];
    f.vx = vel[0];
    f.vy = vel[1];
    f.vz = vel[2];
    f.rest = ownerPid === 0 && vel[0] === 0 && vel[1] === 0 && vel[2] === 0 ? 1 : 0;
    const s = this.add(id, kind, ownerPid, f, false);
    this.shown.set(id, s);
    if (kind === ExplosiveKind.Decoy) {
      this.sound.duckCall(this.v.set(f.x, f.y, f.z));
      return;
    }
    if (kind === ExplosiveKind.Bread) {
      // Our own cannon already thumped (predicted feel, raidClient); a friend's cannon is heard from where it is.
      if (!mine) this.sound.cannonThump(this.v.set(f.x, f.y, f.z));
      return;
    }
    if (ownerPid === 0 || mine) return;
    // Someone we can see threw or fired: their throw sound, or the launch with a flash.
    const ownerId = this.session.idOfPid(ownerPid);
    const avatar = ownerId ? this.views.remoteAvatar(ownerId) : null;
    this.v.set(f.x, f.y, f.z);
    if (kind === ExplosiveKind.Rocket) {
      if (avatar) {
        avatar.fire();
        avatar.launcherMuzzle(this.v);
      }
      this.w.set(f.vx, f.vy, f.vz).normalize();
      this.effects.muzzleFlash(this.v, this.w, 1.4);
      this.sound.rocketLaunch(this.v);
    } else this.sound.grenadeThrow(this.v);
  }

  /** An explosion: effects, sound and shake where the server says, and the end of its projectile. */
  boom(id: number, kind: number, at: [number, number, number]): void {
    this.counts.booms++;
    this.counts.lastBoomAt = performance.now();
    const s = this.shown.get(id);
    if (s) {
      this.remove(s);
      this.shown.delete(id);
    }
    const rocket = kind === ExplosiveKind.Rocket;
    this.v.set(at[0], at[1], at[2]);
    if (kind === ExplosiveKind.Bread) {
      // A loaf bursts: crumbs and flour, a doughy bonk, a little shake close by. No fireball.
      this.effects.crumbBurst(this.v, 1.2);
      this.effects.toonPop(this.v, 0.8);
      this.sound.breadBonk(this.v);
      const dd = this.v.distanceTo(this.views.myPosition());
      if (dd < 10) this.cam.shake(0.06 * (1 - dd / 10));
      return;
    }
    if (kind === ExplosiveKind.Decoy) {
      // A decoy pops: a toony puff of dust and stars and a wooden bonk, no fireball.
      this.effects.toonPop(this.v, 1.6);
      this.sound.decoyPop(this.v);
      const dd = this.v.distanceTo(this.views.myPosition());
      if (dd < 8) this.cam.shake(0.08 * (1 - dd / 8));
      return;
    }
    this.fx.explode(this.v, rocket);
    this.w.set(0, 1, 0);
    this.effects.feathersBurst(this.v, this.w, rocket ? 8 : 12, 1.6);
    const me = this.views.myPosition();
    const d = this.v.distanceTo(me);
    this.sound.explosion(this.v, d);
    // Shake by distance: strong up close, a rumble at mid range, nothing far away.
    const k = Math.max(0, 1 - d / (rocket ? 28 : 32));
    if (k > 0) this.cam.shake(0.25 * k * k + 0.03 * k);
  }

  /** We picked up the rocket launcher. */
  rocketPicked(rockets: number): void {
    this.toast(t('Rocket launcher'), t('{n} rockets · press 3', { n: rockets }));
    this.sound.reward();
  }

  /** A throw or launch we could not see: its sound from that direction only (no position was sent). */
  hint(weapon: number, angle: number, loud: number): void {
    if (weapon !== KillWeapon.Grenade && weapon !== KillWeapon.Rocket) return;
    const me = this.views.myPosition();
    const dist = loud === 2 ? 12 : loud === 1 ? 35 : 80;
    this.v.set(me.x - Math.sin(angle) * dist, me.y + 1.4, me.z - Math.cos(angle) * dist);
    if (weapon === KillWeapon.Rocket) this.sound.rocketLaunch(this.v);
    else this.sound.grenadeThrow(this.v);
  }

  /** The local sim threw or launched (predicted, feel only): draw it now. */
  localExplosive(kind: number, state: PlayerSim, buttons: number): void {
    const side = buttons & Button.ShoulderLeft ? -1 : 1;
    const f = kind === ExplosiveKind.Grenade ? grenadeLaunch(this.sim, state, emptyFlight()) : rocketLaunch(this.sim, state, side, emptyFlight());
    const s = this.add(this.nextLocalId--, kind, this.myPid, f, true);
    this.pending.push(s);
    this.counts.localThrows++;
    this.counts.lastLaunchAt = performance.now();
    const avatar = this.views.localAvatar;
    if (kind === ExplosiveKind.Rocket) {
      avatar.fire();
      avatar.launcherMuzzle(this.v);
      this.w.set(f.vx, f.vy, f.vz).normalize();
      this.effects.muzzleFlash(this.v, this.w, 1.5);
      this.sound.rocketLaunch();
      this.cam.kick(0.05, (Math.random() - 0.5) * 0.02);
      this.cam.shake(0.04);
    } else this.sound.grenadeThrow();
  }

  // ---- per frame ----

  frame(dt: number, now: number): void {
    const camPos = this.cam.camera.position;
    for (const s of [...this.shown.values(), ...this.pending]) {
      if (now - s.born > MAX_LIFE_MS || (s.predicted && now - s.born > PREDICTED_MS)) {
        this.remove(s);
        if (s.predicted) this.pending.splice(this.pending.indexOf(s), 1);
        else this.shown.delete(s.id);
        continue;
      }
      const f = s.flight;
      if (s.kind === ExplosiveKind.Bread) {
        // The server's flight step (gravity, stops on what it hits); the burst (Msg.Boom) ends it.
        s.acc += dt;
        while (s.acc >= DT && !f.rest) {
          s.acc -= DT;
          s.px = f.x;
          s.py = f.y;
          s.pz = f.z;
          stepBread(this.sim, f, DT);
        }
        const a = f.rest ? 1 : s.acc / DT;
        s.mesh.position.set(s.px + (f.x - s.px) * a, s.py + (f.y - s.py) * a, s.pz + (f.z - s.pz) * a);
        if (!f.rest) {
          s.mesh.rotation.x += dt * 6;
          s.mesh.rotation.y += dt * 2;
        }
        continue;
      }
      if (s.kind === ExplosiveKind.Grenade || s.kind === ExplosiveKind.Decoy) {
        s.acc += dt;
        while (s.acc >= DT) {
          s.acc -= DT;
          s.px = f.x;
          s.py = f.y;
          s.pz = f.z;
          const impact = stepGrenade(this.sim, f, DT);
          if (impact > EXPLOSIVE.grenade.tickSpeed) this.sound.grenadeTick(this.v.set(f.x, f.y, f.z), impact / 10);
        }
        const a = s.acc / DT;
        s.mesh.position.set(s.px + (f.x - s.px) * a, s.py + (f.y - s.py) * a, s.pz + (f.z - s.pz) * a);
        if (!f.rest) s.mesh.rotation.x += dt * 9;
      } else {
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.z += f.vz * dt;
        s.mesh.position.set(f.x, f.y, f.z);
        this.orient(s);
        // Exhaust: a hot puff at the tail and smoke left behind.
        if (now - s.trailAt > 18) {
          s.trailAt = now;
          this.w.set(f.vx, f.vy, f.vz).normalize().multiplyScalar(-0.3).add(s.mesh.position);
          this.fx.trail(this.w, true);
          this.fx.trail(this.w);
        }
        if (!s.whooshed && s.ownerPid !== this.myPid && s.mesh.position.distanceTo(camPos) < 5) {
          s.whooshed = true;
          this.sound.rocketWhoosh(s.mesh.position);
        }
      }
    }
    this.updatePreview();
    this.updatePickups(now);
    this.fx.update(dt, this.cam.camera);
    this.updateHud();
  }

  /** The dotted throw arc while G is held (our predicted state, the latest look angles). */
  private updatePreview(): void {
    const me = this.session.me;
    const s = me?.state as unknown as PlayerSim | undefined;
    const playing = this.session.room.state.phase === MatchPhase.Playing;
    // Held in the last predicted step (keys, touch or a test hook alike).
    const show = !!s && playing && (s.prevButtons & Button.Grenade) !== 0 && s.alive === 1 && s.mode === Mode.Ground && s.down === 0 && exNades(s) > 0 && s.heal === 0;
    this.preview.visible = show;
    this.landing.visible = show;
    if (!show || !me || !s) return;
    const sc = copyPlayerSim(s, this.scratch);
    sc.x = me.value('x');
    sc.y = me.value('y');
    sc.z = me.value('z');
    sc.yaw = this.controls.yaw;
    sc.pitch = this.controls.pitch;
    const start = grenadeLaunch(this.sim, sc, emptyFlight());
    // Up to where it first lands (the ring); bounces after that are left to the eye.
    const n = grenadePath(this.sim, start, EXPLOSIVE.previewSeconds, DT, this.path, 64, true);
    const cam = this.cam.camera.position;
    const stride = Math.max(1, Math.ceil((n - 2) / PREVIEW_DOTS));
    for (let i = 0; i < PREVIEW_DOTS; i++) {
      const idx = 1 + i * stride;
      const p = this.path[idx];
      if (!p || idx >= n - 1) this.preview.setMatrixAt(i, this.hidden);
      else {
        // About the same size on screen near and far.
        const k = Math.max(1, Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z) / 5);
        this.preview.setMatrixAt(i, this.m.makeScale(k, k, k).setPosition(p.x, p.y, p.z));
      }
    }
    this.preview.instanceMatrix.needsUpdate = true;
    const last = this.path[n - 1];
    if (last) this.landing.position.set(last.x, last.y + 0.02 - EXPLOSIVE.grenade.radius * 0.5, last.z);
  }

  /** The launcher pickup: a floating launcher with a ring and a label (public map objective). */
  private updatePickups(now: number): void {
    const state = this.session.room.state;
    for (const [id, g] of this.pickups) {
      if (!state.dmRockets.has(id)) {
        g.removeFromParent();
        g.traverse((o) => {
          if (o instanceof THREE.Mesh) o.geometry.dispose();
          if (o instanceof THREE.Sprite) {
            (o.material as THREE.SpriteNodeMaterial).map?.dispose();
            o.material.dispose();
          }
        });
        this.pickups.delete(id);
      }
    }
    for (const [id, p] of state.dmRockets) {
      let g = this.pickups.get(id);
      if (!g) {
        g = new THREE.Group();
        const l = createLauncher();
        l.root.scale.setScalar(1.4);
        l.root.rotation.z = 0.35;
        const spin = new THREE.Group();
        spin.add(l.root);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.04, 6, 28), new THREE.MeshBasicNodeMaterial({ color: BRAND.beak }));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = -0.55;
        g.add(spin, ring, this.label(t('Rocket launcher')));
        this.group.add(g);
        this.pickups.set(id, g);
      }
      g.position.set(p.x, p.y + Math.sin(now / 420) * 0.09, p.z);
      (g.children[0] as THREE.Object3D).rotation.y = now / 650;
    }
  }

  private label(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 64;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#151619';
    c.fillRect(0, 0, 320, 64);
    c.fillStyle = '#ff8a3d';
    c.fillRect(0, 58, 320, 6);
    c.fillStyle = '#ffffff';
    c.font = 'bold 26px sans-serif';
    c.textAlign = 'center';
    c.fillText(text, 160, 41);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteNodeMaterial({ map: tex }));
    sprite.position.y = 0.85;
    sprite.scale.set(2.2, 0.44, 1);
    return sprite;
  }

  private updateHud(): void {
    const s = this.session.me?.state as unknown as PlayerSim | undefined;
    const alive = this.session.mine?.alive === 1;
    const nades = s ? exNades(s) : 0;
    const rockets = s ? exRockets(s) : 0;
    const out = s ? exLauncher(s) === 1 : false;
    const key = `${alive ? 1 : 0}|${nades}|${rockets}|${out ? 1 : 0}`;
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.hidden = !alive || (nades === 0 && rockets === 0);
    const pips = (n: number, cls: string) => Array.from({ length: Math.min(n, 6) }, () => `<i class="${cls}"></i>`).join('');
    this.hud.innerHTML =
      `<div class="ex-row${nades === 0 ? ' none' : ''}"><span class="ex-key">G</span>${pips(nades, 'ex-nade')}<span class="ex-n">${nades}</span></div>` +
      (rockets > 0 ? `<div class="ex-row rocket${out ? ' out' : ''}"><span class="ex-key">3</span>${pips(rockets, 'ex-rkt')}<span class="ex-n">${rockets}</span></div>` : '');
  }

  private toast(title: string, detail: string): void {
    this.toastEl.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = title;
    const span = document.createElement('span');
    span.textContent = detail;
    this.toastEl.append(strong, span);
    this.toastEl.hidden = false;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toastEl.hidden = true), 2600);
  }

  /** The round ended: the server dropped every flight without a blast, so drop what we draw too. */
  roundOver(): void {
    for (const s of this.shown.values()) this.remove(s);
    this.shown.clear();
    this.clearPending();
  }

  /** Round over or a new life: nothing of ours stays predicted. */
  clearPending(): void {
    for (const p of this.pending) this.remove(p);
    this.pending.length = 0;
  }

  hideForReplay(): () => void {
    const restoreFx = this.fx.hideForReplay();
    const was = this.group.visible;
    this.group.visible = false;
    this.preview.visible = false;
    this.landing.visible = false;
    return () => {
      restoreFx();
      this.group.visible = was;
    };
  }

  /** Counters for the test hook (dev builds read them through game/testHook.ts). */
  readonly counts = { booms: 0, lastBoomAt: 0, projectiles: 0, localThrows: 0, lastLaunchAt: 0 };

  stats(): { shown: number; pending: number; rocketPickups: number; preview: boolean; booms: number; lastBoomAt: number; projectiles: number; localThrows: number; lastLaunchAt: number } {
    return { shown: this.shown.size, pending: this.pending.length, rocketPickups: this.pickups.size, preview: this.preview.visible, ...this.counts };
  }

  dispose(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.group.removeFromParent();
    this.preview.removeFromParent();
    this.landing.removeFromParent();
    this.hud.remove();
    this.toastEl.remove();
  }
}
