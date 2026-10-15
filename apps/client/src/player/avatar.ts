/**
 * One duck in the scene: placement plus cheap procedural animation (waddle,
 * stance, air pose). Works for the local player and for remote players.
 */
import * as THREE from 'three/webgpu';
import { BODY } from '@qwakk/shared';
import { cloneDuckGlb, createPlaceholderDuck, type DuckParts } from './duckModel.ts';

export interface AvatarPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** 0 standing to 1 crouched (smoothed by the caller or here). */
  crouch: number;
  grounded: boolean;
}

export class Avatar {
  readonly object = new THREE.Group();
  private parts: DuckParts | null;
  private glb: THREE.Object3D | null = null;
  private crouchBlend = 0;
  private walkPhase = 0;
  private lastX = 0;
  private lastZ = 0;
  private hasLast = false;
  private airBlend = 0;

  constructor() {
    this.parts = createPlaceholderDuck();
    this.object.add(this.parts.root);
  }

  /** Swap the placeholder for the real duck model. */
  setModel(source: THREE.Object3D): void {
    if (this.parts) this.object.remove(this.parts.root);
    if (this.glb) this.object.remove(this.glb);
    this.parts = null;
    this.glb = cloneDuckGlb(source);
    this.object.add(this.glb);
  }

  update(pose: AvatarPose, dt: number): void {
    this.object.position.set(pose.x, pose.y, pose.z);
    this.object.rotation.y = pose.yaw;

    const k = 1 - Math.exp(-dt * BODY.crouchRate * 2);
    this.crouchBlend += (pose.crouch - this.crouchBlend) * k;
    this.airBlend += ((pose.grounded ? 0 : 1) - this.airBlend) * (1 - Math.exp(-dt * 12));

    // Distance-driven waddle so feet never slide at any speed.
    let speed = 0;
    if (this.hasLast && dt > 0) {
      const dx = pose.x - this.lastX;
      const dz = pose.z - this.lastZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 2) {
        speed = dist / dt;
        this.walkPhase += dist * 3.2;
      }
    }
    this.lastX = pose.x;
    this.lastZ = pose.z;
    this.hasLast = true;

    const p = this.parts;
    if (!p) return;
    const c = this.crouchBlend;
    const move = Math.min(speed / 5, 1) * (1 - this.airBlend);
    const swing = Math.sin(this.walkPhase) * 0.22 * move;
    p.footL.position.z = -0.04 + swing;
    p.footR.position.z = -0.04 - swing;
    p.footL.position.y = 0.03 + Math.max(0, Math.sin(this.walkPhase)) * 0.08 * move + this.airBlend * 0.12;
    p.footR.position.y = 0.03 + Math.max(0, -Math.sin(this.walkPhase)) * 0.08 * move + this.airBlend * 0.12;
    const bob = Math.abs(Math.sin(this.walkPhase)) * 0.05 * move;
    p.body.scale.y = 1 - c * 0.3;
    p.body.position.y = 0.72 - c * 0.24 + bob;
    p.body.rotation.z = Math.sin(this.walkPhase) * 0.08 * move;
    p.body.rotation.x = -0.12 * move - c * 0.15;
    p.head.position.y = 1.42 - c * 0.5 + bob;
  }

  /**
   * Remove from the scene. Nothing to free: placeholder geometry and all
   * materials are shared (see duckModel.ts, materials.ts), and GLB clones
   * share the source model's geometry and materials.
   */
  dispose(): void {
    this.object.removeFromParent();
  }
}
