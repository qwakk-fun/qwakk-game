/**
 * Every tunable number for the sim lives here, so feel tuning happens in one file.
 * Units: meters, seconds, radians. Positions are the player's feet.
 */

/** Authoritative simulation rate. */
export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;

export const MOVE = {
  /** Target speeds (m/s). */
  walkSpeed: 2.6,
  runSpeed: 5.2,
  sprintSpeed: 7.0,
  crouchSpeed: 2.3,
  /** Sprint only counts when the forward axis is at least this much. */
  sprintMinForward: 0.5,

  /** Quake/CS style ground acceleration: accel * wishSpeed per second. */
  groundAccel: 10,
  /** Friction decel factor per second, applied to max(speed, stopSpeed). */
  friction: 8,
  /** Below this speed friction acts as if moving at stopSpeed, giving a crisp stop. */
  stopSpeed: 2.5,

  /** Air: CS style air accel with a small wish speed cap gives limited air control. */
  airAccel: 12,
  airWishSpeedCap: 0.9,
  /** Light air drag so long falls do not keep full ground speed forever (per second). */
  airDrag: 0.05,

  gravity: 20,
  jumpVelocity: 6.6,
  maxFallSpeed: 40,
  /** Grace period after leaving a ledge during which a jump still works (s). */
  coyoteTime: 0.1,
  /** A jump pressed this long before landing still fires on landing (s). */
  jumpBuffer: 0.12,

  /** Rapier character controller. */
  stepHeight: 0.45,
  stepMinWidth: 0.2,
  maxSlopeClimbDeg: 46,
  minSlopeSlideDeg: 50,
  snapToGround: 0.35,
  skinOffset: 0.02,
} as const;

export const BODY = {
  radius: 0.35,
  standHeight: 1.75,
  crouchHeight: 1.15,
  /** Eye height used by the camera pivot, standing and crouched. */
  standEye: 1.55,
  crouchEye: 1.0,
  /** How fast the drawn stance blends (per second). Visual only: the collider swaps at once. */
  crouchRate: 8,
} as const;

export const NET = {
  /** Patch rate: the server broadcasts right after every tick, so this equals TICK_RATE. */
  patchRateHz: TICK_RATE,
  /** Remote players are drawn this far in the past (ms). */
  interpDelayMs: 100,
  /** Output spring on remote interpolation (ms); adds about this much display lag. */
  remoteSmoothMs: 30,
  /** Server side: max buffered inputs per player (Colyseus drops and acks the oldest past this). */
  maxInputBuffer: 10,
  /**
   * Server side: input credit accrues 1 per tick and caps here (anti speedhack).
   * Every simulated step costs 1, so a client can never average more than one
   * step per tick, but a burst after a short stall is absorbed without lag.
   */
  maxInputCredit: 8,
  /** Server side: ticks without any input tolerated (jitter, a TCP resend) before stand-in steps start. */
  starveGraceTicks: 6,
  /** Server side: stand-in steps repeat the last input this many ticks, then the player stands still. */
  standInRepeatTicks: 10,
  /** Server side: most stand-in steps that late inputs can later be matched against. */
  maxStandInDebt: 30,
  /** Server side: an input counts as late when it is this much older than the client's usual lag (ms). */
  lateMarginMs: 120,
  /**
   * Server side: message rate limit per client. Inputs are one message per tick
   * (30/s); the headroom lets a backlog flush after a network stall of several
   * seconds without the client being kicked.
   */
  maxMessagesPerSecond: 300,
  /** Server side: max decoded message bytes. */
  maxMessageBytes: 1024,
  /** Max yaw/pitch change per tick the server accepts (rad), about 4300 deg/s. A first anti-aimbot gate; real heuristics come later. */
  maxAngleDeltaPerTick: (2 * Math.PI * 12) / TICK_RATE,
  maxPitch: 1.45,
  minPitch: -1.35,
} as const;

export const ROOM = {
  name: 'island',
  /**
   * Human clients per deathmatch room. The deathmatch rooms are static (lobby.ts
   * DM_ROOMS, created at server start, never by clients); the benchmark raises
   * this with QWAKK_MAX_CLIENTS.
   */
  maxClients: 32,
  defaultSeed: 1337,
} as const;

/** Deathmatch rules. */
export const MATCH = {
  /**
   * The deathmatch map: 'greybox' (generated from ROOM.defaultSeed) or a map_v1
   * id under packages/shared/src/maps/<id>/. Change it here to switch every
   * deathmatch room (QWAKK_DM_MAP overrides it for one server run).
   */
  mapId: 'canard-quarter',
  /**
   * Humans plus bots per room: 1 human plays with 23 bots, 2 with 22, and so on.
   * Below ROOM.maxClients on purpose (32 was too crowded); past 24 humans there are no bots.
   */
  players: 24,
  /**
   * First to this many kills wins the round. A full room is busy: a headless
   * room of 32 navmesh bots on Kavren scores about 3.7 kills a second
   * in total, so the leader reaches 50 in about 4.5 minutes; the time limit
   * caps quieter rooms.
   */
  scoreLimit: 50,
  roundSeconds: 600,
  intermissionSeconds: 10,
  /**
   * Respawns go to one of this many spawn points that no enemy can see, taken
   * in order of distance to the nearest living enemy (farthest first)...
   */
  spawnCandidates: 6,
  /** ...where "can see" means a clear line of sight from an enemy within this range (m; the bots' view range)... */
  spawnSightRange: 80,
  /** ...and at least this far from every enemy (m); at most this many points are tested (sight rays). */
  spawnMinEnemyDistance: 18,
  spawnScanMax: 18,
  /** A spawn point used this recently counts as occupied (ticks), so two ducks never spawn on top of each other. */
  spawnReuseTicks: 90,
  /**
   * Maps without `dmSpawns` (map_v1): spawns are derived on open ground within
   * this radius of the map's plaza (or its center), every this many meters,
   * at most this many points.
   */
  derivedSpawnRadius: 60,
  derivedSpawnStep: 5,
  derivedSpawnMax: 48,
} as const;

/**
 * Deathmatch spawn protection (server rule, replicated as `PlayerState.protect`).
 * A fresh duck takes no damage and blinks; the first input with the fire button
 * held ends it at once (that shot counts normally). Moving, reloading and
 * switching weapons do not end it. Shots pass through a protected duck (the
 * client predicts the same), and bots do not pick protected ducks as targets.
 */
export const SPAWN_PROTECTION = {
  /** How long it lasts after a spawn (ticks, 2 s). */
  ticks: Math.round(2 * TICK_RATE),
  /** Client: blinks per second of a protected duck, and the share of each blink it is drawn. */
  blinkHz: 6,
  blinkOnShare: 0.5,
} as const;

/**
 * Deathmatch bot skill (server bots, `apps/server/src/bots.ts`). Higher reaction
 * and error, slower settling and tracking mean a softer bot. Tuned so an
 * average player wins a fair duel more often than not: a bot reacts in about
 * half a second, its first shots of a burst stray, it lags behind a strafing
 * target and does not control recoil well. Battle royale bots have their own
 * numbers (`BR_SKILL` in `br/brBot.ts`).
 */
export const DM_BOT = {
  /** Ticks from first sight of a new target to the first shot (random in range). */
  reactionTicks: [14, 24],
  /** Aim error on a new target (rad, random up to this either way), shrinking by `errorSettlePerTick` every tick. */
  yawError: 0.2,
  pitchError: 0.08,
  errorSettlePerTick: 0.95,
  /** A fresh aim error rolled at the start of every burst that does not settle (rad, up to this either way). */
  burstYawError: 0.02,
  burstPitchError: 0.012,
  /** Share of the gap to the target's position the aim point closes per tick: a strafing target is aimed at where it was. */
  trackRate: 0.3,
  /** Turn speed (rad per tick). */
  turnRatePerTick: 0.16,
  /** Share of the spray pattern it pulls against. */
  recoilControl: 0.55,
  /** Chance to aim at the head instead of the belly (per target). */
  headChance: 0.05,
  /** Sight: range (m), half angle of the field of view (deg), and the range it notices anyone at regardless of facing (m). */
  viewRange: 80,
  fovHalfAngleDeg: 60,
  hearRange: 6,
  /** Automatic weapons: shots per burst (close, and past 28 m), and ticks of pause between bursts. */
  burstShots: [2, 5],
  longBurstShots: [2, 3],
  burstPauseTicks: [8, 16],
  /** Semi-automatic weapons: ticks between trigger pulls on top of the fire rate. */
  semiPauseTicks: [5, 10],
} as const;

/** Interest management: how often and how precisely other players are sent. */
export const INTEREST = {
  /** Players closer than this are sent every tick; switch to far beyond `farRadius` (hysteresis). */
  nearRadius: 35,
  farRadius: 42,
  /** Far players are sent every this many ticks (30 / 3 = 10 Hz). */
  farEveryTicks: 3,
  /** Extra interpolation delay the client uses for far players (ms); lag compensation subtracts it too. */
  farExtraDelayMs: 50,
  /** Re-evaluate near and far every this many ticks. */
  updateEveryTicks: 10,
  /** Shot effects are not sent to clients farther than this from both ends of the tracer (m). */
  shotFxRadius: 160,
} as const;

/** Drop: the plane, freefall and the glider. Speeds in m/s, heights in m. */
export const DROP = {
  /** Freefall: steer speed, fall speed, extra fall speed while diving (W). */
  freefallSteer: 10,
  freefallSpeed: 32,
  freefallDiveExtra: 14,
  /** Glider opens by itself this high above the terrain. */
  autoOpenHeight: 45,
  /** The glider cannot be opened before falling this far below the plane (avoids an instant open on the jump press). */
  minFallBeforeOpen: 4,
  /** Glide: forward speed and sink rate, cruising (best ratio, about 1:3), diving (W) and braking (S). */
  glideForward: 13,
  glideSink: 4.3,
  glideDiveForward: 19,
  glideDiveSink: 7.5,
  glideBrakeForward: 6,
  glideBrakeSink: 3,
  glideStrafe: 4,
  /** How fast the velocity follows its target (per second). */
  steerRate: 2.6,
  sinkRate: 3,
  /** Jump only over land: terrain at least this high under the plane. */
  minLandHeight: 1,
  /** Everyone still aboard is ejected this many meters before the plane's last land point. */
  autoEjectBeforeCoast: 70,
  /** Seconds between the start of the match phase and the plane reaching its path start. */
  planeLeadSeconds: 0,
} as const;

/**
 * Aim down sights (right mouse, held). Part of the sim: the server's copy
 * decides spread and recoil, so the aim state ramps in and out over ticks
 * (a one-tick flick buys nothing). Camera zoom numbers live in tpsCamera.ts.
 */
export const ADS = {
  /** Ticks from hip to full aim (200 ms). */
  inTicks: 6,
  /** Aim lost per tick on release (out in 100 ms). */
  outPerTick: 2,
  /** Ground speed cap at full aim (m/s); no sprinting while aiming. */
  moveSpeed: 3.0,
  /** Multipliers at full aim: base spread (standing, crouched), the moving penalty and the spray bloom. Airborne spread is not reduced. */
  spreadScale: 0.5,
  moveSpreadScale: 0.6,
  fireSpreadScale: 0.6,
  /** Spray pattern (recoil) multiplier at full aim. */
  recoilScale: 0.65,
} as const;

/** Heals: part of the sim (they slow you and can be interrupted), so prediction matches. */
export const HEAL = {
  bandageTicks: Math.round(4 * TICK_RATE),
  bandageAmount: 15,
  /** Bandages heal up to this much health. */
  bandageCap: 75,
  medkitTicks: Math.round(7 * TICK_RATE),
  medkitCap: 100,
  /** Movement speed cap while healing (m/s). */
  moveSpeed: 2.2,
} as const;

/** Wading in the river and the shallow sea. */
export const WATER = {
  /** Water deeper than this (above the feet) slows you. */
  wadeDepth: 0.25,
  deepDepth: 1.0,
  wadeFactor: 0.7,
  deepFactor: 0.45,
} as const;

/** Battle royale room and match flow. */
export const BR = {
  roomName: 'br',
  /** Ducks per match; bots fill the empty seats when the room locks. */
  players: 16,
  /**
   * Lobby rooms. Humans wait on the village square (damage off). The countdown
   * starts once `minHumans` real players are in a room and resets if they drop
   * below it; when it ends, bots fill the empty seats and the match starts.
   */
  minHumans: 2,
  countdownSeconds: 30,
  /** A room full of humans starts this soon (or sooner, if the countdown is lower). */
  fullCountdownSeconds: 10,
  /** Battle royale rooms open at once on one server (waiting, counting down or playing). Launch: one room; QWAKK_BR_MAX_ROOMS overrides. */
  maxRooms: 1,
  /** Results stay up this long after the winner is decided, then the room closes. */
  endSeconds: 20,
  /** A dead duck's crate stays this long (it only holds what was dropped). */
  crateSeconds: 600,
} as const;

/** Zone (circle) phases: wait, then shrink to the radius; damage per second outside. Phase 0 is the drop. */
export const ZONE = {
  phases: [
    { waitS: 90, shrinkS: 0, radius: 380, dps: 0 },
    { waitS: 90, shrinkS: 60, radius: 260, dps: 1 },
    { waitS: 60, shrinkS: 45, radius: 170, dps: 2 },
    { waitS: 50, shrinkS: 40, radius: 105, dps: 4 },
    { waitS: 40, shrinkS: 30, radius: 60, dps: 7 },
    { waitS: 30, shrinkS: 25, radius: 30, dps: 11 },
    { waitS: 20, shrinkS: 20, radius: 0, dps: 18 },
  ],
  /** Before the first circle shows, the zone covers the whole map with this radius. */
  startRadius: 700,
  /** The first circle is shown this many seconds into phase 0. */
  firstShownS: 60,
  /** Keep at least this share of land inside circles up to this radius. */
  minLandShare: 0.7,
  landCheckMaxRadius: 260,
} as const;

/** Anti-wallhack visibility (server interest management). */
export const VIS = {
  /** Always send enemies this close, seen or not (footsteps range). */
  alwaysRadius: 10,
  /** Never send enemies farther than this (the fog hides them anyway). */
  maxRange: 320,
  /** Keep sending a pair this long after it was last visible (ms). */
  graceMs: 1000,
  /** Predict positions this far ahead when testing visibility (ms), on top of the round trip. */
  lookaheadMs: 150,
  /** Re-test each pair about this often (ticks). */
  retestTicks: 3,
} as const;

/**
 * Parties: friends group up in the menu (a short code and a share link), then
 * the leader picks a room and the party lands there together, on one team in
 * the team battle royale modes and as allies in a deathmatch. Server memory
 * only (one instance).
 */
export const PARTY = {
  /** Colyseus room name of a party (private: joined by its code only). */
  roomName: 'party',
  maxSize: 4,
  /** Code length and alphabet (no 0/O, 1/I/L look-alikes). */
  codeLength: 6,
  codeAlphabet: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
  /** Seats a battle royale room holds for party members following their leader (s). */
  reserveSeconds: 30,
} as const;

/** Battle royale team modes: ducks per team (solo, duo, squad). BR.players must divide by each. */
export const TEAM_SIZES = [1, 2, 4] as const;

/**
 * Knocked state in the team modes: at 0 health a duck with a standing
 * teammate is knocked instead of out. It crawls, cannot shoot, aim, heal or
 * jump, and bleeds out; a teammate holding Use next to it revives it. The
 * crawl is part of the sim (predicted); the rest is server rules.
 */
export const KNOCK = {
  /** The bleed meter a knocked duck starts with (shown as its health). */
  hp: 100,
  /** Seconds a knocked duck takes to bleed out on its own. */
  bleedSeconds: 30,
  /** Damage to a knocked duck counts this many times (a few hits finish it). */
  damageScale: 2,
  /** Crawl speed (m/s), and the friction floor while crawling (the normal MOVE.stopSpeed would hold a crawl below 1 m/s). */
  crawlSpeed: 1.0,
  crawlStopSpeed: 0.5,
  /** Seconds a teammate holds Use to revive, how close it must stay (m, chest to chest) and the health it comes back with. */
  reviveSeconds: 5,
  reviveRange: 2.2,
  reviveHp: 25,
} as const;

/** Small, faint names over nearby ducks; allies can be marked through walls. */
export const NAMETAG = {
  range: 12,
  fadeStart: 6,
  maxOpacity: 0.65,
  /** Label height above the feet (m). */
  labelStand: 1.85,
  labelCrouch: 1.4,
} as const;
