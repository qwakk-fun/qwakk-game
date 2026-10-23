/**
 * Hunt Season on the client: draws what the server sends and nothing more.
 * Hunters (public room state, interpolated like near ducks) as their models
 * or the greybox, with their telegraphs (the rifleman's laser and glint, the
 * boss's wind-up glint) and a small health bar; traps; ammo and heal drops;
 * markers for hunters at the tower and the last few of a wave; the HUD
 * (hud/raid/raidHud.ts) from the raid state and our own messages (cards,
 * our numbers, the end with the XP); the camera while we are out (it follows
 * a friend). The server decides every hit, card and XP point.
 */
import * as THREE from 'three/webgpu';
import { HunterAct, HunterKind, hunterShape, isBossWave, KNOCK, OPAQUE_QUERY_GROUPS, RAID, RaidStage, rayHitbox, TRAP_SHAPE, type HitTarget, type SimWorld } from '@qwakk/shared';
import { RaidDrop, RaidEvent, type Hunter } from '@qwakk/shared/net';
import type { Sound } from '../audio/sound.ts';
import type { TpsCamera } from '../camera/tpsCamera.ts';
import type { Effects } from '../fx/effects.ts';
import type { GameHud } from '../hud/gameHud.ts';
import { RaidHud, upgradeName, type RaidEndView } from '../hud/raid/raidHud.ts';
import { t } from '../i18n/game.ts';
import type { Session } from '../net/session.ts';
import { toonMaterial } from '../render/materials.ts';
import { loadHunterArt, type HunterArt } from './raid/hunterAssets.ts';
import { createHunterLook, isGreybox, type HunterLook } from './raid/hunterView.ts';
import type { SeenDuck } from './autopilot.ts';

export interface RaidSummary {
  mode: 'raid';
  waves: number;
  kills: number;
  xp: number;
  /** "Play again" on the end screen: the menu starts another hunt at once. */
  again?: boolean;
}

export interface RaidClientDeps {
  session: Session;
  sim: SimWorld;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cam: TpsCamera;
  sound: Sound;
  ghud: GameHud;
  fx: Effects;
  touch: boolean;
  /** Leave the run (the end screen's buttons). */
  exit(summary: RaidSummary): void;
}

interface View {
  look: HunterLook;
  kind: number;
  lastAct: number;
  lastHp: number;
  px: number;
  pz: number;
  speed: number;
  laser: THREE.Mesh | null;
  glint: THREE.Sprite | null;
  barBack: THREE.Sprite;
  barFill: THREE.Sprite;
  /** Gone from the state: kept a moment to finish its defeat, then faded. */
  goneAt: number;
}

const HUNTER_NAMES: Record<number, string> = {
  [HunterKind.Rifleman]: 'Rifleman', [HunterKind.Trapper]: 'Trapper', [HunterKind.Decoy]: 'Decoy thrower', [HunterKind.Dog]: 'Hunting dog', [HunterKind.Boss]: 'Big Hunter',
};

export function hunterName(kind: number): string {
  return t(HUNTER_NAMES[kind] ?? 'Rifleman');
}

const LASER_RANGE = 70;

/** A soft four-point star for the scope glint (a canvas: no image file). */
function glintTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fillRect(30, 2, 4, 60);
  g.fillRect(2, 30, 60, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const isPhone = (): boolean => matchMedia('(pointer: coarse)').matches;

export class RaidClient {
  readonly hud: RaidHud;
  private readonly d: RaidClientDeps;
  private readonly group = new THREE.Group();
  private readonly views = new Map<string, View>();
  private readonly traps = new Map<string, { obj: THREE.Object3D; open: THREE.Object3D; sprung: THREE.Object3D; state: number }>();
  private readonly drops = new Map<string, THREE.Object3D>();
  private readonly markers = new Map<string, HTMLElement>();
  private art: HunterArt | null = null;
  private artTried = false;
  private offer: [number, number][] = [];
  private offerDeadline = 0;
  private self: number[] = [];
  private endView: RaidEndView | null = null;
  private lastStage = -1;
  private lastTowerBanner = 0;
  private trappedUntil = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly laserMat = new THREE.MeshBasicNodeMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.85, depthWrite: false });
  private readonly laserGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly glintTex = glintTexture();
  private readonly glintMat = new THREE.SpriteNodeMaterial({ map: this.glintTex, color: 0xfff1c4, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly bossGlintMat = new THREE.SpriteNodeMaterial({ map: this.glintTex, color: 0xff7a2a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly barBackMat = new THREE.SpriteNodeMaterial({ color: 0x151619, transparent: true, opacity: 0.8, depthWrite: false });
  private readonly barFillMat = new THREE.SpriteNodeMaterial({ color: 0xff6a13, depthWrite: false });
  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.hud.cardsOpen || e.repeat) return;
    const i = e.code === 'Digit1' ? 0 : e.code === 'Digit2' ? 1 : e.code === 'Digit3' ? 2 : -1;
    if (i >= 0 && i < this.offer.length) this.pick(i);
  };
  /** Dev and tests: stats for the e2e. */
  readonly stats = { hunters: 0, kills: 0, offers: 0, picks: 0, waves: 0, models: 0, greybox: 0, ended: 0, reason: 0, knocks: 0, selfRevives: 0 };

  constructor(deps: RaidClientDeps) {
    this.d = deps;
    this.laserGeo.translate(0, 0, -0.5);
    deps.scene.add(this.group);
    this.hud = new RaidHud(deps.ghud.element, deps.touch);
    this.hud.pick = (i) => this.pick(i);
    this.hud.ended = (again) => this.leave(again);
    deps.ghud.setMode('raid');
    window.addEventListener('keydown', this.onKey);
    void loadHunterArt().then((art) => {
      this.artTried = true;
      if (!art) return;
      this.art = art;
      // Swap every greybox hunter for its model.
      for (const [id, v] of this.views) {
        if (!isGreybox(v.look)) continue;
        const pos = v.look.object.position.clone();
        const yaw = v.look.object.rotation.y;
        v.look.dispose();
        v.look = createHunterLook(v.kind, art, isPhone());
        v.look.object.position.copy(pos);
        v.look.object.rotation.y = yaw;
        this.group.add(v.look.object);
        this.views.set(id, v);
      }
      for (const [id, tr] of this.traps) {
        tr.obj.removeFromParent();
        this.traps.delete(id);
      }
    });
  }

  /** Our cards changed (Msg.RaidOffer). */
  offered(cards: [number, number][], deadline: number): void {
    const was = this.offer.length > 0;
    this.offer = cards;
    this.offerDeadline = deadline;
    if (cards.length > 0) {
      this.stats.offers++;
      this.hud.offer(cards, deadline, this.d.touch && document.body.classList.contains('touch-ui'));
      if (document.pointerLockElement && this.d.touch && document.body.classList.contains('touch-ui')) document.exitPointerLock();
    } else if (was) {
      // Closed by the server (picked, or the timer picked one).
      setTimeout(() => this.offer.length === 0 && this.hud.offer([], 0, false), 450);
    }
  }

  private pick(i: number): void {
    if (i < 0 || i >= this.offer.length) return;
    const id = this.offer[i]![0];
    this.d.session.raidPick(i);
    this.hud.picked(i);
    this.stats.picks++;
    this.d.sound.cardPick();
    this.hud.say(t('Picked: {name}', { name: upgradeName(id) }), '', 1600);
  }

  /** Our own run numbers (Msg.RaidSelf): [maxHp, dmg%, armor%, regen, revive%, head%, lifesteal, kills, xp, ...cards]. */
  selfNumbers(data: number[]): void {
    this.self = data;
    const taken = data.slice(9);
    const counts = new Map<number, number>();
    for (const id of taken) counts.set(id, (counts.get(id) ?? 0) + 1);
    this.hud.selfLine([...counts].map(([id, n]) => `${upgradeName(id)}${n > 1 ? ` x${n}` : ''}`).join(' · '));
  }

  /** Health bar size: the max health from our upgrades. */
  get maxHp(): number {
    return this.self[0] ?? 100;
  }

  hunterKilled(kind: number, killerPid: number, head: boolean, at: [number, number, number]): void {
    this.stats.kills++;
    const s = this.d.session;
    const killer = s.playerByPid(killerPid);
    const mine = killerPid !== 0 && killerPid === s.mine?.pid;
    this.d.ghud.killFeed(killer?.name ?? '?', hunterName(kind), 'bagged', head, mine);
    this.tmp.set(at[0], at[1] + 1, at[2]);
    this.d.fx.toonPop(this.tmp, kind === HunterKind.Boss ? 2.5 : 1.2);
    if (kind === HunterKind.Boss) this.d.sound.waveClear();
  }

  event(ev: number, a: number, b: number): void {
    const now = performance.now();
    if (ev === RaidEvent.WaveStart) {
      this.stats.waves = Math.max(this.stats.waves, a);
      this.d.sound.horn(b === 1);
      if (b === 1) this.hud.say(t('Here comes the Big Hunter'), t('Wave {n}', { n: a }), 3200, 'boss');
      else this.hud.say(a === 1 ? t('Hunting season is open') : t('Wave {n}', { n: a }), a === 1 ? t('Defend the QoreChain Tower') : '', 2600);
    } else if (ev === RaidEvent.WaveClear) {
      this.d.sound.waveClear();
      this.hud.say(t('Wave {n} cleared', { n: a }), a < RAID.waves ? t('Pick an upgrade') : '', 2400);
    } else if (ev === RaidEvent.Whistle) {
      this.d.sound.whistle(this.tmp.set(a, 8, b));
      this.hud.say(t('The Big Hunter whistles for help!'), '', 2000, 'warn');
    } else if (ev === RaidEvent.TowerHit) {
      this.d.sound.towerKnock();
      this.hud.towerHit(now);
      if (now - this.lastTowerBanner > 9000) {
        this.lastTowerBanner = now;
        this.hud.say(t('The tower is under attack!'), '', 1800, 'warn');
      }
    } else if (ev === RaidEvent.Trapped) {
      const mine = a === this.d.session.mine?.pid;
      if (mine) this.trappedUntil = now + (RAID.rootTicks / 30) * 1000;
      const id = this.d.session.idOfPid(a);
      const p = id === this.d.session.sessionId ? this.d.session.me : null;
      if (p) this.d.sound.trapSnap(this.tmp.set(p.state.x, p.state.y, p.state.z));
      else this.d.sound.trapSnap();
    } else if (ev === RaidEvent.Repaired) {
      this.hud.say(t('The tower is patched up'), '', 1800);
    }
  }

  ended(data: number[]): void {
    this.stats.ended++;
    this.stats.reason = data[0] ?? 0;
    const v: RaidEndView = {
      reason: data[0] ?? 0, waves: data[1] ?? 0, kills: data[2] ?? 0, bossKills: data[3] ?? 0, revives: data[4] ?? 0, xp: data[5] ?? 0,
      xpBefore: data[6] ?? -1, xpAfter: data[7] ?? -1, runMs: data[10] ?? 0, bestWave: data[11] ?? 0, newBest: data[13] === 1, granted: data[14] === 1, failed: data[14] === 2,
    };
    // The second message (stored, or not saved) replaces the first one, never the other way round.
    if (this.endView && (this.endView.granted || this.endView.failed) && !v.granted && !v.failed) return;
    this.endView = v;
    this.offer = [];
    this.hud.showEnd(v, this.d.session.room.state.timeLeft);
    if (document.pointerLockElement) document.exitPointerLock();
    if (v.reason === 1) this.d.sound.victory();
  }

  /** The run's numbers for the menu (after the end, or when the room closed). */
  summary(again = false): RaidSummary {
    const v = this.endView;
    return { mode: 'raid', waves: v?.waves ?? 0, kills: v?.kills ?? 0, xp: v?.xp ?? 0, ...(again ? { again: true } : {}) };
  }

  private leave(again: boolean): void {
    this.d.exit(this.summary(again));
  }

  get endOpen(): boolean {
    return this.hud.endOpen;
  }

  get modal(): boolean {
    return this.hud.cardsOpen || this.hud.endOpen;
  }

  // ---- drawing ---------------------------------------------------------------

  private bar(): THREE.Sprite[] {
    const back = new THREE.Sprite(this.barBackMat);
    const fill = new THREE.Sprite(this.barFillMat);
    back.center.set(0, 0.5);
    fill.center.set(0, 0.5);
    back.scale.set(0.72, 0.09, 1);
    fill.scale.set(0.68, 0.055, 1);
    back.renderOrder = 10;
    fill.renderOrder = 11;
    back.visible = false;
    fill.visible = false;
    this.group.add(back, fill);
    return [back, fill];
  }

  private addView(id: string, h: Hunter): View {
    const look = createHunterLook(h.kind, this.art, isPhone());
    this.group.add(look.object);
    const [barBack, barFill] = this.bar();
    let laser: THREE.Mesh | null = null;
    let glint: THREE.Sprite | null = null;
    if (h.kind === HunterKind.Rifleman) {
      laser = new THREE.Mesh(this.laserGeo, this.laserMat);
      laser.visible = false;
      laser.frustumCulled = false;
      this.group.add(laser);
    }
    if (h.kind !== HunterKind.Dog && h.kind !== HunterKind.Decoy) {
      glint = new THREE.Sprite(h.kind === HunterKind.Boss ? this.bossGlintMat : this.glintMat);
      glint.visible = false;
      this.group.add(glint);
    }
    const v: View = { look, kind: h.kind, lastAct: -1, lastHp: h.hp, px: h.x, pz: h.z, speed: 0, laser, glint, barBack: barBack!, barFill: barFill!, goneAt: 0 };
    if (isGreybox(look)) this.stats.greybox++;
    else this.stats.models++;
    this.views.set(id, v);
    return v;
  }

  private dropView(v: View): void {
    v.look.dispose();
    v.laser?.removeFromParent();
    v.glint?.removeFromParent();
    v.barBack.removeFromParent();
    v.barFill.removeFromParent();
  }

  /** Every frame, before the render. */
  frame(dt: number, myPos: THREE.Vector3): void {
    const st = this.d.session.room.state;
    const cam = this.d.camera.position;
    const now = performance.now();
    // Hunters gone from the state finish their defeat, then go.
    for (const [id, v] of this.views) {
      if (st.hunters.has(id)) continue;
      if (!v.goneAt) v.goneAt = now;
      v.look.update(dt, HunterAct.Down, 0, 0, cam.distanceTo(v.look.object.position));
      v.barBack.visible = false;
      v.barFill.visible = false;
      if (v.laser) v.laser.visible = false;
      if (v.glint) v.glint.visible = false;
      if (now - v.goneAt > 900) {
        this.dropView(v);
        this.views.delete(id);
      }
    }
    let n = 0;
    for (const [id, h] of st.hunters) {
      const v = this.views.get(id) ?? this.addView(id, h);
      const p = this.d.session.hunterPose(id);
      if (!p) continue;
      if (h.act !== HunterAct.Down) n++;
      const o = v.look.object;
      const sp = Math.hypot(p.x - v.px, p.z - v.pz) / Math.max(1e-3, dt);
      v.speed += (Math.min(9, sp) - v.speed) * Math.min(1, dt * 8);
      v.px = p.x;
      v.pz = p.z;
      o.position.set(p.x, p.y, p.z);
      o.rotation.y = p.yaw;
      const dist = cam.distanceTo(o.position);
      v.look.update(dt, h.act, v.speed, p.pitch, dist);
      if (h.hp < v.lastHp && h.act !== HunterAct.Down) v.look.hit();
      v.lastHp = h.hp;
      if (h.act !== v.lastAct) {
        if (h.act === HunterAct.Whistle) this.d.sound.whistle(o.position);
        v.lastAct = h.act;
      }
      this.telegraph(v, h, p.yaw, p.pitch);
      // Health bar: once hurt, and close enough to matter.
      const hurt = h.hp < 255 && h.act !== HunterAct.Down && dist < 60;
      v.barBack.visible = hurt;
      v.barFill.visible = hurt;
      if (hurt) {
        v.look.headTop(this.tmp);
        const w = h.kind === HunterKind.Boss ? 1.2 : 0.72;
        v.barBack.scale.set(w, 0.09, 1);
        v.barFill.scale.set((w - 0.04) * (h.hp / 255), 0.055, 1);
        v.barBack.position.copy(this.tmp).add(this.tmp2.set(-w / 2, 0, 0).applyQuaternion(this.d.camera.quaternion));
        v.barFill.position.copy(v.barBack.position).add(this.tmp2.set(0.02, 0, 0).applyQuaternion(this.d.camera.quaternion));
      }
    }
    this.stats.hunters = n;
    this.frameTraps(st);
    this.frameDrops(st, now);
    this.frameMarkers(myPos);
  }

  /** The rifleman's laser and glint while it aims, the boss's wind-up glint; a trapper's gun glints too. */
  private telegraph(v: View, h: Hunter, yaw: number, pitch: number): void {
    const aiming = h.act === HunterAct.Aim;
    if (v.glint) {
      v.glint.visible = aiming;
      if (aiming) {
        v.look.muzzle(this.tmp);
        v.glint.position.copy(this.tmp);
        const pulse = 0.35 + Math.abs(Math.sin(performance.now() / 70)) * (h.kind === HunterKind.Boss ? 0.6 : 0.35);
        v.glint.scale.setScalar(h.kind === HunterKind.Boss ? pulse * 1.6 : pulse);
      }
    }
    if (!v.laser) return;
    v.laser.visible = aiming;
    if (!aiming) return;
    const from = v.look.muzzle(this.tmp);
    const cp = Math.cos(pitch);
    const dir = this.tmp2.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    const sim = this.d.sim;
    const hit = sim.world.castRay(new sim.rapier.Ray(from, dir), LASER_RANGE, true, undefined, OPAQUE_QUERY_GROUPS);
    let len = hit ? hit.timeOfImpact : LASER_RANGE;
    // The dot ends on the duck it points at (us or a friend), so you can see who is targeted.
    for (const d of this.ducksDrawn()) {
      const h = rayHitbox(from.x, from.y, from.z, dir.x, dir.y, dir.z, d, len);
      if (h) len = h.t;
    }
    v.laser.position.copy(from);
    v.laser.lookAt(from.x + dir.x, from.y + dir.y, from.z + dir.z);
    v.laser.rotateY(Math.PI);
    v.laser.scale.set(0.018, 0.018, len);
  }

  private frameTraps(st: Session['room']['state']): void {
    for (const [id, tr] of this.traps) {
      if (st.traps.has(id)) continue;
      if (tr.state === 2) this.d.fx.toonPop(tr.obj.position, 0.8, false);
      tr.obj.removeFromParent();
      this.traps.delete(id);
    }
    for (const [id, e] of st.traps) {
      let tr = this.traps.get(id);
      if (!tr) {
        const obj = new THREE.Group();
        let open: THREE.Object3D;
        let sprung: THREE.Object3D;
        if (this.art?.trapOpen && this.art.trapSprung) {
          open = this.art.trapOpen.clone();
          sprung = this.art.trapSprung.clone();
        } else {
          open = new THREE.Group();
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 6, 20), toonMaterial(0xff6a13));
          ring.rotation.x = Math.PI / 2;
          ring.position.y = 0.05;
          const net = new THREE.Mesh(new THREE.CircleGeometry(0.52, 14), toonMaterial(0x6b5a3a));
          net.rotation.x = -Math.PI / 2;
          net.position.y = 0.03;
          open.add(ring, net);
          sprung = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.9, 10, 1, true), toonMaterial(0x6b5a3a));
          sprung.position.y = 0.95;
        }
        open.position.set(0, 0, 0);
        sprung.position.y = sprung.position.y || 0;
        obj.add(open, sprung);
        obj.position.set(e.x, e.y, e.z);
        this.group.add(obj);
        tr = { obj, open, sprung, state: -1 };
        this.traps.set(id, tr);
      }
      if (tr.state !== e.state) {
        tr.state = e.state;
        tr.open.visible = e.state !== 2;
        tr.sprung.visible = e.state === 2;
        // Being set: half size; armed: full.
        tr.open.scale.setScalar(e.state === 0 ? 0.6 : 1);
      }
    }
  }

  private frameDrops(st: Session['room']['state'], now: number): void {
    for (const [id, o] of this.drops) {
      if (st.raidDrops.has(id)) continue;
      o.removeFromParent();
      this.drops.delete(id);
    }
    for (const [id, e] of st.raidDrops) {
      let o = this.drops.get(id);
      if (!o) {
        const g = new THREE.Group();
        if (e.kind === RaidDrop.Heal) {
          const mat = toonMaterial(0x67e8b0);
          const a = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.11, 0.11), mat);
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.34, 0.11), mat);
          g.add(a, b);
        } else {
          g.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.2), toonMaterial(0xffd43b)));
          const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.05, 0.21), toonMaterial(0x151619));
          g.add(stripe);
        }
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.025, 6, 20), new THREE.MeshBasicNodeMaterial({ color: e.kind === RaidDrop.Heal ? 0x67e8b0 : 0xffd43b }));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = -0.4;
        g.add(ring);
        g.position.set(e.x, e.y, e.z);
        this.group.add(g);
        o = g;
        this.drops.set(id, g);
      }
      o.position.y = e.y + Math.sin(now / 400 + id.length) * 0.08;
      o.children[0]!.rotation.y = now / 600;
      if (o.children[1]) o.children[1].rotation.y = now / 600;
    }
  }

  /** Markers on screen: hunters at the tower, and every hunter once a wave is down to its last three. */
  private frameMarkers(myPos: THREE.Vector3): void {
    const st = this.d.session.room.state;
    const showAll = st.raid.stage === RaidStage.Wave && st.raid.left <= 3;
    const want = new Set<string>();
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    for (const [id, h] of st.hunters) {
      if (h.act === HunterAct.Down) continue;
      const atTower = h.act === HunterAct.Hammer;
      if (!atTower && !showAll) continue;
      const v = this.views.get(id);
      if (!v) continue;
      this.tmp.copy(v.look.object.position);
      this.tmp.y += 1.2;
      if (this.tmp.distanceTo(myPos) < 6) continue;
      this.tmp.project(this.d.camera);
      const behind = this.tmp.z > 1;
      let x = (this.tmp.x * 0.5 + 0.5) * w;
      let y = (-this.tmp.y * 0.5 + 0.5) * hgt;
      const edge = behind || x < 20 || x > w - 20 || y < 20 || y > hgt - 20;
      if (behind) {
        x = w - x;
        y = hgt - 24;
      }
      x = Math.max(20, Math.min(w - 20, x));
      y = Math.max(20, Math.min(hgt - 20, y));
      want.add(id);
      let m = this.markers.get(id);
      if (!m) {
        m = document.createElement('div');
        this.hud.markers.append(m);
        this.markers.set(id, m);
      }
      m.className = `raid-marker${atTower ? ' tower' : ''}${edge ? ' edge' : ''}`;
      m.style.left = `${x}px`;
      m.style.top = `${y}px`;
    }
    for (const [id, m] of this.markers) {
      if (want.has(id)) continue;
      m.remove();
      this.markers.delete(id);
    }
  }

  /** The HUD, a few times a second is plenty but it is cheap: every frame. */
  hudFrame(): void {
    const s = this.d.session;
    const st = s.room.state;
    const r = st.raid;
    const now = performance.now();
    const serverNow = s.room.clock.serverNow();
    const counting = r.stage === RaidStage.Lobby || r.stage === RaidStage.Break;
    const secs = counting ? Math.max(0, (r.ends - serverNow) / 1000) : r.stage === RaidStage.Wave ? Math.max(0, (serverNow - r.waveAt) / 1000) : 0;
    const nextWave = r.stage === RaidStage.Break ? r.wave + 1 : r.wave;
    this.hud.bar(nextWave, isBossWave(nextWave), counting && r.ends > 0 ? Math.ceil(secs) : secs, counting, r.left, r.stage === RaidStage.Wave);
    this.hud.tower(r.towerHp, r.towerMax, now);
    this.hud.bossBar(r.bossHp, r.bossMax);
    this.hud.cardsFrame(serverNow);
    this.hud.frame(now);
    if (r.stage !== this.lastStage) {
      this.lastStage = r.stage;
      if (r.stage !== RaidStage.Break && this.offer.length === 0) this.hud.offer([], 0, false);
    }
    if (r.stage === RaidStage.Lobby) this.hud.idle(r.ends > 0 ? t('The hunt starts in {n}', { n: Math.ceil(secs) }) : t('Waiting for ducks'), t('Hold the tower. Friends can still join.'));
    else if (r.stage === RaidStage.Break && !this.hud.cardsOpen) this.hud.idle(t('Next wave in {n}', { n: Math.ceil(secs) }), '');
    else this.hud.idle('', '');
    if (this.hud.endOpen) this.hud.endCountdown(st.timeLeft);
    // Our own state: knocked, out, caught in a trap.
    const mine = s.mine;
    const me = s.me;
    if (mine && me && !this.hud.endOpen) {
      if (mine.alive === 0 && r.stage === RaidStage.Wave) {
        const w = mine.watch ? s.playerByPid(mine.watch) : null;
        this.hud.noteLine(t('You are out until the next break.'), w ? t('You are out until the next break. Watching {name}.', { name: w.name }) : '');
      } else if (me.state.down === 1) {
        const bleed = `${Math.ceil((me.state.hp / KNOCK.hp) * KNOCK.bleedSeconds)} s`;
        const touch = document.body.classList.contains('touch-ui');
        // Alone in the run: a second wind (once a wave), else a friend revives you.
        const hint = r.ducks === 1 ? (touch ? t('Hold Use to get back up (once a wave).') : t('Hold E to get back up (once a wave).')) : t('A friend holds E next to you to revive you.');
        const self = s.mate(s.sessionId);
        const rev = self && self.rev > 0 ? ` ${Math.round((self.rev / 255) * 100)}%` : '';
        this.hud.noteLine(t('Down!'), `${hint}${rev} ${bleed}`);
      } else if (now < this.trappedUntil) this.hud.noteLine(t('Caught in a trap!'), t('Shoot the trap or wait it out'));
      else this.hud.noteLine(null);
    }
  }

  private readonly duckList: HitTarget[] = [];

  /** Every duck as drawn (us predicted, friends interpolated): where the lasers stop. */
  private ducksDrawn(): HitTarget[] {
    const out = this.duckList;
    out.length = 0;
    const s = this.d.session;
    const me = s.me;
    if (me && me.state.alive) out.push({ id: s.sessionId, x: me.value('x'), y: me.value('y'), z: me.value('z'), crouch: me.state.crouch });
    for (const id of s.remotes.keys()) {
      const p = s.pose(id);
      if (p) out.push({ id, x: p.x, y: p.y, z: p.z, crouch: p.crouch > 0.5 ? 1 : 0 });
    }
    return out;
  }

  /** The hunters as drawn, nearest first (the dev test hook reads it). */
  huntersDrawn(): { id: string; kind: number; act: number; x: number; y: number; z: number; dist: number }[] {
    const s = this.d.session;
    const me = s.me;
    if (!me) return [];
    const out = [];
    for (const [id, h] of s.room.state.hunters) {
      const p = s.hunterPose(id);
      if (p) out.push({ id, kind: h.kind, act: h.act, x: p.x, y: p.y, z: p.z, dist: Math.hypot(p.x - me.state.x, p.z - me.state.z) });
    }
    return out.sort((a, b) => a.dist - b.dist);
  }

  /** The touch Use button: a knocked friend in reach, or our own second wind. */
  touchPrompt(): string {
    const s = this.d.session;
    const me = s.me;
    const st = s.room.state;
    if (!me || st.raid.stage !== RaidStage.Wave) return '';
    if (me.state.down === 1) return st.raid.ducks === 1 ? 'E' : '';
    for (const [id, m] of st.mates) {
      if (id === s.sessionId || m.down !== 1) continue;
      const p = s.pose(id);
      if (p && Math.hypot(p.x - me.state.x, p.z - me.state.z) < KNOCK.reviveRange + 1) return 'E';
    }
    return '';
  }

  /** While we are out (dead in a wave): the camera follows a friend. True when it placed the camera. */
  placeCamera(dt: number): boolean {
    const s = this.d.session;
    const mine = s.mine;
    if (!mine || mine.alive === 1 || !mine.watch) return false;
    const id = s.idOfPid(mine.watch);
    const p = id ? s.pose(id) : null;
    if (!p) return false;
    this.d.cam.update(dt, p.x, p.y, p.z, p.crouch, p.yaw, Math.max(-0.4, Math.min(0.4, p.pitch)), false);
    return true;
  }

  /** Hunters and traps as drawn, for our predicted shots (the server decides with its own rewound copy). */
  targets(): HitTarget[] {
    const out: HitTarget[] = [];
    const st = this.d.session.room.state;
    if (st.raid.stage !== RaidStage.Wave) return out;
    for (const [id, h] of st.hunters) {
      if (h.act === HunterAct.Down) continue;
      const p = this.d.session.hunterPose(id);
      if (p) out.push({ id, x: p.x, y: p.y, z: p.z, crouch: 0, yaw: p.yaw, shape: hunterShape(h.kind, h.act) });
    }
    for (const [id, e] of st.traps) if (e.state !== 2) out.push({ id, x: e.x, y: e.y, z: e.z, crouch: 0, yaw: 0, shape: TRAP_SHAPE });
    return out;
  }

  /** Is a predicted hit on this id a hunter (not a duck)? */
  isHunter(id: string): boolean {
    return this.d.session.room.state.hunters.has(id) || this.d.session.room.state.traps.has(id);
  }

  /** Dev autopilot: hunters as drawn, an open offer, and a knocked friend nearby. */
  autopilotView(): { hunters: SeenDuck[]; offer: number; knocked: { x: number; z: number } | null; tower: { x: number; z: number } } {
    const s = this.d.session;
    const hunters: SeenDuck[] = [];
    for (const [id, h] of s.room.state.hunters) {
      if (h.act === HunterAct.Down) continue;
      const p = s.hunterPose(id);
      if (p) hunters.push({ id, x: p.x, y: p.y + (h.kind === HunterKind.Dog ? -0.4 : h.kind === HunterKind.Boss ? 0.4 : 0), z: p.z });
    }
    let knocked: { x: number; z: number } | null = null;
    for (const [id, m] of s.room.state.mates) {
      if (id === s.sessionId || m.down !== 1) continue;
      const p = s.pose(id);
      if (p) knocked = { x: p.x, z: p.z };
    }
    return { hunters, offer: this.offer.length, knocked, tower: { x: RAID.tower.x, z: RAID.tower.z } };
  }

  /** Pick card `i`, exactly as a click or a key does (the dev autopilot uses it too). */
  pickCard(i: number): void {
    this.pick(i);
  }

  get artLoaded(): boolean {
    return this.art !== null;
  }

  get artChecked(): boolean {
    return this.artTried;
  }

  /** The decoy model for the explosives view, once the art is in. */
  get decoyModel(): THREE.Object3D | null {
    return this.art?.decoy ?? null;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    for (const v of this.views.values()) this.dropView(v);
    this.views.clear();
    for (const m of this.markers.values()) m.remove();
    this.group.removeFromParent();
    this.hud.dispose();
  }
}
