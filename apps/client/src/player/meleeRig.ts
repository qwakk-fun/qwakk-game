/**
 * The duck's katana on its avatar (Hunt Season): the blade in the right hand
 * or in the scabbard on its back, the melee clips layered over the
 * locomotion, and the trail ribbon behind the blade while it cuts. Driven by
 * the pose action (`Act.Katana` and up: the shared sim's blade state, the
 * same for our predicted duck and for friends from their pose), so a swing
 * starts on screen on the very tick the sim starts it.
 *
 * Without the art (no clips, the greybox blade) the swing is procedural: the
 * arm sweeps the blade across in front of the duck.
 */
import * as THREE from 'three/webgpu';
import { Act, gearAt } from '@qwakk/shared';
import type { MeleeArt } from './meleeArt.ts';
import { KatanaTrail } from './katanaTrail.ts';

/**
 * Which clip each pose action plays (full body unless noted), how fast, and
 * how much of the legs stays with the locomotion when standing (`lower`).
 * `split`: while the duck moves, the clip's upper body plays over the
 * running legs instead (the legs never stop to swing: no foot sliding, no
 * gait popping in and out on every cut).
 */
const CLIP: Record<number, { clip: string; loop?: boolean; speed?: number; upper?: boolean; split?: boolean; lower: number; then?: string }> = {
  [Act.Slash1]: { clip: 'Slash_1', speed: 1.1, lower: 0.25, split: true },
  [Act.Slash2]: { clip: 'Slash_2', speed: 1.1, lower: 0.25, split: true },
  [Act.Slash3]: { clip: 'Slash_3', speed: 1.0, lower: 0.15, split: true },
  [Act.Charge]: { clip: 'Heavy_Charge', loop: true, lower: 0.5, split: true },
  [Act.Heavy]: { clip: 'Heavy_Release', speed: 1.0, lower: 0.1 },
  [Act.Quack]: { clip: 'Quack_Shockwave', speed: 1.0, lower: 0 },
  // The sim's dash is 0.2 s; the clip 0.267 s.
  [Act.Dash]: { clip: 'Dash', speed: 1.33, lower: 0 },
  [Act.Storm]: { clip: 'Ultimate', speed: 1.0, lower: 0.4, split: true, then: 'Ultimate_Spin' },
  [Act.Draw]: { clip: 'Draw', speed: 1.6, upper: true, lower: 1 },
};

/**
 * Crossfade times (s): a clip coming in ramps up over a few frames (so a cut
 * still reads at once) while the one going out ramps down, both eased in and
 * out (smoothstep on a linear ramp: no jump on the first frame). Snapping a
 * new clip in at full weight jumped the blade 30 cm in one frame between the
 * finisher and the next combo's first cut.
 */
const FADE_IN = 0.06;
const FADE_OUT = 0.08;
/** Into a swing straight from another (the finisher into the next combo, a slash into the heavy): the poses lie far apart. */
const FADE_CHAIN = 0.11;

const smooth01 = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/**
 * The katana's tier looks (Hunt Season gear, `@qwakk/shared/duck` GEAR): the
 * Blade mesh alone gets a tinted copy of its material (the art's palette
 * times the tier's color) and the top tiers a glow. One material per tier and
 * source, shared by every duck: no new art, no per-frame cost.
 */
const tierMats = new WeakMap<THREE.Material, Map<number, THREE.Material>>();

function tierMaterial(base: THREE.Material, tier: number): THREE.Material {
  let byTier = tierMats.get(base);
  if (!byTier) tierMats.set(base, (byTier = new Map()));
  let m = byTier.get(tier);
  if (m) return m;
  const item = gearAt('katana', tier);
  const c = base.clone() as THREE.MeshToonNodeMaterial;
  if (item) {
    c.color = new THREE.Color(item.color).multiply((base as THREE.MeshToonNodeMaterial).color ?? new THREE.Color(0xffffff));
    if (item.glow) {
      c.emissive = new THREE.Color(item.glow);
      c.emissiveIntensity = 1;
    }
  }
  byTier.set(tier, (m = c));
  return m;
}

/** Acts that cut (the trail shows). */
const CUTS = new Set<number>([Act.Slash1, Act.Slash2, Act.Slash3, Act.Heavy, Act.Storm, Act.Dash]);

export class MeleeRig {
  readonly katana: THREE.Object3D;
  private readonly scabbard: THREE.Object3D | null;
  private readonly seat: THREE.Object3D | null;
  private readonly hand: THREE.Object3D | null;
  private readonly art: MeleeArt;
  private readonly trail: KatanaTrail;
  private readonly start: THREE.Object3D | null;
  private readonly end: THREE.Object3D | null;
  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly weights = new Map<THREE.AnimationAction, number>();
  /** This frame's wanted weights (reused: no allocation per frame). */
  private readonly target = new Map<THREE.AnimationAction, number>();
  /** Restarts of a melee clip (the animation test reads it). */
  restarts = 0;
  private lastAct = -1;
  /** The act now playing came straight out of another clip (a slower crossfade in). */
  private chained = false;
  private actT = 0;
  /** Hit-stop: the clips hold still for a moment when a cut lands (feel only). */
  private stopFor = 0;
  /** Procedural swing for the greybox (0..1 through the cut). */
  private swing = 0;
  private inHand = true;
  private tier = -1;
  private readonly blade: THREE.Mesh | null;
  private readonly bladeBase: THREE.Material | null;

  constructor(art: MeleeArt, root: THREE.Object3D, bones: { RightHand: THREE.Bone; Spine1?: THREE.Object3D } | null, scene: THREE.Object3D) {
    this.art = art;
    this.katana = art.katana.clone();
    this.katana.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    const blade = this.katana.getObjectByName('Blade') as THREE.Mesh | undefined;
    this.blade = blade?.isMesh ? blade : null;
    this.bladeBase = this.blade && !Array.isArray(this.blade.material) ? this.blade.material : null;
    this.start = this.katana.getObjectByName('TrailStart') ?? null;
    this.end = this.katana.getObjectByName('TrailEnd') ?? null;
    this.hand = bones?.RightHand ?? null;
    const m = art.manifest;
    if (art.scabbard && m && bones?.Spine1) {
      this.scabbard = art.scabbard.clone();
      const p = m.attach.scabbard;
      this.scabbard.position.fromArray(p.position);
      this.scabbard.quaternion.fromArray(p.quaternion);
      bones.Spine1.add(this.scabbard);
      this.seat = this.scabbard.getObjectByName('KatanaSeat') ?? null;
    } else {
      this.scabbard = null;
      this.seat = null;
    }
    this.trail = new KatanaTrail(scene);
    this.place(true, root);
  }

  /** The blade in the hand (true) or sheathed (the pistol is out). */
  private place(hand: boolean, root: THREE.Object3D): void {
    this.inHand = hand;
    const m = this.art.manifest;
    if (hand && this.hand && m) {
      this.hand.add(this.katana);
      this.katana.position.fromArray(m.attach.katana.position);
      this.katana.quaternion.fromArray(m.attach.katana.quaternion);
    } else if (!hand && this.seat) {
      this.seat.add(this.katana);
      this.katana.position.set(0, 0, 0);
      this.katana.quaternion.identity();
    } else if (hand) {
      // Greybox or no skeleton: in front of the chest, blade up and forward.
      root.add(this.katana);
      this.katana.position.set(0.28, 0.95, -0.25);
      this.katana.rotation.set(-0.9, 0, 0);
    } else {
      root.add(this.katana);
      this.katana.position.set(0.0, 0.9, 0.18);
      this.katana.rotation.set(0.4, 0, 0.6);
    }
  }

  /** Hunt Season gear: the katana's tier look (0 the bokken ... 4 the dragon fang). */
  setTier(tier: number): void {
    if (tier === this.tier || !this.blade || !this.bladeBase) return;
    this.tier = tier;
    this.blade.material = tierMaterial(this.bladeBase, tier);
  }

  /** The melee clips on the avatar's mixer (made on first use). */
  attachMixer(mixer: THREE.AnimationMixer | null): void {
    if (this.mixer === mixer) return;
    this.mixer = mixer;
    this.actions.clear();
    this.weights.clear();
  }

  private action(name: string): THREE.AnimationAction | null {
    let a = this.actions.get(name);
    if (a) return a;
    const clip = this.art.clips.get(name);
    if (!clip || !this.mixer) return null;
    a = this.mixer.clipAction(clip);
    a.setEffectiveWeight(0);
    a.play();
    this.actions.set(name, a);
    this.weights.set(a, 0);
    return a;
  }

  get hasClips(): boolean {
    return this.mixer !== null && this.art.clips.size > 0;
  }

  /** A cut landed (predicted for our duck): the clip holds for `seconds`. */
  hitStop(seconds: number): void {
    this.stopFor = Math.max(this.stopFor, seconds);
  }

  /**
   * Before the mixer updates: weights of the melee clips for this pose action
   * (`act`), the katana's place, and how much of the locomotion's lower body
   * stays (returned: 0 the clip owns the legs, 1 the legs keep walking).
   * `holding`: the katana is the weapon in hand.
   */
  blend(act: number, holding: boolean, speed: number, dt: number, root: THREE.Object3D, runPhase = -1): number {
    if (holding !== this.inHand) this.place(holding, root);
    const spec = CLIP[act];
    if (act !== this.lastAct) {
      this.chained = CLIP[this.lastAct] !== undefined && spec !== undefined;
      this.actT = 0;
      this.lastAct = act;
      if (spec) {
        // The whole clip and its upper half start together (the moving blend mixes them, in step).
        for (const name of spec.upper ? [`${spec.clip}@upper`] : spec.split ? [spec.clip, `${spec.clip}@upper`] : [spec.clip]) {
          const a = this.action(name);
          if (!a) continue;
          a.reset();
          a.setLoop(spec.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
          a.clampWhenFinished = !spec.loop;
          a.timeScale = spec.speed ?? 1;
          a.play();
          this.restarts++;
        }
      }
      this.swing = 0;
    } else this.actT += dt;
    // Hit-stop: hold every melee clip still a moment.
    const hold = this.stopFor > 0;
    this.stopFor = Math.max(0, this.stopFor - dt);
    const target = this.target;
    target.clear();
    let lower = 1;
    // 0 standing, 1 on the move: how much of a split swing plays over the running legs.
    const moving = smooth01((speed - 0.8) / 1.4);
    // The katana's carry pose: idle when slow, the run's arms (in step with the legs) when fast.
    let base = 0;
    if (spec) {
      let name = spec.upper ? `${spec.clip}@upper` : spec.clip;
      const a0 = this.actions.get(name);
      // The storm's opening flourish runs into the spin loop.
      let looped = false;
      if (spec.then && a0 && (!a0.isRunning() || a0.time >= a0.getClip().duration - 0.02)) {
        name = spec.then;
        looped = true;
        for (const n of [name, `${name}@upper`]) {
          const b = this.action(n);
          if (b && !b.isRunning()) b.reset().setLoop(THREE.LoopRepeat, Infinity).play();
        }
      }
      const split = !!spec.split && !spec.upper;
      const m = split ? moving : 0;
      const full = this.action(name);
      if (full) target.set(full, 1 - m);
      if (split) {
        const up = this.action(`${name}@upper`);
        if (up) {
          // The upper half follows the whole clip's time exactly (started together; the loop's halves too).
          if (looped && full) up.time = full.time;
          target.set(up, m);
        }
      }
      lower = split ? spec.lower + (1 - spec.lower) * m : spec.lower;
    } else if (act === Act.Katana || (holding && act < Act.Katana)) base = 1;
    const run = smooth01((speed - 2) / 2);
    const idle = this.action('Katana_Idle@upper');
    const runA = this.action('Katana_Run@upper');
    if (idle) {
      if (!idle.isRunning()) idle.play();
      target.set(idle, base * (1 - run));
    }
    if (runA) {
      if (!runA.isRunning()) runA.play();
      target.set(runA, base * run);
      // In step with the legs (melee.json: Katana_Run is Run_F's length; its time is the run's normalized time).
      if (runPhase >= 0) {
        runA.timeScale = 0;
        runA.time = runPhase * runA.getClip().duration;
      } else runA.timeScale = 1;
    }
    for (const [a, w] of this.weights) {
      const want = target.get(a) ?? 0;
      const step = dt / (this.chained ? FADE_CHAIN : want > w ? FADE_IN : FADE_OUT);
      const nw = want > w ? Math.min(want, w + step) : Math.max(want, w - step);
      this.weights.set(a, nw);
      a.setEffectiveWeight(smooth01(nw));
      a.paused = hold && a !== runA;
    }
    for (const [a] of target) if (!this.weights.has(a)) {
      // First use: fade in like any other.
      this.weights.set(a, 0);
      a.setEffectiveWeight(0);
    }
    if (!this.hasClips) this.greyboxSwing(act, dt);
    return lower;
  }

  /** Greybox: the blade sweeps across in front during a cut, spins in the storm. */
  private greyboxSwing(act: number, dt: number): void {
    if (this.hand && this.art.manifest) return;
    const k = this.katana;
    if (act === Act.Slash1 || act === Act.Slash2 || act === Act.Slash3 || act === Act.Heavy) {
      this.swing = Math.min(1, this.swing + dt * (act === Act.Heavy ? 2.2 : 3.2));
      const dir = act === Act.Slash2 ? -1 : 1;
      const a = (this.swing - 0.5) * (act === Act.Heavy ? Math.PI * 2 : 2.6) * dir;
      k.position.set(Math.sin(a) * 0.45, act === Act.Slash3 ? 1.4 - this.swing * 0.8 : 0.95, -Math.cos(a) * 0.45);
      k.rotation.set(-1.4, a, 0);
    } else if (act === Act.Storm) {
      const a = this.actT * 16;
      k.position.set(Math.sin(a) * 0.5, 0.85, -Math.cos(a) * 0.5);
      k.rotation.set(-1.5, a, 0);
    } else if (this.inHand) {
      k.position.set(0.28, 0.95, -0.25);
      k.rotation.set(-0.9, 0, 0);
    }
  }

  /** After the mixer and the skeleton update: the trail follows the blade's edge while it cuts. */
  frame(act: number, dt: number): void {
    const cutting = CUTS.has(act) && this.inHand;
    if (this.start && this.end) this.trail.sample(this.start, this.end, cutting, dt);
  }

  dispose(): void {
    this.trail.dispose();
    this.katana.removeFromParent();
    this.scabbard?.removeFromParent();
    for (const a of this.actions.values()) a.stop();
  }
}
