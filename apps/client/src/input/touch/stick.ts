/**
 * Pure touch math: the joystick vector with its dead zone and sprint
 * threshold, and a look drag turned into yaw and pitch. No DOM, unit tested
 * (test/touchInput.test.ts).
 */
import { NET, wrapAngle } from '@qwakk/shared';
import { TOUCH } from './constants.ts';

export interface StickOutput {
  /** Strafe axis, -1 (left) to 1 (right). */
  mx: number;
  /** Forward axis, -1 (back) to 1 (forward). Screen up is forward. */
  mz: number;
  /** Pushed to the edge and forward: sprint. */
  sprint: boolean;
  /** Knob offset to draw (px from the center, clamped to the ring). */
  knobX: number;
  knobY: number;
}

/**
 * The stick for a thumb at (dx, dy) px from where it landed (screen axes, y
 * down). The dead zone is cut off and the rest rescaled, so the speed ramps
 * from 0 just outside it to 1 at the ring.
 */
export function stickVector(dx: number, dy: number, radius = TOUCH.stickRadius, dead = TOUCH.stickDeadZone): StickOutput {
  const d = Math.hypot(dx, dy);
  if (!(d > 0) || !Number.isFinite(d)) return { mx: 0, mz: 0, sprint: false, knobX: 0, knobY: 0 };
  const share = Math.min(1, d / radius);
  const ux = dx / d;
  const uy = dy / d;
  const knobX = ux * share * radius;
  const knobY = uy * share * radius;
  if (share <= dead) return { mx: 0, mz: 0, sprint: false, knobX, knobY };
  const m = Math.min(1, (share - dead) / (1 - dead));
  const mx = ux * m;
  const mz = -uy * m;
  const sprint = share >= TOUCH.sprintAt && -uy >= TOUCH.sprintMinForward;
  return { mx, mz, sprint, knobX, knobY };
}

/**
 * Where the stick's center moves when the thumb runs past the ring: it is
 * dragged along, so pulling back after a long push reacts at once.
 */
export function followCenter(cx: number, cy: number, x: number, y: number, radius = TOUCH.stickRadius, follow = TOUCH.stickFollow): { cx: number; cy: number } {
  const dx = x - cx;
  const dy = y - cy;
  const d = Math.hypot(dx, dy);
  const max = radius + follow;
  if (d <= max) return { cx, cy };
  const k = (d - max) / d;
  return { cx: cx + dx * k, cy: cy + dy * k };
}

/**
 * Turn a drag of (dx, dy) px into new look angles. `radPerPx` already holds
 * the player's touch sensitivity; `scale` is the aim-down-sights multiplier.
 * Same conventions as the mouse: drag right turns right (yaw down), drag up
 * looks up.
 */
export function applyLook(yaw: number, pitch: number, dx: number, dy: number, radPerPx: number, scale = 1): { yaw: number; pitch: number } {
  const k = radPerPx * scale;
  return {
    yaw: wrapAngle(yaw - dx * k),
    pitch: Math.max(NET.minPitch, Math.min(NET.maxPitch, pitch - dy * k * TOUCH.lookPitchScale)),
  };
}
