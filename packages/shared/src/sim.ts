/**
 * Player movement: one fixed step of a CS style character on a Rapier
 * kinematic character controller. Pure apart from the shared, read-only
 * SimWorld: the same (state, input) gives the same next state on the client
 * (prediction and replay) and on the server (authority).
 */
import { ADS, BODY, DT, HEAL, HERO_FLIGHT, KNOCK, MOVE, TICK_RATE, WATER } from './constants.ts';
import { DM, DmPower } from './deathmatch.ts';
import { aimBlend, stepAim } from './ads.ts';
import { Button, type InputFrame } from './input.ts';
import { stepWeapon, type ShotFired } from './combat.ts';
import { WeaponId, weaponStats } from './weapons.ts';
import { dcos, dsin } from './math.ts';
import { CROUCH_CAPSULE, PLAYER_QUERY_GROUPS, STAND_CAPSULE, type SimWorld } from './physics.ts';
import { waterSurfaceAt } from './brMapData.ts';
import { stepDrop } from './drop.ts';
import { stepHeal } from './heal.ts';
import { isHero, stackSpeedFactor } from './dmBuffs.ts';
import { heroThrust, stepHeroEnergy, stepHeroVertical } from './heroFlight.ts';
import { exLauncher, lastExplosive, stepExplosives } from './explosives.ts';
import { exRoot, tickRoot } from './raid/root.ts';

/** Movement mode. Plane riders are not in the world; freefall and glide are the drop. */
export const Mode = {
  Ground: 0,
  Plane: 1,
  Freefall: 2,
  Glide: 3,
} as const;

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
  /** Movement mode (Mode.*). */
  mode: number;
  /** Health. The server applies damage; heals complete in the sim. */
  hp: number;
  /** Weapons owned, bit per WeaponId (deathmatch: both). Without the equipped one the duck is unarmed. */
  arms: number;
  /** Ticks left on the heal in progress (0: none) and which one (1 bandage, 2 medkit). */
  heal: number;
  healKind: number;
  /** Heal items carried. */
  bandages: number;
  medkits: number;
  /** Aim down sights: ticks into the aim, 0 (hip) to ADS.inTicks (full aim). */
  aim: number;
  /**
   * 1 while knocked (team modes, set by the server): the duck crawls at
   * KNOCK.crawlSpeed, stays low and cannot jump, shoot, aim, reload, switch
   * or heal. `hp` is then its bleed meter.
   */
  down: number;
  /** Deathmatch temporary effect, remaining simulation ticks and armor pool (zero in BR). */
  dmPower: number;
  dmPowerTicks: number;
  dmShield: number;
  /** Deathmatch kill stacks and the hero bit, packed (dmBuffs.ts; set by the server, zero in BR). */
  dmBuff: number;
  /** Deathmatch hero flight energy in ticks (heroFlight.ts; zero unless the hero). */
  dmEnergy: number;
  /**
   * Deathmatch explosives, packed (explosives.ts: grenades, rockets, the
   * launcher in hand and both gates in one integer; 0 in the battle royale).
   */
  ex: number;
}

/** Field list in a fixed order: reconciler mirror list and test helpers. */
export const PLAYER_SIM_FIELDS = [
  'x', 'y', 'z', 'vx', 'vy', 'vz', 'yaw', 'pitch', 'crouch', 'grounded', 'air', 'jumpBuf', 'prevButtons',
  'alive', 'weapon', 'equip', 'cooldown', 'reload', 'mag0', 'mag1', 'res0', 'res1', 'spray', 'shotSeq',
  'mode', 'hp', 'arms', 'heal', 'healKind', 'bandages', 'medkits', 'aim', 'down', 'dmPower', 'dmPowerTicks', 'dmShield',
  'dmBuff', 'dmEnergy',
  'ex',
] as const satisfies readonly (keyof PlayerSim)[];

export function createPlayerSim(x: number, y: number, z: number, yaw = 0): PlayerSim {
  const rifle = weaponStats(WeaponId.Rifle);
  const pistol = weaponStats(WeaponId.Pistol);
  return {
    x, y, z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0, crouch: 0, grounded: 0, air: 0, jumpBuf: 0, prevButtons: 0,
    alive: 1, weapon: WeaponId.Rifle, equip: 0, cooldown: 0, reload: 0,
    mag0: rifle.magSize, mag1: pistol.magSize, res0: rifle.reserve, res1: pistol.reserve, spray: 0, shotSeq: 0,
    mode: 0, hp: 100, arms: 3, heal: 0, healKind: 0, bandages: 0, medkits: 0, aim: 0, down: 0, dmPower: 0, dmPowerTicks: 0, dmShield: 0,
    dmBuff: 0, dmEnergy: 0,
    ex: 0,
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
  if (s.down) return KNOCK.crawlSpeed;
  if (s.heal > 0) return Math.min(HEAL.moveSpeed, s.crouch ? MOVE.crouchSpeed : HEAL.moveSpeed);
  if (s.crouch) return MOVE.crouchSpeed;
  if (input.buttons & Button.Walk) return MOVE.walkSpeed;
  // Aiming down sights: no sprint, and the speed eases down to the aim speed as the aim comes in.
  if (s.aim > 0) return MOVE.runSpeed + (ADS.moveSpeed - MOVE.runSpeed) * aimBlend(s);
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
function applyFriction(s: PlayerSim, dt: number, stopSpeed: number): void {
  const speed = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
  if (speed < 1e-4) {
    s.vx = 0;
    s.vz = 0;
    return;
  }
  const control = speed < stopSpeed ? stopSpeed : speed;
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
  lastExplosive.kind = 0;
  if (s.alive && s.mode === Mode.Ground && s.down) {
    // Knocked: crawl only. The weapon, the aim and heals stay frozen.
    s.aim = 0;
    stepMovement(sim, s, input, dt);
    tickRoot(s);
  } else if (s.alive && s.mode === Mode.Ground) {
    stepAim(s, input);
    stepMovement(sim, s, input, dt);
    tickRoot(s);
    stepHeal(s, input);
    // Grenade throw and the rocket launcher slot; with the launcher up the gun does not step.
    stepExplosives(s, input);
    if (!exLauncher(s)) shot = stepWeapon(s, input);
  } else if (s.alive && (s.mode === Mode.Freefall || s.mode === Mode.Glide)) {
    stepDrop(sim, s, input, dt);
    s.aim = 0;
  } else {
    s.yaw = input.yaw;
    s.pitch = input.pitch;
    s.aim = 0;
  }
  if (s.dmPowerTicks > 0 && --s.dmPowerTicks === 0) {
    s.dmPower = DmPower.None;
    s.dmShield = 0;
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
  // Knocked ducks stay low (the crouched capsule and hitbox).
  const wantCrouch = (buttons & Button.Crouch) !== 0 || s.down === 1;
  if (wantCrouch && !s.crouch) s.crouch = 1;
  else if (!wantCrouch && s.crouch && hasHeadroom(sim, s.x, s.y, s.z)) s.crouch = 0;

  // Caught in a Hunt Season trap (raid/root.ts): no walking and no jumping until it lets go.
  const rooted = s.ex !== 0 && exRoot(s) > 0;
  // Jump edge with a short buffer, so a press just before landing still fires.
  const jumpPressed = (buttons & Button.Jump) !== 0 && (s.prevButtons & Button.Jump) === 0 && s.down === 0 && !rooted;
  if (jumpPressed) s.jumpBuf = JUMP_BUFFER_TICKS;
  else if (s.jumpBuf > 0) s.jumpBuf -= 1;

  // Wish direction from the move axes, rotated by yaw. Forward is -z at yaw 0.
  const sy = dsin(s.yaw);
  const cy = dcos(s.yaw);
  let wx = input.mx * cy - input.mz * sy;
  let wz = -input.mx * sy - input.mz * cy;
  const wlen = Math.sqrt(wx * wx + wz * wz);
  let wishSpeed = 0;
  if (wlen > 1e-6 && !rooted) {
    wishSpeed = wishSpeedFor(s, input) * Math.min(wlen, 1) * wadeFactor(sim, s) * (s.dmPower === DmPower.Speed && s.dmPowerTicks > 0 ? DM.speedMultiplier : 1) * stackSpeedFactor(s);
    wx /= wlen;
    wz /= wlen;
  }

  const canJump = s.down === 0 && !rooted && s.jumpBuf > 0 && (s.grounded === 1 || s.air <= COYOTE_TICKS) && s.vy <= 0.5;
  const hero = isHero(s);
  if (s.grounded) {
    applyFriction(s, dt, s.down ? KNOCK.crawlStopSpeed : MOVE.stopSpeed);
    if (wishSpeed > 0) accelerate(s, wx, wz, wishSpeed, MOVE.groundAccel, dt, Infinity);
  } else if (hero) {
    // Caped hero in the air: full steering at the flight speed (heroFlight.ts), light drag.
    if (wishSpeed > 0) accelerate(s, wx, wz, HERO_FLIGHT.speed * Math.min(wlen, 1) * stackSpeedFactor(s), HERO_FLIGHT.airAccel, dt, Infinity);
    const drag = 1 - HERO_FLIGHT.drag * dt;
    s.vx *= drag;
    s.vz *= drag;
  } else {
    if (wishSpeed > 0) accelerate(s, wx, wz, wishSpeed, MOVE.airAccel, dt, MOVE.airWishSpeedCap);
    const drag = 1 - MOVE.airDrag * dt;
    s.vx *= drag;
    s.vz *= drag;
  }
  if (canJump) {
    s.vy = MOVE.jumpVelocity * (s.dmPower === DmPower.Jump && s.dmPowerTicks > 0 ? DM.jumpMultiplier : 1);
    s.jumpBuf = 0;
    s.grounded = 0;
    s.air = COYOTE_TICKS + 1;
  }

  // Gravity always pulls, so the controller keeps detecting the ground (the hero: thrust or glide instead).
  const thrust = hero && heroThrust(s, buttons, canJump);
  if (hero) stepHeroVertical(sim, s, thrust, dt);
  else {
    s.vy -= MOVE.gravity * dt;
    if (s.vy < -MOVE.maxFallSpeed) s.vy = -MOVE.maxFallSpeed;
  }

  const grounded = moveCapsule(sim, s, dt);
  if (grounded && s.vy <= 0) {
    s.grounded = 1;
    s.vy = 0;
    s.air = 0;
  } else {
    s.grounded = 0;
    if (s.air < 255) s.air += 1;
  }
  if (hero) stepHeroEnergy(s, thrust);
}

/** Speed factor for wading (river, shallow sea). 1 on dry land and on maps without water. */
export function wadeFactor(sim: SimWorld, s: PlayerSim): number {
  const w = sim.map.water;
  if (!w) return 1;
  const depth = waterSurfaceAt(w, s.x, s.z) - s.y;
  if (depth <= WATER.wadeDepth) return 1;
  return depth > WATER.deepDepth ? WATER.deepFactor : WATER.wadeFactor;
}

/**
 * Move the player's capsule by its velocity for one step through Rapier's
 * character controller, clip the velocity against what it hit, and return
 * whether it ended on walkable ground. Shared by walking and the drop.
 */
export function moveCapsule(sim: SimWorld, s: PlayerSim, dt: number): boolean {
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
  // Not while the controller lifts a grounded duck up a ramp or a stair ramp:
  // there the shorter horizontal move is the climb, not a wall, and clipping it
  // every step (plus stop-speed friction) left walking and crouching ducks
  // crawling up stairs at 0.1 to 0.2 m/s. Only a real lift counts: on flat
  // ground my (about 0) is still above the gravity step dy, and skipping the
  // clip there would keep wall-pushing ducks' velocity (lookahead, spread).
  const desiredH = dx * dx + dz * dz;
  const movedH = mx * mx + mz * mz;
  const climbing = grounded && s.grounded === 1 && my > 1e-3;
  if (desiredH > 1e-10 && movedH < desiredH * 0.98 && !climbing) {
    s.vx = mx / dt;
    s.vz = mz / dt;
  }
  // Ceiling bonk.
  if (dy > 0 && my < dy * 0.5 && !grounded) s.vy = 0;
  return grounded;
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
