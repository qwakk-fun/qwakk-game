import { describe, expect, it } from 'vitest';
import { FarInterp, FAR_INTERVAL_MS } from '../src/net/farInterp.ts';

const pose = (x: number) => ({ x, y: 0, z: 0, yaw: 0, pitch: 0, crouch: 0 });
const out = () => pose(0);

describe('far pose interpolation', () => {
  it('interpolates linearly between 10 Hz samples', () => {
    const f = new FarInterp();
    f.push(0, pose(0));
    f.push(100, pose(0.7));
    expect(f.sample(50, out()).x).toBeCloseTo(0.35, 6);
  });

  it('a duck that stood still starts moving when it does, not across the idle gap', () => {
    const f = new FarInterp();
    f.push(0, pose(0)); // stood here, nothing sent while idle
    f.push(1000, pose(0.7)); // first step after a second of standing
    // Halfway through the idle gap it is still standing where it was.
    expect(f.sample(500, out()).x).toBe(0);
    // It covers the 0.7 m over the last interval, at walking pace.
    expect(f.sample(1000 - FAR_INTERVAL_MS / 2, out()).x).toBeCloseTo(0.35, 6);
  });

  it('does not glide across a respawn', () => {
    const f = new FarInterp();
    f.push(0, pose(0));
    f.push(100, pose(50));
    expect(f.sample(50, out()).x).toBe(50);
  });
});
