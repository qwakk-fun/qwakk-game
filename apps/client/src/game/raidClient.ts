/**
 * Hunt Season on the client (Pond Keep): draws what the server sends and
 * nothing more. Hunters (public room state, interpolated like near ducks)
 * as their models or the greybox, with their telegraphs (the rifleman's and
 * the sniper's laser and glint, the boss's wind-up glint) and a small health
 * bar, a raft under the ones paddling across the moat; traps; ammo and heal
 * drops; the keep's moving parts (game/raid/keepView.ts: the gate, the
 * drawbridge, the lever, the bread cannons and our cannon's aim arc);
 * markers for hunters at the gate or the core, aiming snipers and the last
 * few of a wave; the HUD (hud/raid/raidHud.ts) from the raid state and our
 * own messages (cards, our numbers, the end with the XP); the camera while
 * we are out (it follows a friend). The server decides every hit, loaf,
 * card and XP point; our own cannon shot is predicted for feel only.
 */
import * as THREE from 'three/webgpu';
import {
  BridgeState,
  Button,
  cannonInReach,
  exMan,
  exOcc,
  gateInReach,
  GateState,
  Act,
  bladeOut,
  DASH,
  dashTimer,
  Goal,
  HunterAct,
  HunterFx,
  HunterKind,
  hunterShape,
  isBladeDuck,
  KNOCK,
  QUACK,
  quackTimer,
  STORM,
  stormLeft,
  stormMeter,
  WeaponId,
  leverInReach,
  OPAQUE_QUERY_GROUPS,
  RAID,
  RaidStage,
  rayHitbox,
  syncKeepShields,
  TRAP_SHAPE,
  CRATE_SHAPE,
  groundHeightAt,
  TargetKind,
  type HitTarget,
  type KeepGeometry,
  type PlayerSim,
  type SimWorld,
} from '@qwakk/shared';
import { LeverDenied, RaidDrop, RaidEvent, RaidKillHow, type Hunter, type RaidTarget } from '@qwakk/shared/net';
import { BladeHud } from '../hud/raid/bladeHud.ts';
import { loadMeleeArt, meleeArt } from '../player/meleeArt.ts';
import type { Avatar } from '../player/avatar.ts';
import { BladeFeel } from './raid/bladeFeel.ts';
import { buildCamp, supplyCrate } from './raid/campDecor.ts';
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
import { KeepView } from './raid/keepView.ts';
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
  /** Under it while it paddles across the moat. */
  raft: THREE.Object3D | null;
  /** Gone from the state: kept a moment to finish its defeat, then faded. */
  goneAt: number;
  /** The glowing ring under an elite. */
  ring: THREE.Object3D | null;
}

const HUNTER_NAMES: Record<number, string> = {
  [HunterKind.Rifleman]: 'Rifleman', [HunterKind.Trapper]: 'Trapper', [HunterKind.Decoy]: 'Decoy thrower', [HunterKind.Dog]: 'Hunting dog', [HunterKind.Boss]: 'Big Hunter', [HunterKind.Sniper]: 'Sniper',
  [HunterKind.Beater]: 'Beater', [HunterKind.Recruit]: 'Recruit',
};

/** What each objective is called on the HUD and its banner (push.ts Goal). */
export const GOAL_TEXT: Record<number, { name: string; line: string }> = {
  [Goal.Trench]: { name: 'Clear the trench', line: 'Cut through the hunters around the south-east trench' },
  [Goal.Crates]: { name: 'Smash the supply crates', line: 'Their ammo is stacked by the dugouts' },
  [Goal.Towers]: { name: 'Take the watchtowers', line: 'Snipers on the towers: dash in, or use the pistol (2)' },
  [Goal.Camp]: { name: "Storm the Big Hunter's camp", line: 'Bring him down and the field is ours' },
};

export function hunterName(kind: number): string {
  return t(HUNTER_NAMES[kind] ?? 'Rifleman');
}

/** How far a laser is drawn (the sniper's reaches across the moat to the hills). */
const LASER_RANGE: Record<number, number> = { [HunterKind.Rifleman]: 75, [HunterKind.Sniper]: 175 };

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
  /** The katana's HUD and feel (Hunt Season v3). */
  readonly bladeHud: BladeHud;
  readonly feel: BladeFeel;
  private readonly d: RaidClientDeps;
  /** Objective markers (crates, towers, the camp) and the objective's ground. */
  private readonly targetsDrawn = new Map<string, { obj: THREE.Object3D; kind: number; done: number; bar: THREE.Sprite | null; marker: HTMLElement; frame?: (now: number) => void }>();
  private readonly goalMarker: HTMLElement;
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
  private lastCoreBanner = 0;
  private lastGateBanner = 0;
  private trappedUntil = 0;
  /** The keep's moving parts (null on a map without one). */
  readonly keep: KeepView | null;
  private readonly g: KeepGeometry | null;
  /** Our cannon shot, predicted for feel: when we last thumped, and the server's ready time we saw then. */
  private localFireAt = 0;
  private localFireReady = -1;
  private wasManning = 0;
  private lastRepairTap = 0;
  private readonly raftGeo = new THREE.BoxGeometry(1.6, 0.18, 2.2);
  private readonly raftMat = toonMaterial(0x9b6b3d);
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
  readonly stats = { hunters: 0, kills: 0, offers: 0, picks: 0, waves: 0, models: 0, greybox: 0, ended: 0, reason: 0, knocks: 0, selfRevives: 0, fired: 0, splashes: 0, bridgeMoves: 0, gateBroken: 0, gateFixed: 0, leverDenied: 0, overheats: 0, rafts: 0, snipers: 0, hMove: 0, hStall: 0, hJump: 0, cleared: 0, targetsDone: 0, elites: 0, minions: 0, peakHunters: 0 };

  constructor(deps: RaidClientDeps) {
    this.d = deps;
    this.laserGeo.translate(0, 0, -0.5);
    deps.scene.add(this.group);
    this.hud = new RaidHud(deps.ghud.element, deps.touch);
    this.hud.pick = (i) => this.pick(i);
    this.hud.ended = (again) => this.leave(again);
    deps.ghud.setMode('raid');
    this.bladeHud = new BladeHud(deps.ghud.element, deps.touch);
    this.goalMarker = document.createElement('div');
    this.goalMarker.className = 'raid-goal-marker';
    this.hud.markers.append(this.goalMarker);
    this.feel = new BladeFeel({
      scene: deps.scene,
      camera: deps.camera,
      cam: deps.cam,
      sound: deps.sound,
      fx: deps.fx,
      hud: this.bladeHud,
      art: () => meleeArt(),
      targets: () => this.targets(),
      hunterHit: (id, sec) => {
        const v = this.views.get(id);
        if (!v) return;
        v.look.hit();
        v.look.stop(sec);
      },
      hitStop: (sec) => this.equipped[0]?.hitStop(sec),
      myPos: () => this.myPos,
    });
    void loadMeleeArt().then((art) => {
      for (const a of this.equipped) a.enableMelee(art, deps.scene);
    });
    window.addEventListener('keydown', this.onKey);
    this.g = deps.sim.map.raid ?? null;
    this.keep = this.g ? new KeepView(deps.scene, deps.sim, this.g) : null;
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

  /** Our duck first, then friends: every avatar in the run carries the katana. */
  private readonly equipped: Avatar[] = [];
  private readonly myPos = new THREE.Vector3();
  /** The camera's view this frame (hunters off screen animate at a lower rate). */
  private readonly frustum = new THREE.Frustum();
  private readonly frustumM = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 1.6);

  /** Give an avatar its katana (now if the art is in, else when it loads). The first one is our own duck. */
  equip(avatar: Avatar): void {
    this.equipped.push(avatar);
    const art = meleeArt();
    if (art) avatar.enableMelee(art, this.d.scene);
  }

  unequip(avatar: Avatar): void {
    const i = this.equipped.indexOf(avatar);
    if (i > 0) this.equipped.splice(i, 1);
  }

  /** Our predicted katana did something (live steps only): the feel. */
  localBlade(kind: number, step: number, charge: number, state: PlayerSim): void {
    this.feel.local(kind, step, charge, state);
  }

  /** The server's hits (Msg.RaidHits): damage numbers and the combo. */
  hits(data: number[]): void {
    this.feel.hits(data, performance.now());
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

  private lastPopAt = 0;

  hunterKilled(kind: number, killerPid: number, head: boolean, at: [number, number, number], how: number = RaidKillHow.Shot): void {
    this.stats.kills++;
    const now = performance.now();
    const s = this.d.session;
    const killer = s.playerByPid(killerPid);
    const mine = killerPid !== 0 && killerPid === s.mine?.pid;
    // Minions fall by the dozen: they stay out of the kill feed (the damage numbers and the combo tell it).
    const minion = kind === HunterKind.Beater || kind === HunterKind.Recruit;
    if (!minion) this.d.ghud.killFeed(killer?.name ?? '?', hunterName(kind), how === RaidKillHow.Splash ? 'dunked' : 'bagged', head, mine);
    if (mine && how !== RaidKillHow.Splash) this.feel.kill(at[0], at[1], at[2], !minion);
    this.tmp.set(at[0], at[1] + 1, at[2]);
    if (how === RaidKillHow.Splash) {
      // Into the moat: a big splash where it stood (the moat is below the deck).
      this.stats.splashes++;
      this.tmp.y = at[1] - 1.5;
      this.d.fx.splash(this.tmp, 1.2);
      this.d.sound.splash(this.tmp);
    } else if (!minion || now - this.lastPopAt > 60) {
      // A horde falls in a heap: small pops for minions (and not more than one every few frames), bigger for elites.
      this.lastPopAt = now;
      this.d.fx.toonPop(this.tmp, kind === HunterKind.Boss ? 2.5 : minion ? 0.5 : 1.0, !minion);
    }
    if (kind === HunterKind.Boss) this.d.sound.waveClear();
  }

  /** A loaf left a cannon (Msg.Proj): that cannon kicks back and puffs (ours already did, predicted). */
  loafLaunched(ownerPid: number, at: [number, number, number]): void {
    const keep = this.keep;
    const g = this.g;
    if (!keep || !g) return;
    if (ownerPid !== 0 && ownerPid === this.d.session.mine?.pid && performance.now() - this.localFireAt < 1500) return;
    let best = 0;
    let bestD = Infinity;
    g.cannons.forEach((c, i) => {
      const d = Math.hypot(c.x - at[0], c.z - at[2]);
      if (d < bestD) {
        best = i;
        bestD = d;
      }
    });
    if (bestD > 6) return;
    this.puff(best);
  }

  /** A cannon fires: the barrel kicks, a puff of flour at the muzzle. */
  private puff(i: number): void {
    const at = this.keep?.fired(i, this.tmp);
    if (!at) return;
    this.d.fx.toonPop(at, 0.9, false);
    this.d.fx.crumbBurst(at, 0.35);
  }

  event(ev: number, a: number, b: number): void {
    const now = performance.now();
    const s = this.d.session;
    const byName = (pid: number): string => (pid ? (s.playerByPid(pid)?.name ?? '') : '');
    if (ev === RaidEvent.GoalStart) {
      this.stats.waves = Math.max(this.stats.waves, a);
      const g = GOAL_TEXT[b] ?? GOAL_TEXT[Goal.Trench]!;
      this.d.sound.horn(b === Goal.Camp);
      this.hud.say(t(g.name), a === 1 ? `${t('Hunting season is open')}. ${t(g.line)}` : t(g.line), 3400, b === Goal.Camp ? 'boss' : '');
    } else if (ev === RaidEvent.GoalClear) {
      this.stats.waves = Math.max(this.stats.waves, a);
      this.stats.cleared = Math.max(this.stats.cleared, a);
      this.d.sound.waveClear();
      this.hud.say(t('Objective taken!'), a < RAID.objectives ? t('The hunters flee. Pick an upgrade') : '', 2400);
    } else if (ev === RaidEvent.TargetDone) {
      this.stats.targetsDone++;
      this.d.sound.waveClear();
      this.hud.say(a === 1 ? t('Crate smashed!') : a === 2 ? t('Watchtower taken!') : t('Camp taken!'), '', 1600);
    } else if (ev === RaidEvent.Streak) {
      this.feel.streak(a, now);
    } else if (ev === RaidEvent.Whistle) {
      this.d.sound.whistle(this.tmp.set(a, 8, b));
      this.hud.say(t('The Big Hunter whistles for help!'), '', 2000, 'warn');
    } else if (ev === RaidEvent.CoreHit) {
      this.d.sound.coreKnock();
      this.hud.coreHit(now);
      if (now - this.lastCoreBanner > 9000) {
        this.lastCoreBanner = now;
        this.hud.say(t('The core is under attack!'), '', 1800, 'warn');
      }
    } else if (ev === RaidEvent.GateHit) {
      if (this.keep) this.d.sound.gateKnock(this.keep.gateAt(this.tmp));
      this.hud.gateHit(now);
      if (now - this.lastGateBanner > 12000 && a > 0) {
        this.lastGateBanner = now;
        this.hud.say(t('Hunters at the gate!'), t('Hold E at the gate to repair it'), 1800, 'warn');
      }
    } else if (ev === RaidEvent.GateBroken) {
      this.stats.gateBroken++;
      if (this.keep) {
        const at = this.keep.gateAt(this.tmp);
        this.d.sound.gateBreak(at);
        this.d.fx.toonPop(at, 2);
      }
      this.hud.say(t('The gate is broken!'), t('Hunters are coming in. Repair it to shut them out.'), 2600, 'warn');
    } else if (ev === RaidEvent.GateFixed) {
      this.stats.gateFixed++;
      const who = byName(a);
      this.hud.say(t('The gate holds again'), who ? t('Patched up by {name}', { name: who }) : '', 2000);
    } else if (ev === RaidEvent.Bridge) {
      this.stats.bridgeMoves++;
      if (this.keep) this.d.sound.chainRattle(this.keep.bridgeAt(this.tmp));
      if (this.g) this.d.sound.leverClunk(this.tmp.set(this.g.lever[0], this.g.lever[1] + 1, this.g.lever[2]));
      const who = byName(b);
      if (a === BridgeState.Raising) this.hud.say(t('Drawbridge up!'), t('Hunters must paddle across the moat'), 2000);
      else this.hud.say(t('Drawbridge coming down'), who ? '' : t('The chains slipped: it comes down by itself'), 1800);
    } else if (ev === RaidEvent.Splash) {
      const who = byName(b);
      this.hud.say(a === 1 ? t('Splash! A hunter went into the moat') : t('Splash! {n} hunters went into the moat', { n: a }), who ? t('Nice pull, {name}', { name: who }) : '', 2200);
    } else if (ev === RaidEvent.LeverDenied) {
      this.stats.leverDenied++;
      this.d.sound.deny();
      const why = a === LeverDenied.Cooldown ? t('The lever needs {n} s more', { n: b }) : a === LeverDenied.DuckOnBridge ? t('A duck is on the drawbridge') : t('The drawbridge is still moving');
      this.hud.say(why, '', 1400, 'warn');
    } else if (ev === RaidEvent.Overheat) {
      this.stats.overheats++;
      this.d.sound.overheatHiss();
      this.hud.say(t('The cannon overheated!'), t('Let it cool down'), 1500, 'warn');
    } else if (ev === RaidEvent.Trapped) {
      const mine = a === this.d.session.mine?.pid;
      if (mine) this.trappedUntil = now + (RAID.rootTicks / 30) * 1000;
      const id = this.d.session.idOfPid(a);
      const p = id === this.d.session.sessionId ? this.d.session.me : null;
      if (p) this.d.sound.trapSnap(this.tmp.set(p.state.x, p.state.y, p.state.z));
      else this.d.sound.trapSnap();
    } else if (ev === RaidEvent.CoreRepaired) {
      this.hud.say(t('The core is patched up'), '', 1800);
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
    // The combo, the call-outs and the damage numbers stop with the run (they would float over the end screen).
    this.bladeHud.root.hidden = true;
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

  /**
   * Once the art is in: a few minion looks made ahead, one a frame, so the
   * first packs do not clone a dozen skinned models in one frame (a hitch).
   */
  private prewarm(): void {
    if (!this.art) return;
    for (const [kind, want] of [[HunterKind.Beater, 10], [HunterKind.Recruit, 8], [HunterKind.Rifleman, 3]] as const) {
      const list = this.lookPool.get(kind) ?? [];
      if (this.warmed(kind) >= want) continue;
      const look = createHunterLook(kind, this.art, isPhone());
      look.reset();
      list.push(look);
      this.lookPool.set(kind, list);
      this.warmedCount.set(kind, (this.warmedCount.get(kind) ?? 0) + 1);
      return;
    }
  }

  private readonly warmedCount = new Map<number, number>();
  private warmed(kind: number): number {
    return this.warmedCount.get(kind) ?? 0;
  }

  /** Looks of gone hunters, by kind, to dress the next ones (a clone of a skinned model costs a few ms; a horde comes and goes). */
  private readonly lookPool = new Map<number, HunterLook[]>();

  private addView(id: string, h: Hunter): View {
    const pooled = this.lookPool.get(h.kind)?.pop();
    const look = pooled ?? createHunterLook(h.kind, this.art, isPhone());
    this.group.add(look.object);
    const [barBack, barFill] = this.bar();
    let laser: THREE.Mesh | null = null;
    let glint: THREE.Sprite | null = null;
    if (h.kind === HunterKind.Rifleman || h.kind === HunterKind.Sniper) {
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
    // Elites (every hunter that is not a minion or the boss) stand in a glowing ring.
    let ring: THREE.Object3D | null = null;
    if ((h.fx & HunterFx.Elite) !== 0) {
      const art = meleeArt()?.eliteRing ?? null;
      ring = art ? art.clone() : new THREE.Mesh(this.ringGeo, this.ringMat);
      ring.scale.setScalar(h.kind === HunterKind.Dog ? 1.1 : 1.35);
      this.group.add(ring);
      this.stats.elites++;
    } else if (h.kind === HunterKind.Beater || h.kind === HunterKind.Recruit) this.stats.minions++;
    const v: View = { look, kind: h.kind, lastAct: -1, lastHp: h.hp, px: h.x, pz: h.z, speed: 0, laser, glint, barBack: barBack!, barFill: barFill!, raft: null, goneAt: 0, ring };
    if (isGreybox(look)) this.stats.greybox++;
    else this.stats.models++;
    this.views.set(id, v);
    return v;
  }

  private readonly ringGeo = (() => {
    const g = new THREE.RingGeometry(0.5, 0.62, 32);
    g.rotateX(-Math.PI / 2);
    return g;
  })();
  private readonly ringMat = new THREE.MeshBasicNodeMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });

  private dropView(v: View, keep = false): void {
    v.ring?.removeFromParent();
    // Kept for the next hunter of its kind (models only; greybox ones are cheap and go when the art arrives).
    if (keep && !isGreybox(v.look)) {
      v.look.object.removeFromParent();
      v.look.reset();
      const list = this.lookPool.get(v.kind) ?? [];
      if (list.length < 24) {
        list.push(v.look);
        this.lookPool.set(v.kind, list);
      } else v.look.dispose();
    } else v.look.dispose();
    v.raft?.removeFromParent();
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
    this.myPos.copy(myPos);
    const c = this.d.camera;
    c.updateMatrixWorld();
    this.frustumM.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.frustumM);
    // Hunters gone from the state finish their defeat, then go.
    for (const [id, v] of this.views) {
      if (st.hunters.has(id)) continue;
      if (!v.goneAt) v.goneAt = now;
      v.look.update(dt, HunterAct.Down, 0, 0, cam.distanceTo(v.look.object.position));
      v.barBack.visible = false;
      v.barFill.visible = false;
      if (v.laser) v.laser.visible = false;
      if (v.glint) v.glint.visible = false;
      if (v.ring) v.ring.visible = false;
      if (now - v.goneAt > 900) {
        this.dropView(v, true);
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
      // Smoothness probe (perf:raid): a walking hunter drawn standing still for a frame, or jumping ahead, is a visible hitch.
      if ((h.act === HunterAct.Walk || h.act === HunterAct.Run) && v.speed > 1.5) {
        this.stats.hMove++;
        if (sp < v.speed * 0.25) this.stats.hStall++;
        else if (sp > Math.max(4, v.speed * 2.5)) this.stats.hJump++;
      }
      v.speed += (Math.min(9, sp) - v.speed) * Math.min(1, dt * 8);
      v.px = p.x;
      v.pz = p.z;
      o.position.set(p.x, p.y, p.z);
      o.rotation.y = p.yaw;
      if (v.ring) {
        v.ring.visible = h.act !== HunterAct.Down;
        v.ring.position.set(p.x, p.y + 0.04, p.z);
        v.ring.rotation.y = now / 900;
      }
      const dist = cam.distanceTo(o.position);
      this.sphere.center.set(p.x, p.y + 0.9, p.z);
      v.look.update(dt, h.act, v.speed, p.pitch, dist, this.frustum.intersectsSphere(this.sphere));
      if (h.hp < v.lastHp && h.act !== HunterAct.Down) v.look.hit();
      v.lastHp = h.hp;
      if (h.act !== v.lastAct) {
        if (h.act === HunterAct.Whistle) this.d.sound.whistle(o.position);
        v.lastAct = h.act;
      }
      this.telegraph(v, h, p.yaw, p.pitch);
      // Paddling across the moat: a raft under it.
      const rafting = h.act === HunterAct.Raft;
      if (rafting && !v.raft) {
        v.raft = new THREE.Mesh(this.raftGeo, this.raftMat);
        this.group.add(v.raft);
        this.stats.rafts++;
      }
      if (v.raft) {
        v.raft.visible = rafting;
        v.raft.position.set(p.x, p.y - 0.12 + Math.sin(now / 300 + v.px) * 0.04, p.z);
        v.raft.rotation.y = p.yaw;
      }
      if (h.kind === HunterKind.Sniper && h.act === HunterAct.Aim) this.stats.snipers++;
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
    this.stats.peakHunters = Math.max(this.stats.peakHunters, n);
    this.prewarm();
    this.frameTargets(st, now);
    this.frameGoal(myPos);
    const me = this.d.session.me;
    this.feel.frame(dt, !!me && stormLeft(me.state as unknown as PlayerSim) > 0, myPos, this.d.camera.rotation.y);
    this.frameTraps(st);
    this.frameDrops(st, now);
    this.frameMarkers(myPos);
    this.frameKeep(dt, now);
  }

  /** The cannon we man (index), or -1. */
  get manning(): number {
    const me = this.d.session.me;
    const m = me ? exMan(me.state as unknown as PlayerSim) : 0;
    return m > 0 ? m - 1 : -1;
  }

  /** The keep each frame, and our own cannon shot predicted for feel (the server fires the real loaf). */
  private frameKeep(dt: number, now: number): void {
    const s = this.d.session;
    const st = s.room.state;
    // Our world's bullet and sight shields follow the keep (tracers, hit markers, loaves and the aim arc meet what the server's do).
    if (st.raid.bridge !== this.shieldBridge || st.raid.gate !== this.shieldGate) {
      this.shieldBridge = st.raid.bridge;
      this.shieldGate = st.raid.gate;
      syncKeepShields(this.d.sim, st.raid.bridge, st.raid.gate);
    }
    const keep = this.keep;
    if (!keep) return;
    const me = s.me;
    const sim = me?.state as unknown as PlayerSim | undefined;
    const i = this.manning;
    const serverNow = s.room.clock.serverNow();
    let mine: { cannon: number; sim: PlayerSim; side: number } | null = null;
    if (me && sim && i >= 0) {
      // Our duck as drawn (predicted, its last step's look angles).
      const v = this.cannonSim;
      Object.assign(v, sim);
      v.x = me.value('x');
      v.y = me.value('y');
      v.z = me.value('z');

      mine = { cannon: i, sim: v, side: (sim.prevButtons & Button.ShoulderLeft) !== 0 ? -1 : 1 };
      const c = st.raid.cannons.get(String(i));
      const firing = (sim.prevButtons & Button.Fire) !== 0;
      // Ready by the last state we saw, not overheated, and the server has answered our last predicted shot (its ready time moved) or long ago.
      const answered = c ? c.ready !== this.localFireReady || now - this.localFireAt > 1200 : false;
      if (firing && c && c.hot === 0 && c.ready <= serverNow && answered && now - this.localFireAt > 250) {
        this.localFireAt = now;
        this.localFireReady = c.ready;
        this.stats.fired++;
        this.puff(i);
        this.d.sound.cannonThump();
        this.d.cam.kick(0.04, 0);
        this.d.cam.shake(0.05);
      }
    }
    if (i !== this.wasManning - 1) {
      if (i >= 0) this.hud.say(t('Bread cannon manned'), this.d.touch && document.body.classList.contains('touch-ui') ? t('Fire to lob a loaf where you aim') : t('Click to lob a loaf where you aim'), 1800);
      this.wasManning = i + 1;
    }
    keep.frame(dt, st.raid, serverNow, mine, this.d.camera.position);
  }

  private readonly cannonSim = {} as PlayerSim;
  /** The keep state our world's shields were last switched to (-1: not yet). */
  private shieldBridge = -1;
  private shieldGate = -1;

  /** The rifleman's laser and glint while it aims, the boss's wind-up glint; a trapper's gun glints too. */
  private telegraph(v: View, h: Hunter, yaw: number, pitch: number): void {
    const aiming = h.act === HunterAct.Aim;
    if (v.glint) {
      v.glint.visible = aiming;
      if (aiming) {
        v.look.muzzle(this.tmp);
        v.glint.position.copy(this.tmp);
        const pulse = 0.35 + Math.abs(Math.sin(performance.now() / 70)) * (h.kind === HunterKind.Boss ? 0.6 : 0.35);
        // A far sniper's glint grows with the distance so it reads from the walls.
        const far = h.kind === HunterKind.Sniper ? Math.max(1.5, this.d.camera.position.distanceTo(this.tmp) / 30) : 1;
        v.glint.scale.setScalar((h.kind === HunterKind.Boss ? pulse * 1.6 : pulse) * far);
      }
    }
    if (!v.laser) return;
    v.laser.visible = aiming;
    if (!aiming) return;
    const from = v.look.muzzle(this.tmp);
    const cp = Math.cos(pitch);
    const dir = this.tmp2.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    const sim = this.d.sim;
    const range = LASER_RANGE[h.kind] ?? 75;
    const hit = sim.world.castRay(new sim.rapier.Ray(from, dir), range, true, undefined, OPAQUE_QUERY_GROUPS);
    let len = hit ? hit.timeOfImpact : range;
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

  /**
   * Objective markers in the field: supply crates (a crate prop or a box,
   * with a health bar, gone in a pop of splinters when smashed), the
   * watchtowers and the camp (a pulsing beacon over each until taken).
   */
  private frameTargets(st: Session['room']['state'], now: number): void {
    for (const [id, d] of this.targetsDrawn) {
      if (st.raidTargets.has(id)) continue;
      d.obj.removeFromParent();
      d.marker.remove();
      this.targetsDrawn.delete(id);
    }
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    for (const [id, e] of st.raidTargets) {
      let d = this.targetsDrawn.get(id);
      if (!d) {
        const obj = new THREE.Group();
        let bar: THREE.Sprite | null = null;
        let frame: ((now: number) => void) | undefined;
        if (e.kind === TargetKind.Crate) {
          // The kit's large crate with a blaze band (the hunters' supplies); a box until it loads.
          const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 0.9), toonMaterial(0x8b5a2b));
          box.position.y = 0.45;
          box.castShadow = true;
          const band = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.12, 0.94), toonMaterial(0xff6a13));
          band.position.y = 0.6;
          obj.add(box, band);
          void supplyCrate().then((c) => {
            if (!c) return;
            box.removeFromParent();
            c.scale.setScalar(0.9);
            obj.add(c);
          });
          bar = new THREE.Sprite(this.barFillMat);
          bar.center.set(0, 0.5);
          obj.add(bar);
        } else if (e.kind === TargetKind.Camp) {
          const sim = this.d.sim;
          const camp = buildCamp(obj, 0, 0, 0, (x, z) => groundHeightAt(sim, e.x + x, e.y + 20, e.z + z) - e.y);
          frame = camp.frame;
        }
        obj.position.set(e.x, e.y, e.z);
        this.group.add(obj);
        const marker = document.createElement('div');
        marker.className = `raid-target-marker kind-${e.kind}`;
        this.hud.markers.append(marker);
        d = { obj, kind: e.kind, done: -1, bar, marker, frame };
        this.targetsDrawn.set(id, d);
      }
      if (d.done !== e.done) {
        if (d.done === 0 && e.done === 1 && e.kind === TargetKind.Crate) {
          this.tmp.set(e.x, e.y + 0.6, e.z);
          this.d.fx.toonPop(this.tmp, 1.8);
          this.d.fx.crumbBurst(this.tmp, 1.2);
        }
        d.done = e.done;
        d.obj.visible = e.done === 0 || e.kind === TargetKind.Camp;
      }
      d.frame?.(now);
      if (d.bar) {
        const f = e.hp / 255;
        d.bar.visible = f < 1 && e.done === 0;
        d.bar.scale.set(1.1 * f, 0.09, 1);
        d.bar.position.set(-0.55, 1.35, 0);
      }
      // The beacon on screen while it stands.
      this.tmp.set(e.x, e.y + (e.kind === TargetKind.Tower ? 7 : 2.2), e.z).project(this.d.camera);
      const behind = this.tmp.z > 1;
      d.marker.hidden = e.done === 1 || behind;
      if (!d.marker.hidden) {
        d.marker.style.left = `${Math.max(16, Math.min(w - 16, (this.tmp.x * 0.5 + 0.5) * w))}px`;
        d.marker.style.top = `${Math.max(16, Math.min(hgt - 16, (-this.tmp.y * 0.5 + 0.5) * hgt))}px`;
        d.marker.style.opacity = String(0.75 + Math.sin(now / 260) * 0.25);
      }
    }
  }

  /** The objective's ground: a marker on screen (or at the edge, pointing to it) with its distance. */
  private frameGoal(myPos: THREE.Vector3): void {
    const r = this.d.session.room.state.raid;
    const m = this.goalMarker;
    if (r.stage !== RaidStage.Fight || r.goal === 0 || this.targetsDrawn.size > 0) {
      m.hidden = true;
      return;
    }
    const dist = Math.hypot(r.gx - myPos.x, r.gz - myPos.z);
    m.hidden = dist < 14;
    if (m.hidden) return;
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    this.tmp.set(r.gx, myPos.y + 3, r.gz).project(this.d.camera);
    const behind = this.tmp.z > 1;
    let x = (this.tmp.x * 0.5 + 0.5) * w;
    let y = (-this.tmp.y * 0.5 + 0.5) * hgt;
    if (behind) {
      x = w - x;
      y = hgt - 40;
    }
    m.style.left = `${Math.max(24, Math.min(w - 24, x))}px`;
    m.style.top = `${Math.max(24, Math.min(hgt - 24, y))}px`;
    m.textContent = `${Math.round(dist)} m`;
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

  /** Markers on screen: hunters hammering the gate or the core, aiming snipers, and every hunter once a wave is down to its last three. */
  private frameMarkers(myPos: THREE.Vector3): void {
    const st = this.d.session.room.state;
    const showAll = st.raid.stage === RaidStage.Fight && st.raid.left <= 3;
    const want = new Set<string>();
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    for (const [id, h] of st.hunters) {
      if (h.act === HunterAct.Down) continue;
      const atTower = h.act === HunterAct.Hammer;
      // An aiming sniper is always marked: a long shot must read from anywhere on the walls.
      const sniping = h.kind === HunterKind.Sniper && h.act === HunterAct.Aim;
      if (!atTower && !showAll && !sniping) continue;
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
      m.className = `raid-marker${atTower ? ' tower' : ''}${sniping ? ' sniper' : ''}${edge ? ' edge' : ''}`;
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
    const secs = counting ? Math.max(0, (r.ends - serverNow) / 1000) : r.stage === RaidStage.Fight ? Math.max(0, (serverNow - r.waveAt) / 1000) : 0;
    const g = GOAL_TEXT[r.goal];
    const fighting = r.stage === RaidStage.Fight;
    this.hud.goal(r.wave, fighting && g ? t(g.name) : '', fighting ? r.gDone : 0, fighting ? r.gNeed : 0, counting && r.ends > 0 ? Math.ceil(secs) : secs, counting, r.left, fighting);
    // The castle's parts only while they matter: the gate once hunters hurt it, the drawbridge near the keep.
    const nearKeep = this.g ? Math.hypot(this.myPos.x - this.g.core.x, this.myPos.z - this.g.core.z) < 60 : false;
    this.hud.gate(r.gateHp, r.gateMax, r.gate, now, r.gateHp < r.gateMax);
    this.hud.bridge(nearKeep ? this.bridgeLine(serverNow) : '', r.bridge !== BridgeState.Down);
    const mySim = s.me?.state as unknown as PlayerSim | undefined;
    if (mySim && isBladeDuck(mySim) && s.mine?.alive === 1) {
      const storm = stormLeft(mySim);
      this.bladeHud.skillsFrame({ dash: dashTimer(mySim) / DASH.cooldown, quack: quackTimer(mySim) / QUACK.cooldown, meter: stormMeter(mySim) / STORM.meterFull, storm: storm / STORM.ticks, pistol: mySim.weapon === WeaponId.Pistol });
    } else this.bladeHud.skillsFrame(null);
    this.bladeHud.frame(1 / 60, this.d.camera, now, 3000);
    const i = this.manning;
    const c = i >= 0 ? r.cannons.get(String(i)) : undefined;
    this.hud.cannon(i >= 0 && !!c, (c?.heat ?? 0) / 255, (c?.hot ?? 0) === 1, (c?.ready ?? 0) <= serverNow, this.d.touch && document.body.classList.contains('touch-ui'));
    this.hud.prompt(r.stage === RaidStage.Won || r.stage === RaidStage.Lost || this.hud.cardsOpen ? '' : this.promptText());
    this.hud.bossBar(r.bossHp, r.bossMax);
    this.hud.cardsFrame(serverNow);
    this.hud.frame(now);
    if (r.stage !== this.lastStage) {
      this.lastStage = r.stage;
      if (r.stage !== RaidStage.Break && this.offer.length === 0) this.hud.offer([], 0, false);
    }
    if (r.stage === RaidStage.Lobby) this.hud.idle(r.ends > 0 ? t('The hunt starts in {n}', { n: Math.ceil(secs) }) : t('Waiting for ducks'), t('Katana drawn. Friends can still join.'));
    else if (r.stage === RaidStage.Break && !this.hud.cardsOpen) this.hud.idle(t('Next objective in {n}', { n: Math.ceil(secs) }), '');
    else this.hud.idle('', '');
    if (this.hud.endOpen) this.hud.endCountdown(st.timeLeft);
    // Our own state: knocked, out, caught in a trap.
    const mine = s.mine;
    const me = s.me;
    if (mine && me && !this.hud.endOpen) {
      if (mine.alive === 0 && r.stage === RaidStage.Fight) {
        const w = mine.watch ? s.playerByPid(mine.watch) : null;
        this.hud.noteLine(t('You are out until the next break.'), w ? t('You are out until the next break. Watching {name}.', { name: w.name }) : '');
      } else if (me.state.down === 1) {
        const bleed = `${Math.ceil((me.state.hp / KNOCK.hp) * KNOCK.bleedSeconds)} s`;
        const touch = document.body.classList.contains('touch-ui');
        // Alone in the run: a second wind (once a wave), else a friend revives you.
        const hint = r.ducks === 1 ? (touch ? t('Hold Use to get back up (once an objective).') : t('Hold E to get back up (once an objective).')) : t('A friend holds E next to you to revive you.');
        const self = s.mate(s.sessionId);
        const rev = self && self.rev > 0 ? ` ${Math.round((self.rev / 255) * 100)}%` : '';
        this.hud.noteLine(t('Down!'), `${hint}${rev} ${bleed}`);
      } else if (now < this.trappedUntil) this.hud.noteLine(t('Caught in a trap!'), t('Shoot the trap or wait it out'));
      else this.hud.noteLine(null);
    }
  }

  /** The drawbridge line of the HUD: where it is, when it comes down by itself, the lever's cooldown. */
  private bridgeLine(serverNow: number): string {
    const r = this.d.session.room.state.raid;
    const lever = r.leverReady > serverNow ? ` · ${t('lever {n} s', { n: Math.ceil((r.leverReady - serverNow) / 1000) })}` : ` · ${t('lever ready')}`;
    if (r.bridge === BridgeState.Up) {
      const down = r.bridgeDown > serverNow ? Math.ceil((r.bridgeDown - serverNow) / 1000) : 0;
      return `${t('Drawbridge up')} · ${t('down in {n} s', { n: down })}${lever}`;
    }
    if (r.bridge === BridgeState.Raising) return `${t('Drawbridge rising')}${lever}`;
    if (r.bridge === BridgeState.Lowering) return `${t('Drawbridge lowering')}${lever}`;
    return `${t('Drawbridge down')}${lever}`;
  }

  /** What the Use button does here: leave the cannon, man one, pull the lever, repair the gate. */
  private useAction(): 'leave' | 'cannon' | 'lever' | 'repair' | 'taken' | '' {
    const s = this.d.session;
    const me = s.me;
    const g = this.g;
    if (!me || !g || me.state.alive !== 1 || me.state.down === 1) return '';
    const sim = me.state as unknown as PlayerSim;
    if (exMan(sim) > 0) return 'leave';
    const x = me.value('x');
    const y = me.value('y');
    const z = me.value('z');
    const c = cannonInReach(g, x, y, z);
    if (c >= 0) return (exOcc(sim) & (1 << c)) !== 0 ? 'taken' : 'cannon';
    if (leverInReach(g, x, y, z)) return 'lever';
    const r = s.room.state.raid;
    if (gateInReach(g, x, y, z) && r.gateHp < r.gateMax && r.stage === RaidStage.Fight) return 'repair';
    return '';
  }

  private promptText(): string {
    const touch = this.d.touch && document.body.classList.contains('touch-ui');
    const key = touch ? t('Use') : 'E';
    switch (this.useAction()) {
      case 'cannon':
        return t('{key}: man the bread cannon', { key });
      case 'taken':
        return t('A friend mans this cannon');
      case 'lever': {
        const up = this.d.session.room.state.raid.bridge !== BridgeState.Down;
        return up ? t('{key}: lower the drawbridge', { key }) : t('{key}: raise the drawbridge', { key });
      }
      case 'repair':
        return t('Hold {key}: repair the gate', { key });
      default:
        return '';
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

  /** The touch Use button: a knocked friend in reach, our own second wind, or a keep control (a cannon, the lever, the gate). */
  touchPrompt(): string {
    const s = this.d.session;
    const me = s.me;
    const st = s.room.state;
    if (!me) return '';
    const act = this.useAction();
    if (act && act !== 'taken') return 'E';
    if (st.raid.stage !== RaidStage.Fight) return '';
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
    if (st.raid.stage !== RaidStage.Fight) return out;
    for (const [id, h] of st.hunters) {
      if (h.act === HunterAct.Down) continue;
      const p = this.d.session.hunterPose(id);
      if (p) out.push({ id, x: p.x, y: p.y, z: p.z, crouch: 0, yaw: p.yaw, shape: hunterShape(h.kind, h.act) });
    }
    for (const [id, e] of st.traps) if (e.state !== 2) out.push({ id, x: e.x, y: e.y, z: e.z, crouch: 0, yaw: 0, shape: TRAP_SHAPE });
    for (const [id, e] of st.raidTargets) if (e.kind === TargetKind.Crate && e.done === 0) out.push({ id, x: e.x, y: e.y, z: e.z, crouch: 0, yaw: 0, shape: CRATE_SHAPE });
    return out;
  }

  /** Is a predicted hit on this id a hunter (not a duck)? */
  isHunter(id: string): boolean {
    const st = this.d.session.room.state;
    return st.hunters.has(id) || st.traps.has(id) || st.raidTargets.has(id);
  }

  /** Dev autopilot: hunters as drawn, an open offer, and a knocked friend nearby. */
  autopilotView(): { hunters: SeenDuck[]; offer: number; knocked: { x: number; z: number } | null; home: { x: number; z: number }; core: { x: number; z: number; r: number }; rally: { x: number; z: number } | null; crates: { x: number; z: number }[]; gate: { x: number; z: number; nx: number; nz: number } | null } {
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
    // Home: inside the gate, a few meters back (the hunters come through it).
    const g = this.g;
    const home = g ? { x: g.gate.x - g.gate.nx * 7, z: g.gate.z - g.gate.nz * 7 } : { x: 0, z: 0 };
    const r = s.room.state.raid;
    const rally = r.stage === RaidStage.Fight && r.goal > 0 ? { x: r.gx, z: r.gz } : null;
    const crates: { x: number; z: number }[] = [];
    for (const e of s.room.state.raidTargets.values()) if (e.kind === TargetKind.Crate && e.done === 0) crates.push({ x: e.x, z: e.z });
    return { hunters, offer: this.offer.length, knocked, home, core: g ? { x: g.core.x, z: g.core.z, r: g.core.r } : { x: 0, z: 0, r: 1 }, rally, crates, gate: g ? { x: g.gate.x, z: g.gate.z, nx: g.gate.nx, nz: g.gate.nz } : null };
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
    this.feel.dispose();
    this.bladeHud.dispose();
    for (const d of this.targetsDrawn.values()) d.marker.remove();
    window.removeEventListener('keydown', this.onKey);
    this.keep?.dispose();
    for (const v of this.views.values()) this.dropView(v);
    this.views.clear();
    for (const list of this.lookPool.values()) for (const l of list) l.dispose();
    this.lookPool.clear();
    for (const m of this.markers.values()) m.remove();
    this.group.removeFromParent();
    this.hud.dispose();
  }
}
