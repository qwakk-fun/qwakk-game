/**
 * Read-only numbers for automated browser tests (Playwright), on `window.__qwakk`.
 * Dev and test builds only: loaded through a dynamic import behind the
 * build-time DEVTOOLS constant, so public bundles do not contain it.
 */
import * as THREE from 'three/webgpu';
import { mapDefHash, simSelfTestHash, simSelfTestHashOn } from '@qwakk/shared';
import type { PlayerState } from '@qwakk/shared/net';
import type { Session } from '../net/session.ts';
import type { Avatar } from '../player/avatar.ts';
import type { CombatFeedback } from './combatFeedback.ts';
import type { FrameTimer, MotionProbe } from './metrics.ts';
import type { BrClient } from './brClient.ts';
import type { WorldHandle } from '../world/worldHandle.ts';

export interface TestView {
  session: Session;
  backend: string;
  timer: FrameTimer;
  remotes: Map<string, { state: PlayerState; avatar: Avatar; motion: MotionProbe }>;
  localMotion: MotionProbe;
  combat: CombatFeedback;
  br: BrClient | null;
  renderer: { info: { render: unknown } };
  world: WorldHandle;
  controls: { yaw: number; pitch: number };
  localAvatar: Avatar;
  hold(ms: number): void;
}

function renderStats(v: TestView): { drawCalls: number; triangles: number; world: { drawCalls: number; triangles: number } | null } {
  const r = v.renderer.info.render as { drawCalls?: number; calls?: number; triangles?: number };
  const w = v.world.sainte?.info() ?? null;
  return { drawCalls: r.drawCalls ?? r.calls ?? 0, triangles: r.triangles ?? 0, world: w ? { drawCalls: w.drawCalls, triangles: w.triangles } : null };
}

export function exposeTestHook(v: TestView): void {
  (window as unknown as { __qwakk: unknown }).__qwakk = {
    snapshot: () => {
      const s = v.session;
      const me = s.me;
      const remotes: Record<string, { x: number; y: number; z: number; drawnMaxSpeed: number; snapFrames: number; frames: number }> = {};
      for (const [id, r] of v.remotes) {
        const p = s.pose(id);
        remotes[id] = { x: p?.x ?? 0, y: p?.y ?? 0, z: p?.z ?? 0, drawnMaxSpeed: r.motion.maxSpeed, snapFrames: r.motion.snapFrames, frames: r.motion.frames };
      }
      return {
        sessionId: s.sessionId,
        backend: v.backend,
        fps: v.timer.fps,
        frameMsAvg: v.timer.avg,
        frameMsMax: v.timer.max,
        cpuMsAvg: v.timer.cpuAvg,
        cpuMsP95: v.timer.cpuP95,
        pingMs: s.pingMs,
        serverTick: s.room.state.tick,
        players: s.room.state.players.size,
        me: me ? { x: me.state.x, y: me.state.y, z: me.state.z, grounded: me.state.grounded, alive: me.state.alive } : null,
        remotes,
        prediction: { ...s.prediction, avgErrM: s.prediction.reconciles ? s.prediction.sumErrM / s.prediction.reconciles : 0, driftEma: me?.drift.ema ?? 0, driftPeak: me?.drift.peak ?? 0 },
        pendingInputs: me?.pendingCount ?? 0,
        localMotion: { drawnMaxSpeed: v.localMotion.maxSpeed, snapFrames: v.localMotion.snapFrames, frames: v.localMotion.frames },
        netsim: { ...s.netsim.settings },
        combat: { ...v.combat.stats, now: performance.now() },
        kills: [...s.room.state.players.values()].reduce((n, p) => n + p.kills, 0),
        poseEntries: { near: s.room.state.poses.size, far: s.room.state.farPoses.size },
        visibleRemotes: Object.keys(remotes).filter((id) => s.pose(id) !== null),
        mode: s.room.state.mode,
        mapId: s.room.state.mapId,
        phase: s.room.state.phase,
        alive: s.room.state.alive,
        planeT0: s.room.state.planeT0,
        zone: { x: s.room.state.zone?.cx ?? 0, z: s.room.state.zone?.cz ?? 0, r: s.room.state.zone?.r ?? 0 },
        mine: me ? { mode: me.state.mode, hp: me.state.hp, arms: me.state.arms, weapon: me.state.weapon, res0: me.state.res0, res1: me.state.res1, bandages: me.state.bandages, medkits: me.state.medkits } : null,
        br: v.br ? { ...v.br.stats, items: v.br.autopilotView().items.length } : null,
        render: renderStats(v),
      };
    },
    /**
     * The local duck's orientation: root yaw, controls, and the world up axis
     * and world quaternion of a few bones (an upright duck has its Head's
     * world up near +y). For the avatar regression check.
     */
    avatarProbe: () => {
      const a = v.localAvatar;
      a.object.updateMatrixWorld(true);
      const q = a.object.getWorldQuaternion(new THREE.Quaternion());
      const bones: Record<string, { q: number[]; up: number[]; pos: number[] }> = {};
      for (const name of ['Hips', 'Spine', 'Spine2', 'Head', 'LeftArm', 'RightArm']) {
        const b = a.bone(name);
        if (!b) continue;
        const bq = b.getWorldQuaternion(new THREE.Quaternion());
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(bq);
        const pos = b.getWorldPosition(new THREE.Vector3()).sub(a.object.position);
        bones[name] = { q: bq.toArray(), up: up.toArray(), pos: pos.toArray() };
      }
      return {
        visible: a.object.visible,
        rootQuat: q.toArray(),
        rootYaw: a.object.rotation.y,
        controls: { yaw: v.controls.yaw, pitch: v.controls.pitch },
        weapon: v.session.mine?.armed ? v.session.me?.state.weapon ?? -1 : 2,
        bones,
      };
    },
    simSelfTestHash: () => simSelfTestHash(),
    /** The same scenario on the loaded map, and the hash of its terrain and collider list. */
    mapSelfTestHash: () => simSelfTestHashOn(v.world.map, 200),
    mapDefHash: () => mapDefHash(v.world.map),
    /** Stop the autopilot for `ms` and face the point (x, z), for screenshots. */
    face: (x: number, z: number, ms = 1500, pitch = 0.05) => {
      const me = v.session.me;
      if (!me) return;
      v.hold(ms);
      v.controls.yaw = Math.atan2(-(x - me.state.x), -(z - me.state.z));
      v.controls.pitch = pitch;
    },
    resetStats: () => {
      Object.assign(v.session.prediction, { reconciles: 0, corrected: 0, lastErrM: 0, maxErrM: 0, sumErrM: 0 });
      v.localMotion.reset();
      for (const r of v.remotes.values()) r.motion.reset();
    },
    setNet: (latencyMs: number, jitterMs: number, loss: number) => {
      Object.assign(v.session.netsim.settings, { latencyMs, jitterMs, loss });
    },
  };
}
