/** A bounded server replay, viewed over the killer's shoulder. */
import * as THREE from 'three/webgpu';
import { DM, type DmKillcam, type DmReplayPose, type SimWorld } from '@qwakk/shared';
import type { Avatar } from '../player/avatar.ts';
import { TpsCamera } from '../camera/tpsCamera.ts';

function interpolate(a: DmReplayPose, b: DmReplayPose, mix: number): DmReplayPose {
  const pose = { ...a };
  if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) < 8) {
    for (const field of ['x', 'y', 'z', 'pitch', 'crouch', 'aim'] as const) pose[field] += (b[field] - a[field]) * mix;
    pose.yaw += Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) * mix;
  }
  return pose;
}

export class DeathReplay {
  private replay: DmKillcam | null = null;
  private started = -1;
  private follow: TpsCamera | null = null;
  private cameraRestore: (() => void) | null = null;
  private readonly sim: SimWorld;

  constructor(sim: SimWorld) { this.sim = sim; }
  get active(): boolean { return this.replay !== null; }

  /** Respawn wins even if its state patch arrives before a delayed killcam. */
  syncLife(life: number): void {
    if (this.replay && life !== this.replay.victimLife) this.clear();
  }

  start(now: number, replay: DmKillcam): void {
    this.clear();
    if (replay.frames.length < 2) return;
    const last = replay.frames.at(-1)!;
    const frames = replay.frames.filter(f => f.at >= last.at - DM.replaySeconds * 1000).slice(-Math.ceil(DM.replaySeconds * DM.replayHz) - 2);
    if (frames.length < 2) return;
    this.replay = { ...replay, frames };
    this.started = now;
  }

  clear(): void {
    this.restoreCamera();
    this.replay = null;
    this.follow = null;
    this.started = -1;
  }

  /** Reuse the game's collision-aware TPS camera with recorded killer poses. */
  draw(now: number, camera: THREE.PerspectiveCamera, avatars: Iterable<[string, Avatar]>, dt: number): boolean {
    const replay = this.replay;
    if (!replay) return false;
    const first = replay.frames[0]!, last = replay.frames.at(-1)!;
    const at = first.at + now - this.started;
    if (at > last.at) { this.clear(); return false; }
    let index = 0;
    while (index + 1 < replay.frames.length && replay.frames[index + 1]!.at <= at) index++;
    const a = replay.frames[index]!, b = replay.frames[index + 1] ?? a;
    const mix = b.at > a.at ? (at - a.at) / (b.at - a.at) : 0;
    const killer = interpolate(a.killer, b.killer, mix), victim = interpolate(a.victim, b.victim, mix);
    const position = camera.position.clone(), rotation = camera.quaternion.clone(), fov = camera.fov;
    this.cameraRestore = () => { camera.position.copy(position); camera.quaternion.copy(rotation); camera.fov = fov; camera.updateProjectionMatrix(); };
    if (!this.follow) {
      this.follow = new TpsCamera(camera, this.sim);
      this.follow.setBaseFov(75);
    }
    this.follow.setAim(killer.aim, killer.weapon);
    this.follow.update(dt, killer.x, killer.y, killer.z, killer.crouch, killer.yaw, killer.pitch, false);
    for (const [id, avatar] of avatars) {
      const pose = id === replay.killerId ? killer : id === replay.victimId ? victim : null;
      avatar.object.visible = !!pose;
      if (!pose) continue;
      const sound = avatar.onMagEvent;
      avatar.onMagEvent = null;
      avatar.update(pose, dt);
      avatar.setDetail(camera.position.distanceTo(avatar.object.position));
      avatar.onMagEvent = sound;
    }
    return true;
  }

  restoreCamera(): void { this.cameraRestore?.(); this.cameraRestore = null; }
}
