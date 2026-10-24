/** Frame timing and motion smoothness probes for the HUD and the browser tests. */
import { MOVE } from '@qwakk/shared';

/** Rolling frame-time window for the HUD and the test hook. */
export class FrameTimer {
  private samples: number[] = [];
  private last = 0;
  fps = 0;
  avg = 0;
  max = 0;
  private acc = 0;
  /** Main-thread time spent in our frame (input, sim, scene update, render submit), ms. */
  private cpu: number[] = [];
  cpuAvg = 0;
  cpuP95 = 0;

  /** Record the CPU time of one frame (from the start of frame() to the end). */
  cpuSample(ms: number): void {
    this.cpu.push(ms);
    if (this.cpu.length >= 120) {
      const sorted = [...this.cpu].sort((a, b) => a - b);
      this.cpuAvg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
      this.cpuP95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
      this.cpu = [];
    }
  }

  frame(now: number): number {
    const dt = this.last === 0 ? 16.7 : now - this.last;
    this.last = now;
    this.samples.push(dt);
    this.acc += dt;
    if (this.acc >= 500) {
      const sum = this.samples.reduce((a, b) => a + b, 0);
      this.avg = sum / this.samples.length;
      this.max = Math.max(...this.samples);
      this.fps = 1000 / this.avg;
      this.samples = [];
      this.acc = 0;
    }
    return Math.min(dt, 100) / 1000;
  }
}

/**
 * Smoothness probe: the horizontal speed of what is actually drawn. A visible
 * snap shows up as a frame whose drawn speed is far above any real move speed.
 */
export class MotionProbe {
  maxSpeed = 0;
  snapFrames = 0;
  /** Frames drawn standing (nearly) still in the middle of a run: a stop-start hitch. */
  stallFrames = 0;
  frames = 0;
  private smooth = 0;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;

  sample(x: number, z: number, dt: number): void {
    if (!Number.isNaN(this.lastX) && dt > 0) {
      const v = Math.hypot(x - this.lastX, z - this.lastZ) / dt;
      if (v < 50) {
        this.frames += 1;
        if (v > this.maxSpeed) this.maxSpeed = v;
        if (v > MOVE.sprintSpeed * 1.6) this.snapFrames += 1;
        if (this.smooth > MOVE.runSpeed * 0.6 && v < this.smooth * 0.3) this.stallFrames += 1;
        this.smooth += (v - this.smooth) * Math.min(1, dt * 10);
      }
    }
    this.lastX = x;
    this.lastZ = z;
  }

  /** The thing was not drawn (culled): the next sample starts fresh instead of counting the jump. */
  gap(): void {
    this.lastX = Number.NaN;
    this.lastZ = Number.NaN;
  }

  reset(): void {
    this.maxSpeed = 0;
    this.snapFrames = 0;
    this.stallFrames = 0;
    this.frames = 0;
  }
}

