/**
 * Deterministic math helpers.
 *
 * Math.sin / Math.cos are not guaranteed to return bit-identical results across
 * JS engines (V8 on the server, JavaScriptCore in Safari). The sim only uses
 * +, -, *, /, Math.sqrt, Math.floor and the polynomial approximations below,
 * which are exact IEEE-754 operations everywhere. This keeps prediction on the
 * client bit-identical with the server and makes a later Rust/WASM port simple.
 */

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

/** Wrap an angle into [-PI, PI). */
export function wrapAngle(a: number): number {
  return a - TAU * Math.floor((a + PI) / TAU);
}

/** Sine on [-PI/2, PI/2] via an odd minimax-style Taylor polynomial (error < 1e-9). */
function sinCore(x: number): number {
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 *
            (1 / 120 +
              x2 *
                (-1 / 5040 +
                  x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800)))))))
  );
}

/** Deterministic sine. */
export function dsin(a: number): number {
  let x = wrapAngle(a);
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  return sinCore(x);
}

/** Deterministic cosine. */
export function dcos(a: number): number {
  return dsin(a + HALF_PI);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Shortest-path angle interpolation. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}
