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
  /** Human clients per room (deathmatch). The benchmark raises it with QWAKK_MAX_CLIENTS. */
  maxClients: 8,
  defaultSeed: 1337,
} as const;

/** Deathmatch rules. */
export const MATCH = {
  /** Bots fill the room up to this many players. */
  players: 8,
  scoreLimit: 25,
  roundSeconds: 300,
  intermissionSeconds: 8,
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
  /** Warm-up: starts with the first human; shorter once this many humans are in. */
  warmupSeconds: 45,
  warmupFullSeconds: 15,
  warmupFullHumans: 8,
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
