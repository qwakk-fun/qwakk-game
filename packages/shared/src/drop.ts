/**
 * The drop: freefall and the glider, stepped in the shared sim so the local
 * duck is predicted like walking. Jumping out of the plane is the server's
 * call (it places the duck at the plane), so it is not in here.
 *
 * Freefall falls fast with a little steering; W dives faster. The glider
 * opens on Space or F, or by itself near the ground. Gliding flies where the
 * camera looks: about 1:3 cruising, W dives (faster, steeper), S brakes.
 * Touching walkable ground ends the drop.
 */
import { DROP, MOVE } from './constants.ts';
import { Button, type InputFrame } from './input.ts';
import { terrainHeightAt } from './map.ts';
import { dcos, dsin } from './math.ts';
import type { SimWorld } from './physics.ts';
import { Mode, moveCapsule, type PlayerSim } from './sim.ts';

function approach(v: number, target: number, rate: number, dt: number): number {
  const k = Math.min(1, rate * dt);
  return v + (target - v) * k;
}

export function stepDrop(sim: SimWorld, s: PlayerSim, input: InputFrame, dt: number): void {
  const b = input.buttons | 0;
  s.yaw = input.yaw;
  s.pitch = input.pitch;
  s.crouch = 0;
  s.heal = 0;
  s.healKind = 0;
  s.reload = 0;
  const sy = dsin(s.yaw);
  const cy = dcos(s.yaw);
  // Forward is -z at yaw 0, right is +x.
  const fx = -sy;
  const fz = -cy;
  const rx = cy;
  const rz = -sy;
  const ground = terrainHeightAt(sim.map.terrain, s.x, s.z);
  const above = s.y - ground;

  if (s.mode === Mode.Freefall) {
    const opened = (b & (Button.Jump | Button.Deploy)) !== 0 && (s.prevButtons & (Button.Jump | Button.Deploy)) === 0;
    // `air` counts ticks since the jump; the glider needs a short fall first.
    if (s.air < 255) s.air += 1;
    const fallen = s.air * dt * DROP.freefallSpeed * 0.5;
    if ((opened && fallen > DROP.minFallBeforeOpen) || above < DROP.autoOpenHeight) s.mode = Mode.Glide;
    else {
      const tx = (rx * input.mx + fx * input.mz) * DROP.freefallSteer;
      const tz = (rz * input.mx + fz * input.mz) * DROP.freefallSteer;
      s.vx = approach(s.vx, tx, DROP.steerRate, dt);
      s.vz = approach(s.vz, tz, DROP.steerRate, dt);
      const fall = DROP.freefallSpeed + (input.mz > 0 ? input.mz * DROP.freefallDiveExtra : 0);
      s.vy = Math.max(-fall, s.vy - MOVE.gravity * dt);
    }
  }
  if (s.mode === Mode.Glide) {
    const m = input.mz;
    const fwd = m > 0 ? DROP.glideForward + (DROP.glideDiveForward - DROP.glideForward) * m : DROP.glideForward + (DROP.glideForward - DROP.glideBrakeForward) * m;
    const sink = m > 0 ? DROP.glideSink + (DROP.glideDiveSink - DROP.glideSink) * m : DROP.glideSink + (DROP.glideSink - DROP.glideBrakeSink) * m;
    const tx = fx * fwd + rx * input.mx * DROP.glideStrafe;
    const tz = fz * fwd + rz * input.mx * DROP.glideStrafe;
    s.vx = approach(s.vx, tx, DROP.steerRate, dt);
    s.vz = approach(s.vz, tz, DROP.steerRate, dt);
    s.vy = approach(s.vy, -sink, DROP.sinkRate, dt);
  }

  const grounded = moveCapsule(sim, s, dt);
  if (grounded && s.vy <= 0) {
    // Landed: back on foot, keeping at most run speed.
    s.mode = Mode.Ground;
    s.grounded = 1;
    s.vy = 0;
    s.air = 0;
    s.jumpBuf = 0;
    const h = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
    if (h > MOVE.runSpeed) {
      s.vx *= MOVE.runSpeed / h;
      s.vz *= MOVE.runSpeed / h;
    }
  } else {
    s.grounded = 0;
  }
}
