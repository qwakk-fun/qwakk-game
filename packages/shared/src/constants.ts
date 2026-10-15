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
  maxClients: 32,
  defaultSeed: 1337,
} as const;
