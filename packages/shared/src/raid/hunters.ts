/**
 * Hunt Season hunters: their kinds, what they are doing on the wire, and
 * their hitboxes. Pure data (no Rapier), shared by the server (hits) and the
 * client (predicted hit markers, drawing).
 *
 * Hitboxes: a head sphere and a body capsule per kind and stance, from the
 * art contract (`art/hunters/README.md`, measured into
 * `apps/client/public/models/hunters/hunters.json` `hunters.<kind>.hitbox`
 * and `dog.hitbox`). This is the hunters' own table, next to the one duck
 * table in `hitbox.ts` (every duck shares that one; hunters are not ducks).
 * The small sideways offsets of the art (under 5 cm) are left out. Keep these
 * in sync with the art when the hunters change.
 */
import type { HitShape } from '../hitbox.ts';

export const HunterKind = {
  Rifleman: 1,
  Trapper: 2,
  Decoy: 3,
  Dog: 4,
  Boss: 5,
  /** Hunt Season v2: a long rifle on a watchtower or a hill, 90 to 140 m out (the rifleman's body, a ghillie hat). */
  Sniper: 6,
} as const;
export type HunterKindId = (typeof HunterKind)[keyof typeof HunterKind];

export const HUNTER_KINDS: readonly HunterKindId[] = [HunterKind.Rifleman, HunterKind.Trapper, HunterKind.Decoy, HunterKind.Dog, HunterKind.Boss, HunterKind.Sniper];

export function isHunterKind(v: unknown): v is HunterKindId {
  return typeof v === 'number' && (HUNTER_KINDS as readonly number[]).includes(v);
}

/**
 * What a hunter is doing (`Hunter.act` on the wire): the client picks the
 * animation and draws the telegraphs from it. Aim is the rifleman's laser and
 * glint (and the boss's wind-up) before a shot: it always comes first, for a
 * readable warning.
 */
export const HunterAct = {
  Idle: 0,
  Walk: 1,
  Run: 2,
  /** Rifleman: laser and glint on, a shot follows. Boss: the double barrel wind-up. */
  Aim: 3,
  Fire: 4,
  /** Decoy thrower: the throw. Trapper: setting a trap. */
  Throw: 5,
  /** Dog: the lunge before a bite (a short tell), then the bite. */
  Bite: 6,
  /** Boss: the whistle that calls reinforcements. */
  Whistle: 7,
  Reload: 8,
  /** Hammering at the tower. */
  Hammer: 9,
  /** Kneeling behind cover between shots (rifleman). */
  Kneel: 10,
  /** Defeated: hat off, poof, stars. The entry goes away a moment later. */
  Down: 11,
  /** Paddling a raft across the moat (the drawbridge is up): slow, cannot shoot. */
  Raft: 12,
  /** Dunked in the moat (the Big Hunter when the drawbridge rose under him): stunned, climbing out. */
  Swim: 13,
} as const;

/** Head [forward, up, radius] and body [f0, y0, f1, y1, radius] (m), from hunters.json. */
type Box = { stand: HitShape; run: HitShape };

const person = (headY: number, headR: number, lo: number, hi: number, r: number, runHeadY: number, runHeadF: number, runHi: number): Box => ({
  stand: { head: [0.01, headY, headR], body: [0, lo, 0, hi, r] },
  run: { head: [runHeadF, runHeadY, headR], body: [0.03, lo, 0.03, runHi, r] },
});

/** The hunters' hitbox table (art contract numbers). */
export const HUNTER_HITBOX: Record<HunterKindId, Box> = {
  [HunterKind.Rifleman]: person(1.552, 0.185, 0.233, 1.312, 0.233, 1.446, 0.107, 1.196),
  [HunterKind.Trapper]: person(1.552, 0.185, 0.251, 1.313, 0.251, 1.446, 0.107, 1.196),
  [HunterKind.Decoy]: person(1.552, 0.185, 0.231, 1.31, 0.231, 1.446, 0.107, 1.192),
  [HunterKind.Boss]: person(1.924, 0.23, 0.355, 1.603, 0.355, 1.794, 0.133, 1.456),
  // The sniper is the rifleman's body (its hat stays inside the head sphere).
  [HunterKind.Sniper]: person(1.552, 0.185, 0.233, 1.312, 0.233, 1.446, 0.107, 1.196),
  // The dog's body lies along it: from 0.35 m behind its feet origin to 0.24 m ahead.
  [HunterKind.Dog]: {
    stand: { head: [0.48, 0.9, 0.16], body: [-0.35, 0.633, 0.243, 0.633, 0.195] },
    run: { head: [0.48, 0.847, 0.16], body: [-0.342, 0.59, 0.241, 0.59, 0.198] },
  },
};

/** The hitbox a hunter has now (running leans the head forward and down). */
export function hunterShape(kind: number, act: number): HitShape {
  const box = HUNTER_HITBOX[(isHunterKind(kind) ? kind : HunterKind.Rifleman) as HunterKindId];
  return act === HunterAct.Run || act === HunterAct.Walk ? box.run : box.stand;
}

/** A trap on the ground is shot to break it: a low, wide puck (radius from trap.glb's 0.66 m). */
export const TRAP_SHAPE: HitShape = { head: [0, 0, 0], body: [0, 0.08, 0, 0.12, 0.55] };

/** Gun muzzle in the hunter's frame (forward, up), from hunters.json `muzzleAim`; the server traces shots from here. */
export const HUNTER_MUZZLE: Record<HunterKindId, readonly [number, number]> = {
  [HunterKind.Rifleman]: [1.0, 1.37],
  [HunterKind.Trapper]: [0.9, 1.38],
  [HunterKind.Decoy]: [0.75, 1.37],
  [HunterKind.Boss]: [1.3, 1.7],
  [HunterKind.Dog]: [0.55, 0.85],
  [HunterKind.Sniper]: [1.1, 1.37],
};

/** Eye height for line of sight (m above the feet). */
export const HUNTER_EYE: Record<HunterKindId, number> = {
  [HunterKind.Rifleman]: 1.6,
  [HunterKind.Trapper]: 1.6,
  [HunterKind.Decoy]: 1.6,
  [HunterKind.Boss]: 2.0,
  [HunterKind.Dog]: 0.9,
  [HunterKind.Sniper]: 1.6,
};
