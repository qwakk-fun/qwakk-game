/**
 * Turns shots, hits and kills into feedback: tracers, flashes, feathers,
 * splats, sounds, hit markers, camera kick and the kill feed.
 *
 * Own shots are predicted: the effects, the sound, the recoil and the hit
 * marker fire on the same frame as the click. Damage numbers and kills only
 * come from the server (no predicted kills).
 */
import * as THREE from 'three/webgpu';
import {
  resolveShot,
  ShotOutcome,
  Button,
  weaponStats,
  type HitTarget,
  type PlayerSim,
  type ShotFired,
  type SimWorld,
} from '@qwakk/shared';
import { KillWeapon, MatchPhase } from '@qwakk/shared/net';
import type { Sound } from '../audio/sound.ts';
import type { TpsCamera } from '../camera/tpsCamera.ts';
import type { Effects } from '../fx/effects.ts';
import type { GameHud } from '../hud/gameHud.ts';
import type { Session, SessionHandlers } from '../net/session.ts';
import type { Avatar } from '../player/avatar.ts';

export interface CombatViews {
  localAvatar: Avatar;
  remoteAvatar(id: string): Avatar | null;
  myPosition(): THREE.Vector3;
}

export interface CombatStats {
  shotsFired: number;
  predictedHits: number;
  confirmedHits: number;
  kills: number;
  deaths: number;
  tracers: number;
  featherBursts: number;
  lastMarkerAt: number;
  lastFeatherAt: number;
  lastTracerAt: number;
}

const WEAPON_NAMES = ['Rifle', 'Pistol'];

export class CombatFeedback {
  readonly stats: CombatStats = { shotsFired: 0, predictedHits: 0, confirmedHits: 0, kills: 0, deaths: 0, tracers: 0, featherBursts: 0, lastMarkerAt: 0, lastFeatherAt: 0, lastTracerAt: 0 };
  /** When the local player died (performance.now ms), or -1. */
  diedAt = -1;
  killerName = '';
  killerId: string | null = null;
  private lastPredictedMarker = 0;
  /** Local stand-in for the server's secret spread seed. */
  private readonly localSeed = (Math.random() * 0xffffffff) >>> 0;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly session: Session;
  private readonly sim: SimWorld;
  private readonly fx: Effects;
  private readonly sound: Sound;
  private readonly hud: GameHud;
  private readonly cam: TpsCamera;
  private readonly views: CombatViews;

  constructor(session: Session, sim: SimWorld, fx: Effects, sound: Sound, hud: GameHud, cam: TpsCamera, views: CombatViews) {
    this.session = session;
    this.sim = sim;
    this.fx = fx;
    this.sound = sound;
    this.hud = hud;
    this.cam = cam;
    this.views = views;
  }

  handlers(): Omit<SessionHandlers, 'shotHint' | 'picked' | 'denied' | 'result'> {
    return {
      localShot: (shot, state, buttons) => this.localShot(shot, state, buttons),
      shots: (list) => {
        for (const s of list) this.remoteShot(s.pid, s.weapon, s.outcome, s.from, s.to);
      },
      hitConfirm: (_victim, _damage, head, killed) => {
        this.stats.confirmedHits++;
        if (killed) {
          this.stats.kills++;
          this.hud.hitMarker('kill');
          this.sound.kill();
          this.views.localAvatar.quack();
          this.stats.lastMarkerAt = performance.now();
        } else if (performance.now() - this.lastPredictedMarker > 250) {
          // The prediction missed it (latency, spread): show the server's word.
          this.marker(head);
        }
      },
      damaged: (angle, damage) => {
        if (angle === null) {
          // The zone: a tint, no direction, no flinch.
          this.hud.zoneHurt();
          this.sound.hurt();
          return;
        }
        this.hud.damaged(angle);
        this.cam.shake(0.06 + damage * 0.004);
        this.sound.hurt();
        this.views.localAvatar.hitReact();
      },
      kill: (killerPid, victimPid, weapon, head, at) => {
        const killer = this.session.playerByPid(killerPid);
        const victim = this.session.playerByPid(victimPid);
        const myPid = this.session.mine?.pid ?? -1;
        const victimId = this.session.idOfPid(victimPid);
        const zone = killerPid === 0;
        const left = weapon === KillWeapon.Left;
        if (left) this.hud.killFeed(victim?.name ?? '?', '', 'left the pond', false, false);
        else this.hud.killFeed(zone ? 'The zone' : (killer?.name ?? '?'), victim?.name ?? '?', zone ? 'zone' : (WEAPON_NAMES[weapon] ?? ''), head, killerPid === myPid || victimPid === myPid);
        // The splat goes where the victim is drawn, not where the server had it.
        // No position (we could not see the victim) and nothing drawn: no splat.
        const avatar = victimId ? this.views.remoteAvatar(victimId) : null;
        let splat = !left;
        if (avatar && avatar.object.visible) this.a.copy(avatar.object.position);
        else if (victimPid === myPid) this.a.copy(this.views.myPosition());
        else if (at) this.a.set(at[0], at[1], at[2]);
        else splat = false;
        if (splat) {
          this.fx.killBurst(this.a);
          this.stats.featherBursts++;
          this.stats.lastFeatherAt = performance.now();
        }
        if (victimPid === myPid) {
          this.diedAt = performance.now();
          this.stats.deaths++;
          this.killerName = zone ? 'the zone' : (killer?.name ?? '');
          this.killerId = zone ? null : this.session.idOfPid(killerPid);
          this.sound.quack(undefined, 0.4);
        }
      },
    };
  }

  private marker(head: boolean): void {
    this.hud.hitMarker(head ? 'head' : 'hit');
    if (head) this.sound.headshot();
    else this.sound.hit();
    this.stats.lastMarkerAt = performance.now();
  }

  /** Own shot, predicted: resolve against the ducks as drawn on screen, show everything now. */
  private localShot(shot: ShotFired, state: PlayerSim, buttons: number): void {
    this.stats.shotsFired++;
    // Ducks that cannot take damage right now give no predicted hit (spawn protection, round over).
    // Warm-up and round breaks deal no damage: no predicted hit markers then.
    const playing = this.session.room.state.phase === MatchPhase.Playing;
    const targets: HitTarget[] = [];
    for (const [id, p] of this.session.remotes) {
      if (!p.alive || p.protect === 1 || !playing) continue;
      const pose = this.session.pose(id);
      if (pose) targets.push({ id, x: pose.x, y: pose.y, z: pose.z, crouch: pose.crouch > 0.5 ? 1 : 0 });
    }
    const side = buttons & Button.ShoulderLeft ? -1 : 1;
    // The server's spread seed includes a round secret, so this is our own guess at the random part of the
    // spread; the learnable pattern is exact. The server's result decides and is what others see.
    const r = resolveShot(this.sim, state, this.session.sessionId, side, shot, this.localSeed, targets);
    const avatar = this.views.localAvatar;
    avatar.fire();
    avatar.muzzleWorld(this.a);
    this.b.set(r.end.x, r.end.y, r.end.z);
    this.d.subVectors(this.b, this.a).normalize();
    this.fx.muzzleFlash(this.a, this.d, shot.weapon === 0 ? 1 : 0.7);
    this.fx.tracer(this.a, this.b, shot.weapon === 0 ? 0.03 : 0.022);
    this.stats.tracers++;
    this.stats.lastTracerAt = performance.now();
    this.sound.shot(shot.weapon);
    const w = weaponStats(shot.weapon);
    this.cam.kick(w.viewKick, (Math.random() - 0.5) * w.viewKick * 0.6);
    if (r.outcome === ShotOutcome.Body || r.outcome === ShotOutcome.Head) {
      this.stats.predictedHits++;
      this.lastPredictedMarker = performance.now();
      this.marker(r.outcome === ShotOutcome.Head);
      this.fx.feathersBurst(this.b, this.d, r.outcome === ShotOutcome.Head ? 14 : 9);
      this.stats.featherBursts++;
      this.stats.lastFeatherAt = performance.now();
    } else if (r.outcome === ShotOutcome.World) {
      this.fx.impact(this.b, this.d.clone().negate());
    }
  }

  /** Someone else's shot (server event): flash and tracer from their drawn gun, 3D sound. */
  private remoteShot(pid: number, weapon: number, outcome: number, from: number[], to: number[]): void {
    const id = this.session.idOfPid(pid);
    const avatar = id ? this.views.remoteAvatar(id) : null;
    if (avatar) {
      avatar.fire();
      avatar.muzzleWorld(this.a);
    } else this.a.set(from[0] ?? 0, from[1] ?? 0, from[2] ?? 0);
    this.b.set(to[0] ?? 0, to[1] ?? 0, to[2] ?? 0);
    this.d.subVectors(this.b, this.a).normalize();
    this.fx.muzzleFlash(this.a, this.d, weapon === 0 ? 1 : 0.7);
    this.fx.tracer(this.a, this.b, 0.025);
    this.sound.shot(weapon, this.a);
    if (outcome === ShotOutcome.Body || outcome === ShotOutcome.Head) {
      this.fx.feathersBurst(this.b, this.d, outcome === ShotOutcome.Head ? 12 : 7);
      this.stats.featherBursts++;
    } else if (outcome === ShotOutcome.World) {
      this.fx.impact(this.b, this.d.clone().negate());
      if (this.b.distanceTo(this.views.myPosition()) < 3) this.sound.impactNear(this.b);
    }
  }
}
