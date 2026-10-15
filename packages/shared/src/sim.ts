/**
 * Player movement: one fixed step of a CS style character on a Rapier
 * kinematic character controller. Pure apart from the shared, read-only
 * SimWorld: the same (state, input) gives the same next state on the client
 * (prediction and replay) and on the server (authority).
 */
import { BODY, DT, MOVE, TICK_RATE } from './constants.ts';
import { Button, type InputFrame } from './input.ts';
import { stepWeapon, type ShotFired } from './combat.ts';
import { WeaponId, weaponStats } from './weapons.ts';
import { dcos, dsin } from './math.ts';
import { CROUCH_CAPSULE, PLAYER_QUERY_GROUPS, STAND_CAPSULE, type SimWorld } from './physics.ts';

/**
 * Everything the step reads or writes. All numbers, so it serializes as flat
 * schema fields and a reconciler can copy it field by field.
 */
export interface PlayerSim {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  /** 1 while crouched. */
  crouch: number;
  /** 1 while standing on walkable ground. */
  grounded: number;
  /** Ticks since last grounded (capped), drives coyote time. */
  air: number;
  /** Ticks left on a buffered jump press. */
  jumpBuf: number;
  /** Buttons of the previous step, for edge detection. */
  prevButtons: number;
  /** 1 while alive. Set by the server (death, respawn); a dead player does not move or shoot. */
  alive: number;
  /** Equipped weapon (WeaponId). */
  weapon: number;
  /** Ticks until the equipped weapon is ready after a switch. */
  equip: number;
  /** Ticks until the next shot is allowed (fire-rate gate). */
  cooldown: number;
  /** Ticks left on a reload, 0 when not reloading. */
  reload: number;
  /** Rounds in the magazine and in reserve, per weapon. */
  mag0: number;
  mag1: number;
  res0: number;
  res1: number;
  /** Shots into the current spray (fractional while it recovers). Indexes the spray pattern. */
  spray: number;
  /** Shots fired so far (wraps at 65536). Seeds each shot's spread. */
  shotSeq: number;
}

/** Field list in a fixed order: reconciler mirror list and test helpers. */
export const PLAYER_SIM_FIELDS = [
  'x', 'y', 'z', 'vx', 'vy', 'vz', 'yaw', 'pitch', 'crouch', 'grounded', 'air', 'jumpBuf', 'prevButtons',
  'alive', 'weapon', 'equip', 'cooldown', 'reload', 'mag0', 'mag1', 'res0', 'res1', 'spray', 'shotSeq',
] as const satisfies readonly (keyof PlayerSim)[];

export function createPlayerSim(x: number, y: number, z: number, yaw = 0): PlayerSim {
  const rifle = weaponStats(WeaponId.Rifle);
  const pistol = weaponStats(WeaponId.Pistol);
  return {
    x, y, z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0, crouch: 0, grounded: 0, air: 0, jumpBuf: 0, prevButtons: 0,
    alive: 1, weapon: WeaponId.Rifle, equip: 0, cooldown: 0, reload: 0,
    mag0: rifle.magSize, mag1: pistol.magSize, res0: rifle.reserve, res1: pistol.reserve, spray: 0, shotSeq: 0,
  };
}

export function copyPlayerSim(from: PlayerSim, to: PlayerSim): PlayerSim {
  for (const f of PLAYER_SIM_FIELDS) to[f] = from[f];
  return to;
}

const COYOTE_TICKS = Math.round(MOVE.coyoteTime * TICK_RATE);
const JUMP_BUFFER_TICKS = Math.round(MOVE.jumpBuffer * TICK_RATE);

/** Target ground speed for the current buttons and stance. */
export function wishSpeedFor(s: PlayerSim, input: InputFrame): number {
  if (s.crouch) return MOVE.crouchSpeed;
  if (input.buttons & Button.Walk) return MOVE.walkSpeed;
  // No sprinting while the trigger is held.
  if (input.buttons & Button.Sprint && input.mz >= MOVE.sprintMinForward && !(input.buttons & Button.Fire)) return MOVE.sprintSpeed;
  return MOVE.runSpeed;
}

/** Quake/CS accelerate: add speed along wishDir up to wishSpeed. */
function accelerate(s: PlayerSim, wx: number, wz: number, wishSpeed: number, accel: number, dt: number, cap: number): void {
  const current = s.vx * wx + s.vz * wz;
  const target = Math.min(wishSpeed, cap);
  const add = target - current;
  if (add <= 0) return;
  let amount = accel * wishSpeed * dt;
  if (amount > add) amount = add;
  s.vx += amount * wx;
  s.vz += amount * wz;
}

/** Ground friction with a stop-speed floor for crisp stops and counter-strafes. */
function applyFriction(s: PlayerSim, dt: number): void {
  const speed = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
  if (speed < 1e-4) {
    s.vx = 0;
    s.vz = 0;
    return;
  }
  const control = speed < MOVE.stopSpeed ? MOVE.stopSpeed : speed;
  const drop = control * MOVE.friction * dt;
  const scale = Math.max(speed - drop, 0) / speed;
  s.vx *= scale;
  s.vz *= scale;
}

/** True when the standing capsule fits at the given feet position. */
function hasHeadroom(sim: SimWorld, x: number, y: number, z: number): boolean {
  const hit = sim.world.intersectionWithShape(
    { x, y: y + STAND_CAPSULE.centerY + 0.02, z },
    { x: 0, y: 0, z: 0, w: 1 },
    sim.standShape,
    undefined,
    PLAYER_QUERY_GROUPS,
  );
  return hit === null;
}

const f32 = Math.fround;
/** Lift used by the stuck-on-ground retry (m). */
const UNSTICK_LIFT = 0.004;

/**
 * Advance one player by one fixed step: movement, then the weapon. Mutates `s`
 * in place. The input must already be sanitized (see sanitizeInputFields).
 * Returns the shot fired this step (a reused object, read it right away) or null.
 */
export function stepPlayer(sim: SimWorld, s: PlayerSim, input: InputFrame, dt: number = DT): ShotFired | null {
  const buttons = input.buttons | 0;
  let shot: ShotFired | null = null;
  if (s.alive) {
    stepMovement(sim, s, input, dt);
    shot = stepWeapon(s, input);
  } else {
    s.yaw = input.yaw;
    s.pitch = input.pitch;
  }
  s.prevButtons = buttons;
  quantize(s);
  return shot;
}

function quantize(s: PlayerSim): void {
  // Float32 so the authoritative state is exactly what the wire carries; the
  // client then replays from bit-identical values.
  s.x = f32(s.x);
  s.y = f32(s.y);
  s.z = f32(s.z);
  s.vx = f32(s.vx);
  s.vy = f32(s.vy);
  s.vz = f32(s.vz);
  s.yaw = f32(s.yaw);
  s.pitch = f32(s.pitch);
  s.spray = f32(s.spray);
}

function stepMovement(sim: SimWorld, s: PlayerSim, input: InputFrame, dt: number): void {
  const buttons = input.buttons | 0;

  // Look: the character faces the camera yaw.
  s.yaw = input.yaw;
  s.pitch = input.pitch;

  // Stance. Standing up needs room above the head.
  const wantCrouch = (buttons & Button.Crouch) !== 0;
  if (wantCrouch && !s.crouch) s.crouch = 1;
  else if (!wantCrouch && s.crouch && hasHeadroom(sim, s.x, s.y, s.z)) s.crouch = 0;

  // Jump edge with a short buffer, so a press just before landing still fires.
  const jumpPressed = (buttons & Button.Jump) !== 0 && (s.prevButtons & Button.Jump) === 0;
  if (jumpPressed) s.jumpBuf = JUMP_BUFFER_TICKS;
  else if (s.jumpBuf > 0) s.jumpBuf -= 1;

  // Wish direction from the move axes, rotated by yaw. Forward is -z at yaw 0.
  const sy = dsin(s.yaw);
  const cy = dcos(s.yaw);
  let wx = input.mx * cy - input.mz * sy;
  let wz = -input.mx * sy - input.mz * cy;
  const wlen = Math.sqrt(wx * wx + wz * wz);
  let wishSpeed = 0;
  if (wlen > 1e-6) {
    wishSpeed = wishSpeedFor(s, input) * Math.min(wlen, 1);
    wx /= wlen;
    wz /= wlen;
  }

  const canJump = s.jumpBuf > 0 && (s.grounded === 1 || s.air <= COYOTE_TICKS) && s.vy <= 0.5;
  if (s.grounded) {
    applyFriction(s, dt);
    if (wishSpeed > 0) accelerate(s, wx, wz, wishSpeed, MOVE.groundAccel, dt, Infinity);
  } else {
    if (wishSpeed > 0) accelerate(s, wx, wz, wishSpeed, MOVE.airAccel, dt, MOVE.airWishSpeedCap);
    const drag = 1 - MOVE.airDrag * dt;
    s.vx *= drag;
    s.vz *= drag;
  }
  if (canJump) {
    s.vy = MOVE.jumpVelocity;
    s.jumpBuf = 0;
    s.grounded = 0;
    s.air = COYOTE_TICKS + 1;
  }

  // Gravity always pulls, so the controller keeps detecting the ground.
  s.vy -= MOVE.gravity * dt;
  if (s.vy < -MOVE.maxFallSpeed) s.vy = -MOVE.maxFallSpeed;

  // Move the stance probe to the player and let Rapier resolve the motion.
  const cap = s.crouch ? CROUCH_CAPSULE : STAND_CAPSULE;
  const probe = s.crouch ? sim.probeCrouch : sim.probeStand;
  probe.setTranslation({ x: s.x, y: s.y + cap.centerY, z: s.z });
  const dx = s.vx * dt;
  const dy = s.vy * dt;
  const dz = s.vz * dt;
  const ctl = sim.controller;
  ctl.computeColliderMovement(probe, { x: dx, y: dy, z: dz }, undefined, PLAYER_QUERY_GROUPS);
  let m = ctl.computedMovement();
  let grounded = ctl.computedGrounded();
  let mx = m.x;
  let my = m.y;
  let mz = m.z;

  // Rapier's controller occasionally reports a zero-time hit with the ground
  // it rests on and refuses to move at all (about 1 step in 1500 while
  // running). That reads as a hitch, so retry once from a few millimeters up.
  if (s.grounded && dx * dx + dz * dz > 1e-8 && mx * mx + mz * mz < 1e-12) {
    probe.setTranslation({ x: s.x, y: s.y + cap.centerY + UNSTICK_LIFT, z: s.z });
    ctl.computeColliderMovement(probe, { x: dx, y: dy - UNSTICK_LIFT, z: dz }, undefined, PLAYER_QUERY_GROUPS);
    m = ctl.computedMovement();
    if (m.x * m.x + m.z * m.z > 1e-12) {
      mx = m.x;
      my = m.y + UNSTICK_LIFT;
      mz = m.z;
      grounded = ctl.computedGrounded();
    }
  }

  s.x += mx;
  s.y += my;
  s.z += mz;

  // Clip horizontal velocity against walls (slide along them, no stored push).
  const desiredH = dx * dx + dz * dz;
  const movedH = mx * mx + mz * mz;
  if (desiredH > 1e-10 && movedH < desiredH * 0.98) {
    s.vx = mx / dt;
    s.vz = mz / dt;
  }
  // Ceiling bonk.
  if (dy > 0 && my < dy * 0.5 && !grounded) s.vy = 0;

  if (grounded && s.vy <= 0) {
    s.grounded = 1;
    s.vy = 0;
    s.air = 0;
  } else {
    s.grounded = 0;
    if (s.air < 255) s.air += 1;
  }
}

/**
 * Push a player horizontally through the character controller, so a push can
 * never move it into a wall. Used by the server's player separation.
 */
export function nudgePlayer(sim: SimWorld, s: PlayerSim, dx: number, dz: number): void {
  const cap = s.crouch ? CROUCH_CAPSULE : STAND_CAPSULE;
  const probe = s.crouch ? sim.probeCrouch : sim.probeStand;
  probe.setTranslation({ x: s.x, y: s.y + cap.centerY, z: s.z });
  sim.controller.computeColliderMovement(probe, { x: dx, y: 0, z: dz }, undefined, PLAYER_QUERY_GROUPS);
  const m = sim.controller.computedMovement();
  s.x = f32(s.x + m.x);
  s.z = f32(s.z + m.z);
}

/** Eye height above the feet for the current stance (camera pivot). */
export function eyeHeight(crouchBlend: number): number {
  return BODY.standEye + (BODY.crouchEye - BODY.standEye) * crouchBlend;
}
