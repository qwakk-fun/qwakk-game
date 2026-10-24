/**
 * Hunt Season's hitch hunt, the duck sim part: on Pond Keep a running duck
 * used to stop dead for one tick now and then (Rapier's controller clipping a
 * grounded step on a near-zero-time ground hit; 0.87% of running steps in the
 * courtyard). `moveCapsule` retries such a step from a few millimeters up.
 * This scans runs across the courtyard and counts one-tick dips.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Button, createPlayerSim, createSimWorld, groundHeightAt, initPhysics, RAID, stepPlayer, type InputFrame } from '@qwakk/shared';
import { loadMapV1 } from '../../src/maps.ts';

beforeAll(async () => {
  await initPhysics();
});

describe('Pond Keep footing', () => {
  it('a running duck does not snag on the courtyard floor', () => {
    const sim = createSimWorld(loadMapV1(RAID.mapId).def);
    let ticks = 0;
    let snags = 0;
    for (let gx = -14; gx <= 14; gx += 4.3) {
      for (let gz = -14; gz <= 14; gz += 4.3) {
        for (const yaw of [0, 1.6, 3.2, 4.8]) {
          const y = groundHeightAt(sim, gx, 30, gz);
          if (!(y > -1)) continue;
          const s = createPlayerSim(gx, y + 0.05, gz, yaw);
          const f: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 1, buttons: 0, yaw, pitch: 0 };
          for (let i = 0; i < 10; i++) stepPlayer(sim, s, { ...f, mz: 0 });
          const speeds: number[] = [];
          for (let i = 0; i < 60; i++) {
            const px = s.x;
            const pz = s.z;
            stepPlayer(sim, s, f);
            speeds.push(Math.hypot(s.x - px, s.z - pz) * 30);
          }
          // A snag: one tick well under the speed of the ticks around it (a wall would stay low).
          for (let i = 12; i < speeds.length - 3; i++) {
            const before = speeds[i - 1]!;
            const after = Math.max(speeds[i + 1]!, speeds[i + 2]!, speeds[i + 3]!);
            ticks++;
            if (before > 3 && after > 3 && speeds[i]! < 0.6 * Math.min(before, after)) snags++;
          }
        }
      }
    }
    expect(ticks).toBeGreaterThan(5000);
    // Without the retry: about 0.9%; with it about 0.15% (wall contacts).
    expect(snags / ticks).toBeLessThan(0.004);
    sim.dispose();
  }, 60_000);
});
