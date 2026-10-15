/**
 * Read-only numbers for automated browser tests (Playwright), on `window.__qwakk`.
 * Dev and test builds only: loaded through a dynamic import behind the
 * build-time DEVTOOLS constant, so public bundles do not contain it.
 */
import { simSelfTestHash } from '@qwakk/shared';
import type { PlayerState } from '@qwakk/shared/net';
import type { Session } from '../net/session.ts';
import type { Avatar } from '../player/avatar.ts';
import type { CombatFeedback } from './combatFeedback.ts';
import type { FrameTimer, MotionProbe } from './metrics.ts';

export interface TestView {
  session: Session;
  backend: string;
  timer: FrameTimer;
  remotes: Map<string, { state: PlayerState; avatar: Avatar; motion: MotionProbe }>;
  localMotion: MotionProbe;
  combat: CombatFeedback;
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
      };
    },
    simSelfTestHash: () => simSelfTestHash(),
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
