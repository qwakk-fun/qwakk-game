import { NET } from './constants.ts';
import { clamp, wrapAngle } from './math.ts';

/** Button bitmask. */
export const Button = {
  Jump: 1 << 0,
  Sprint: 1 << 1,
  Crouch: 1 << 2,
  Walk: 1 << 3,
} as const;

export const ALL_BUTTONS = Button.Jump | Button.Sprint | Button.Crouch | Button.Walk;

/** One sim tick of player intent. This is all a client ever sends. */
export interface InputFrame {
  /** Client sequence number, strictly increasing by 1. */
  seq: number;
  /** Client's estimate of the server tick when it produced this input (diagnostics only). */
  tick: number;
  /** Strafe axis, -1 (left) to 1 (right). */
  mx: number;
  /** Forward axis, -1 (back) to 1 (forward). */
  mz: number;
  buttons: number;
  /** Camera yaw (rad). Character faces this way. */
  yaw: number;
  /** Camera pitch (rad). */
  pitch: number;
}

export function emptyInput(seq = 0): InputFrame {
  return { seq, tick: 0, mx: 0, mz: 0, buttons: 0, yaw: 0, pitch: 0 };
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** The fields of an input frame that a sanitizer touches. */
export interface InputFields {
  mx: number;
  mz: number;
  buttons: number;
  yaw: number;
  pitch: number;
}

/**
 * Clamp untrusted input fields in place: NaN and Infinity become 0, axes are
 * clamped and normalized so diagonals are never faster, unknown buttons are
 * masked off, yaw is wrapped and pitch is clamped. Used by the server's
 * Colyseus `defineInput({ sanitize })` and by sanitizeInput below.
 */
export function sanitizeInputFields(f: InputFields): void {
  let mx = clamp(num(f.mx), -1, 1);
  let mz = clamp(num(f.mz), -1, 1);
  const len = Math.sqrt(mx * mx + mz * mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  f.mx = mx;
  f.mz = mz;
  f.buttons = (num(f.buttons) | 0) & ALL_BUTTONS;
  f.yaw = wrapAngle(num(f.yaw));
  f.pitch = clamp(num(f.pitch), NET.minPitch, NET.maxPitch);
}

/** Validate a whole untrusted frame (sequence included). Returns null when unusable. */
export function sanitizeInput(raw: unknown): InputFrame | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const seq = num(r.seq, -1);
  if (!Number.isInteger(seq) || seq < 0 || seq > 0xffffffff) return null;
  const frame: InputFrame = {
    seq,
    tick: Math.max(0, Math.floor(num(r.tick))) >>> 0,
    mx: num(r.mx),
    mz: num(r.mz),
    buttons: num(r.buttons),
    yaw: num(r.yaw),
    pitch: num(r.pitch),
  };
  sanitizeInputFields(frame);
  return frame;
}

/**
 * Limit how fast yaw and pitch can turn between two processed inputs.
 * Applied on the server only, against the last accepted angles.
 */
export function clampAngleRate(prevYaw: number, prevPitch: number, input: InputFrame, ticks = 1): void {
  const max = NET.maxAngleDeltaPerTick * Math.max(1, ticks);
  const dy = wrapAngle(input.yaw - prevYaw);
  if (dy > max) input.yaw = wrapAngle(prevYaw + max);
  else if (dy < -max) input.yaw = wrapAngle(prevYaw - max);
  const dp = input.pitch - prevPitch;
  if (dp > max) input.pitch = prevPitch + max;
  else if (dp < -max) input.pitch = prevPitch - max;
}
