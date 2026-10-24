/**
 * Read-only numbers and a few drive helpers for the browser tests and
 * screenshots, on `window.__qwakkHub`. Dev and test builds only: loaded by a
 * dynamic import behind the build-time DEVTOOLS condition (hubGame.ts), so
 * public bundles do not contain it. The helpers only press the same inputs a
 * player could (walk toward a point, open a duck's bubble, answer, chat).
 */
import * as THREE from 'three/webgpu';
import { mapDefHash } from '@qwakk/shared';
import type { HubGame } from './hubGame.ts';

const _v = new THREE.Vector3();

export function exposeHubTestHook(game: HubGame): void {
  const w = window as unknown as { __qwakkHub?: unknown };
  const s = game.session;
  const screen = (x: number, y: number, z: number) => {
    _v.set(x, y + 1, z).project(game.ctx.camera);
    return { x: Math.round((_v.x * 0.5 + 0.5) * window.innerWidth), y: Math.round((-_v.y * 0.5 + 0.5) * window.innerHeight), on: Math.abs(_v.x) <= 1 && Math.abs(_v.y) <= 1 && _v.z < 1 };
  };
  w.__qwakkHub = {
    snapshot() {
      const ducks = [...s.room.state.ducks.entries()].map(([id, d]) => {
        const r = game.remotes.get(id);
        const self = id === s.sessionId;
        const pos = self ? { x: game.myPos.x, y: game.myPos.y, z: game.myPos.z } : r?.seen ? { x: r.x, y: r.y, z: r.z } : null;
        return { pid: d.pid, name: d.name, tag: d.tag, level: d.level, team: d.team, character: d.character, self, seen: self || !!r?.seen, pos, screen: pos ? screen(pos.x, pos.y, pos.z) : null };
      });
      return {
        roomId: s.room.roomId,
        mapId: s.room.state.mapId,
        me: s.mine?.pid ?? 0,
        pos: { x: game.myPos.x, y: game.myPos.y, z: game.myPos.z },
        ducks,
        labels: game.labels.shown,
        leaving: game.leaving,
        bubble: game.ui.target ? { pid: game.ui.target.pid, name: game.ui.target.name } : null,
        invite: game.ui.invite,
        touch: game.touch?.active ?? false,
        locked: game.controls.locked,
        ...game.stats,
        mapHash: mapDefHash(game.sim.map),
      };
    },
    /** Walk toward (x, z) for up to `ms` (sprinting), as if the keys were held. */
    walkTo(x: number, z: number, ms = 20000) {
      game.autoWalk = { x, z, until: performance.now() + ms };
    },
    stop() {
      game.autoWalk = null;
    },
    /** Face a direction (screenshots). */
    look(yaw: number, pitch = -0.1) {
      game.turnTo = { yaw, pitch };
    },
    /** The duck a click at this screen point would pick (pid, 0: none). */
    pickAt(x: number, y: number) {
      const id = game.pick(x, y);
      return id ? (s.room.state.ducks.get(id)?.pid ?? 0) : 0;
    },
    openDuck(pid: number) {
      const id = s.idOfPid(pid);
      if (id) game.openBubble(id);
    },
    invite(pid: number) {
      s.invite(pid);
    },
    answer(accept: boolean) {
      const inv = game.ui.invite;
      if (!inv) return false;
      s.answer(inv.pid, accept);
      game.ui.clearInvite();
      return true;
    },
    chat(text: string) {
      s.sendChat(text);
    },
    emote(kind: number) {
      s.emote(kind);
    },
  };
}
