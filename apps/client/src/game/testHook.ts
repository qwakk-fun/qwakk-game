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
import type { NameTags } from './nameTags.ts';

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
  press(buttons: number, ms: number, mz?: number): void;
  camera: { aimBlend: number };
  tags: NameTags;
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
        /** The server's own numbers for the local duck (the decoded state, not the prediction). */
        server: s.mine ? { x: s.mine.x, y: s.mine.y, z: s.mine.z, yaw: s.mine.yaw, mode: s.mine.mode, weapon: s.mine.weapon, mag0: s.mine.mag0, mag1: s.mine.mag1, res0: s.mine.res0, res1: s.mine.res1, reload: s.mine.reload, alive: s.mine.alive } : null,
        controls: { yaw: v.controls.yaw, pitch: v.controls.pitch },
        remotes,
        prediction: { ...s.prediction, avgErrM: s.prediction.reconciles ? s.prediction.sumErrM / s.prediction.reconciles : 0, driftEma: me?.drift.ema ?? 0, driftPeak: me?.drift.peak ?? 0 },
        pendingInputs: me?.pendingCount ?? 0,
        localMotion: { drawnMaxSpeed: v.localMotion.maxSpeed, snapFrames: v.localMotion.snapFrames, frames: v.localMotion.frames },
        netsim: { ...s.netsim.settings },
        combat: { ...v.combat.stats, now: performance.now() },
        kills: [...s.room.state.players.values()].reduce((n, p) => n + p.kills, 0),
        /** Ducks per character id in the room, and the one the server seated us as. */
        characters: [...s.room.state.players.values()].reduce<Record<number, number>>((n, p) => ((n[p.character] = (n[p.character] ?? 0) + 1), n), {}),
        myCharacter: s.mine?.character ?? -1,
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
        team: {
          myTeam: s.myTeam,
          teamSize: s.room.state.teamSize,
          teams: s.room.state.teams,
          down: me?.state.down ?? 0,
          hp: me?.state.hp ?? 0,
          allies: [...s.room.state.players.entries()].filter(([id]) => s.isAlly(id)).map(([id, p]) => ({ id, name: p.name, alive: p.alive, pose: s.pose(id) !== null, mate: s.mate(id) ? { hp: s.mate(id)!.hp, down: s.mate(id)!.down, rev: s.mate(id)!.rev } : null })),
          tags: { ...v.tags.stats },
          revivePrompt: v.br?.stats.revivePrompt ?? '',
        },
      };
    },
    /** Test servers only (QWAKK_TEST_HOOKS=1): hurt our own battle royale duck (knock it for the revive e2e). */
    devHurt: (n: number) => v.session.room.send('dev:hurt', n),
    /** Where a player is drawn (pose) by session id, or null when not sent. */
    poseOf: (id: string) => {
      const p = v.session.pose(id);
      return p ? { x: p.x, y: p.y, z: p.z, act: p.act } : null;
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
        magState: a.magState,
        aim: v.session.me?.state.aim ?? 0,
        cameraAim: v.camera.aimBlend,
        reload: v.session.me?.state.reload ?? 0,
        mag: v.session.me ? (v.session.me.state.weapon === 0 ? v.session.me.state.mag0 : v.session.me.state.mag1) : 0,
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
    /** Crates this client knows about near the duck: key, crate, open, contents, distance. */
    crates: (radius = 60) => {
      const me = v.session.me;
      if (!v.br || !me) return [];
      const out = [];
      for (const e of v.br.loot.crateStates()) {
        if (!e.crate) continue;
        const d = Math.hypot(e.x - me.state.x, e.z - me.state.z);
        if (d <= radius) out.push({ key: e.key, crate: e.crate, open: e.open, contents: e.contents.length, x: e.x, y: e.y, z: e.z, dist: d });
      }
      return out.sort((a, b) => a.dist - b.dist);
    },
    /** Send the battle royale autopilot to this item first (null: back to normal); `holdOpen` stops it at an opened crate. */
    focusItem: (key: string | null, holdOpen = false) => {
      if (!v.br) return;
      v.br.apFocus = key;
      v.br.apHoldOpen = holdOpen;
    },
    /** Open or close the inventory screen (screenshots). */
    inventory: (open: boolean) => {
      if (!v.br || v.br.inventoryOpen === open) return v.br?.inventoryOpen ?? false;
      v.br.toggleInventory();
      return v.br.inventoryOpen;
    },
    /** Hold these input buttons (Button bits) for `ms`, on top of the autopilot or the keys; `mz` walks forward (1) or back. */
    press: (buttons: number, ms: number, mz = 0) => v.press(buttons, ms, mz),
    /** Remote ducks in view and what they are doing (pose action), for screenshots of their reloads. */
    remoteActs: () => {
      const out: { id: string; act: number; dist: number; magState: string }[] = [];
      const me = v.session.me;
      for (const [id, r] of v.remotes) {
        const p = v.session.pose(id);
        if (!p || !me) continue;
        out.push({ id, act: p.act, dist: Math.hypot(p.x - me.state.x, p.z - me.state.z), magState: r.avatar.magState });
      }
      return out;
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
