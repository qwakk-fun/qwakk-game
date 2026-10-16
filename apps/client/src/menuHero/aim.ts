/**
 * Aim math for the menu's hero duck: pure numbers, no DOM and no Three.js, so
 * it is unit tested on its own (test/menuHero.test.ts).
 *
 * The duck aims by a yaw (around the world up axis, positive turns it toward
 * the viewer's right) and a pitch (positive lifts the rifle), both relative to
 * its authored Rifle_Aim pose, which is also the static menu image. Both are
 * kept in natural ranges by a soft limit and eased with a critically damped
 * spring, so the duck never overshoots or snaps.
 */

const DEG = Math.PI / 180;

export const AIM = {
  /**
   * Soft limits around the authored pose (radians). The duck stands three
   * quarters to the viewer's left with the rifle at its right side: it turns
   * further left than right, where it would end up pointing at the viewer.
   */
  yawLeft: 30 * DEG,
  yawRight: 24 * DEG,
  pitchUp: 20 * DEG,
  pitchDown: 16 * DEG,
  /** Spring stiffness (1/s): settles in about 0.5 s. */
  omega: 9,
  /**
   * Screen mapping (aimFromScreen): turn per box of cursor offset from the grip
   * (radians). Left of the grip the rifle already points at the cursor, so the
   * duck barely turns; right of it, it turns toward the viewer.
   */
  yawGainLeft: 0.08,
  yawGainRight: 0.7,
  /** The pitch is measured over at least this much width (box units), so a cursor right above the grip lifts the rifle smoothly. */
  minReach: 0.25,
  /** Share of the yaw the whole duck turns on its feet; the spine twists the rest. */
  rootYaw: 0.2,
  /**
   * Shares of the remaining yaw and of the pitch per spine bone, low to high
   * (each column sums to 1, so the rifle turns by the full aim). The chest
   * takes most of the pitch, so the duck lifts its rifle instead of leaning back.
   */
  spine: [
    { yaw: 0.3, pitch: 0.15 },
    { yaw: 0.35, pitch: 0.35 },
    { yaw: 0.35, pitch: 0.5 },
  ],
  /** Extra look on top for the neck and the head: the eyes lead the rifle a little. */
  neck: { yaw: 0.12, pitch: 0.04 },
  head: { yaw: 0.15, pitch: 0.06 },
  /** Touch screens without a mouse: a lazy glance now and then (radians, seconds). */
  glanceYaw: 20 * DEG,
  glancePitch: 9 * DEG,
  glanceHold: [2.2, 4.5] as const,
  /** How long a tap holds the duck's attention (seconds). */
  tapHold: 3,
  /** Click on the duck: recoil kick (radians) and how fast it fades (1/s). */
  recoilKick: 0.14,
  recoilFade: 5.5,
} as const;

/** A critically damped spring on one number. */
export interface Spring {
  x: number;
  v: number;
}

/** Advance a critically damped spring toward `target` (exact solution, stable for any dt). */
export function stepSpring(s: Spring, target: number, omega: number, dt: number): void {
  const d = s.x - target;
  const e = Math.exp(-omega * dt);
  const j = (s.v + omega * d) * dt;
  s.x = target + (d + j) * e;
  s.v = (s.v - omega * j) * e;
}

/** True once a spring sits on its target (nothing left to draw). */
export function settled(s: Spring, target: number): boolean {
  return Math.abs(s.x - target) < 2e-4 && Math.abs(s.v) < 2e-3;
}

/** A smooth limit: about 1:1 near zero, never past `max`. */
export function softLimit(x: number, max: number): number {
  return max * Math.tanh(x / max);
}

/**
 * Aim offsets for a cursor at (u, v) from the rifle's grip on screen, in units
 * of the duck's box (v up). Worked out on screen rather than in 3D on purpose:
 * the duck stands three quarters to the left, so in 3D a cursor anywhere near
 * it means "at the viewer" and it would turn to face the screen. On screen the
 * rifle tilts toward the cursor (the pitch is the cursor's angle above or below
 * the grip), and the duck turns toward the viewer as the cursor goes right of
 * the grip, where the rifle cannot point.
 */
export function aimFromScreen(u: number, v: number): { yaw: number; pitch: number } {
  const yaw = u * (u >= 0 ? AIM.yawGainRight : AIM.yawGainLeft);
  const pitch = Math.atan2(v, Math.max(Math.abs(u), AIM.minReach));
  return {
    yaw: yaw >= 0 ? softLimit(yaw, AIM.yawRight) : softLimit(yaw, AIM.yawLeft),
    pitch: pitch >= 0 ? softLimit(pitch, AIM.pitchUp) : softLimit(pitch, AIM.pitchDown),
  };
}
