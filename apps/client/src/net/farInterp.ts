/**
 * Interpolation for far players (10 Hz poses).
 *
 * Colyseus `Predict` lerp treats any gap longer than 1.5 patch intervals as
 * "the entity was idle" and inserts a held sample, which is right for a player
 * who stops, but turns a steady 10 Hz stream into stop-go motion. So far poses
 * use this small buffer instead: samples stamped with the server time of the
 * patch that carried them, drawn `delayMs` behind the server clock.
 */
import { wrapAngle } from '@qwakk/shared';

interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  crouch: number;
}

export interface FarPoseLike {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  crouch: number;
}

const CAP = 8;
/** Far poses arrive every 100 ms while the duck moves. */
export const FAR_INTERVAL_MS = 100;
const IDLE_GAP_MS = FAR_INTERVAL_MS * 1.5;

export class FarInterp {
  private readonly samples: Sample[] = [];

  push(t: number, p: FarPoseLike): void {
    const last = this.samples[this.samples.length - 1];
    if (last && t <= last.t) {
      // Same patch time: replace (several fields of one update arrive separately).
      Object.assign(last, { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, crouch: p.crouch });
      return;
    }
    // A jump of more than 8 m is a respawn: restart the buffer so we do not glide across the map.
    if (last && Math.hypot(p.x - last.x, p.z - last.z) > 8) this.samples.length = 0;
    // A gap of more than 1.5 intervals means the duck stood still (nothing changed, nothing was sent):
    // hold the old pose until one interval before this sample, so it starts moving now instead of
    // gliding across the whole idle gap.
    else if (last && t - last.t > IDLE_GAP_MS) this.samples.push({ ...last, t: t - FAR_INTERVAL_MS });
    this.samples.push({ t, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, crouch: p.crouch });
    if (this.samples.length > CAP) this.samples.shift();
  }

  get empty(): boolean {
    return this.samples.length === 0;
  }

  /** Pose at server time `t` (clamped to the buffer). */
  sample(t: number, out: FarPoseLike): FarPoseLike {
    const s = this.samples;
    const first = s[0];
    const last = s[s.length - 1];
    if (!first || !last) return out;
    if (t <= first.t) return Object.assign(out, pick(first));
    if (t >= last.t) return Object.assign(out, pick(last));
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1] as Sample;
      const b = s[i] as Sample;
      if (t < a.t) continue;
      const u = (t - a.t) / (b.t - a.t);
      out.x = a.x + (b.x - a.x) * u;
      out.y = a.y + (b.y - a.y) * u;
      out.z = a.z + (b.z - a.z) * u;
      out.yaw = a.yaw + wrapAngle(b.yaw - a.yaw) * u;
      out.pitch = a.pitch + (b.pitch - a.pitch) * u;
      out.crouch = a.crouch + (b.crouch - a.crouch) * u;
      return out;
    }
    return Object.assign(out, pick(last));
  }
}

function pick(s: Sample): FarPoseLike {
  return { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, crouch: s.crouch };
}
