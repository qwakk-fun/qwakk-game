/**
 * Hunt Season (Av Sezonu): the co-op PvE mode. Hunting season opened and the
 * ducks defend the pond: 1 to 4 signed-in ducks hold the QoreChain Tower in
 * the middle of Kavren against 15 waves of duck hunters (a boss every fifth
 * wave). Server rules in `apps/server/src/raid/`, the room in
 * `apps/server/src/RaidRoom.ts`, the docs in `docs/hunt-season.md`.
 *
 * Numbers the server alone decides are here only as the defaults of the
 * admin settings (`raid.*`, settings/defs.ts); the client reads the live
 * values from the room state and messages.
 */
import { TICK_RATE } from '../constants.ts';

export const RAID = {
  /** Colyseus room name. */
  roomName: 'raid',
  /** The map: Kavren, the deathmatch town (its QoreChain Tower stands in the middle). */
  mapId: 'canard-quarter',
  /** Ducks per run (parties welcome: up to PARTY.maxSize, which is 4 too). */
  maxDucks: 4,
  waves: 15,
  /** A boss wave every this many waves (5, 10, 15). */
  bossEvery: 5,
  /** Lobby: the first duck starts this countdown, every later one adds a few seconds up to the cap; a full room starts soon. */
  lobbySeconds: 15,
  joinExtraSeconds: 5,
  lobbyMaxSeconds: 30,
  fullLobbySeconds: 5,
  /** Break between waves (upgrade pick). Admin setting `raid.breakSeconds`. */
  breakSeconds: 20,
  /** Results stay up this long after the run ends, then the room closes. */
  endSeconds: 60,
  /** Tower health. Admin setting `raid.towerHp`. */
  towerHp: 1000,
  /** Most hunters and dogs alive at once; the rest of a wave waits its turn. Admin setting `raid.maxLive`. */
  maxLive: 30,
  /** Grenades every duck gets at the start of each wave (an upgrade adds more). */
  grenadesPerWave: 1,
  /** A trap holds a duck this long (ticks: 1.6 s). Stays a constant: the root is part of the sim. */
  rootTicks: Math.round(1.6 * TICK_RATE),
  /** Hunters that reach the tower hammer it: damage per second, by kind (admin setting `raid.towerDamageScale` scales it). */
  towerDps: { 1: 3, 2: 4, 3: 3, 4: 1.5, 5: 12 } as Record<number, number>,
  /** The tower's base in Kavren (the qorechain_tower prop) and how close counts as "at the tower" (m from its walls). */
  tower: { x: 0, z: -16, half: 8.3, reach: 2.6 },
} as const;

/** Run stage on the wire (`RaidState.stage`). */
export const RaidStage = {
  /** Waiting for ducks: the countdown runs from the first one. */
  Lobby: 0,
  /** Between waves: pick an upgrade. */
  Break: 1,
  Wave: 2,
  Won: 3,
  Lost: 4,
} as const;

export function isBossWave(wave: number): boolean {
  return wave > 0 && wave % RAID.bossEvery === 0;
}

/** Why a run ended (`Msg.RaidEnd`). */
export const RaidEndReason = {
  Won: 1,
  TowerFell: 2,
  AllDown: 3,
} as const;
