/**
 * Over-the-shoulder camera on a spring arm.
 *
 * Rules that keep aiming crisp:
 * - Rotation comes straight from the mouse every frame, never smoothed, so the
 *   crosshair (screen center) is always exactly where the mouse put it.
 * - The pivot follows the rendered player with no positional lag. Only its
 *   height is lightly smoothed, which hides stair steps and crouch pops.
 * - The arm is a sphere cast against the world: it pulls in instantly when a
 *   wall gets in the way and eases back out when the way clears.
 */
import * as THREE from 'three/webgpu';
import { eyeHeight, PLAYER_QUERY_GROUPS, type SimWorld } from '@qwakk/shared';

export const CAMERA = {
  armLength: 3.1,
  shoulderX: 0.75,
  shoulderY: 0.32,
  /** Sphere radius used for the arm collision cast. */
  probeRadius: 0.22,
  /** Shoulder swap time constant (s). */
  swapTau: 0.08,
  /** Arm ease-out time constant after a collision clears (s). */
  armReturnTau: 0.18,
  /** Pivot height smoothing time constant (s). */
  heightTau: 0.06,
  baseFov: 75,
  sprintFov: 81,
  fovTau: 0.15,
} as const;

export class TpsCamera {
  readonly camera: THREE.PerspectiveCamera;
  private readonly sim: SimWorld;
  private side = 1;
  private sideBlend = 1;
  private arm: number = CAMERA.armLength;
  private pivotY = Number.NaN;
  private fov: number = CAMERA.baseFov;
  private readonly shape: InstanceType<SimWorld['rapier']['Ball']>;
  private readonly pivot = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly origin = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, sim: SimWorld) {
    this.camera = camera;
    this.sim = sim;
    this.shape = new sim.rapier.Ball(CAMERA.probeRadius);
  }

  swapShoulder(): void {
    this.side = -this.side;
  }

  /** The pivot point the camera orbits (head height), for the shadow follow etc. */
  get pivotPoint(): THREE.Vector3 {
    return this.pivot;
  }

  update(dt: number, px: number, py: number, pz: number, crouchBlend: number, yaw: number, pitch: number, sprinting: boolean): void {
    // Pivot at eye height with smoothed vertical motion.
    const targetY = py + eyeHeight(crouchBlend);
    if (Number.isNaN(this.pivotY) || Math.abs(targetY - this.pivotY) > 3) this.pivotY = targetY;
    else this.pivotY += (targetY - this.pivotY) * (1 - Math.exp(-dt / CAMERA.heightTau));
    this.pivot.set(px, this.pivotY, pz);

    this.sideBlend += (this.side - this.sideBlend) * (1 - Math.exp(-dt / CAMERA.swapTau));

    const cp = Math.cos(pitch);
    this.forward.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    this.right.set(Math.cos(yaw), 0, -Math.sin(yaw));

    // Shoulder point: pivot moved sideways and up. Cast there first so the
    // camera never ends up inside a wall the player is hugging.
    this.origin.copy(this.pivot);
    this.dir.copy(this.right).multiplyScalar(CAMERA.shoulderX * this.sideBlend).addScaledVector(this.up, CAMERA.shoulderY);
    const sideLen = this.dir.length();
    this.dir.divideScalar(sideLen);
    const sideHit = this.cast(this.origin, this.dir, sideLen);
    this.origin.addScaledVector(this.dir, sideHit);

    // Then the arm itself, straight back along the view direction.
    this.dir.copy(this.forward).negate();
    const armHit = this.cast(this.origin, this.dir, CAMERA.armLength);
    if (armHit < this.arm) this.arm = armHit;
    else this.arm += (armHit - this.arm) * (1 - Math.exp(-dt / CAMERA.armReturnTau));

    this.camera.position.copy(this.origin).addScaledVector(this.dir, this.arm);
    this.lookTarget.copy(this.camera.position).add(this.forward);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.lookTarget);

    const targetFov = sprinting ? CAMERA.sprintFov : CAMERA.baseFov;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt / CAMERA.fovTau));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Free distance along a ray for the probe sphere, minus a small margin. */
  private cast(from: THREE.Vector3, dir: THREE.Vector3, max: number): number {
    const hit = this.sim.world.castShape(
      { x: from.x, y: from.y, z: from.z },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: dir.x, y: dir.y, z: dir.z },
      this.shape,
      0,
      max,
      true,
      undefined,
      PLAYER_QUERY_GROUPS,
    );
    if (!hit) return max;
    return Math.max(0, hit.time_of_impact - 0.02);
  }
}
