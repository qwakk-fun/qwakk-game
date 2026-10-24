/**
 * Hunt Season (Av Sezonu): the co-op PvE mode. Hunting season opened and the
 * ducks cut their way out: 1 to 4 signed-in ducks start in Pond Keep (a duck
 * castle on a pond island) with katanas and push across the field through
 * hordes of hunters, objective by objective (push.ts: the trench, the supply
 * crates, the watchtowers, the Big Hunter's camp). Server rules
 * in `apps/server/src/raid/`, the room in `apps/server/src/RaidRoom.ts`, the
 * docs in `docs/hunt-season.md`.
 *
 * Numbers the server alone decides are here only as the defaults of the
 * admin settings (`raid.*`, settings/defs.ts); the client reads the live
 * values from the room state and messages. Numbers the client simulates or
 * draws (the cannon's arc, the reach of the keep's controls) are the KEEP and
 * CANNON constants (keep.ts) and change only with a deploy.
 */
import { TICK_RATE } from '../constants.ts';

export const RAID = {
  /** Colyseus room name. */
  roomName: 'raid',
  /** The map: Pond Keep, the duck castle on a pond island (its `raid` markup, raid/keep.ts). */
  mapId: 'pond-keep',
  /** Ducks per run (parties welcome: up to PARTY.maxSize, which is 4 too). */
  maxDucks: 4,
  /** Objectives of a run (push.ts GOALS); the run is won when the last falls. */
  objectives: 4,
  /** Lobby: the first duck starts this countdown, every later one adds a few seconds up to the cap; a full room starts soon. */
  lobbySeconds: 15,
  joinExtraSeconds: 5,
  lobbyMaxSeconds: 30,
  fullLobbySeconds: 5,
  /** Break between objectives (upgrade pick). Admin setting `raid.breakSeconds`. */
  breakSeconds: 8,
  /** Results stay up this long after the run ends, then the room closes. */
  endSeconds: 60,
  /** The QoreChain core's health (the run is lost when it falls). Admin setting `raid.coreHp`. */
  coreHp: 1000,
  /** The main gate's health. Admin setting `raid.gateHp`. */
  gateHp: 700,
  /** Most hunters, minions and dogs alive at once; packs wait their turn. Admin setting `raid.maxLive`. */
  maxLive: 44,
  /** A trap holds a duck this long (ticks: 1.6 s). Stays a constant: the root is part of the sim. */
  rootTicks: Math.round(1.6 * TICK_RATE),
  /** Hunters at the core hammer it: damage per second, by kind (admin setting `raid.coreDamageScale` scales it). */
  coreDps: { 1: 3, 2: 4, 3: 3, 4: 1.5, 5: 12, 6: 2, 7: 3, 8: 2 } as Record<number, number>,
  /** Hunters at the gate hammer it: damage per second, by kind (admin setting `raid.gateDamageScale` scales it). */
  gateDps: { 1: 4, 2: 6, 3: 4, 4: 2.5, 5: 20, 6: 3, 7: 5, 8: 3 } as Record<number, number>,
  /** How close counts as "at the core" (m past its radius). */
  coreReach: 1.8,
} as const;

/** Run stage on the wire (`RaidState.stage`). */
export const RaidStage = {
  /** Waiting for ducks: the countdown runs from the first one. */
  Lobby: 0,
  /** Between objectives: pick an upgrade. */
  Break: 1,
  /** An objective in play (`RaidState.wave` is its number). */
  Fight: 2,
  Won: 3,
  Lost: 4,
} as const;

/** Why a run ended (`Msg.RaidEnd`). */
export const RaidEndReason = {
  Won: 1,
  /** v2 only (the QoreChain core fell); a v3 push cannot lose its core. */
  CoreFell: 2,
  AllDown: 3,
} as const;

/** The main gate's look and rule (`RaidState.gate`): intact above half health, damaged below, broken at 0 until repaired past `GATE_CLOSE_SHARE`. */
export const GateState = {
  Intact: 0,
  Damaged: 1,
  Broken: 2,
} as const;

/** A broken gate holds hunters again once repaired to this share of its health. */
export const GATE_CLOSE_SHARE = 0.3;

/** The gate's look for a health share (and whether it was broken: it stays broken until repaired past GATE_CLOSE_SHARE). */
export function gateStateOf(share: number, wasBroken: boolean): number {
  if (share <= 0 || (wasBroken && share < GATE_CLOSE_SHARE)) return GateState.Broken;
  return share > 0.5 ? GateState.Intact : GateState.Damaged;
}

/** The drawbridge (`RaidState.bridge`). */
export const BridgeState = {
  Down: 0,
  Raising: 1,
  Up: 2,
  Lowering: 3,
} as const;
