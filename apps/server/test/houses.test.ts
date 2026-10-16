/**
 * Every enterable house on Sainte-Canard can be walked: a sim duck runs the
 * waypoints the map kit exports per house type (`walk` in the prop manifest:
 * in through the door, across the rooms, up the stairs or the debris ramp,
 * onto the upper floor), on every placed instance of that house, running and
 * crouched (the slowest gait, where per-step stair colliders used to stall the
 * controller's autostep), with the same movement code and colliders the game
 * uses. Catches blocked doors, stairs the character controller cannot climb and
 * props placed in front of an entrance.
 */
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Button, createPlayerSim, createSimWorld, dcos, dsin, initPhysics, sanitizeInputFields, stepPlayer, type InputFrame } from '@qwakk/shared';
import { loadSainteCanard } from '../src/maps.ts';

const manifestUrl = new URL('../../../apps/client/public/models/props/manifest.json', import.meta.url);

type Vec3 = [number, number, number];

beforeAll(async () => {
  await initPhysics();
});

describe.skipIf(!existsSync(manifestUrl))('house walkthroughs on Sainte-Canard', () => {
  it.each([
    ['running', 0],
    ['crouched', Button.Crouch],
  ])('a duck walks every house path (doors, stairs, ramps, upper floors) on every placed house, %s', (_gait, gait) => {
    const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8')) as { props: Record<string, { walk?: Vec3[][] }> };
    const loaded = loadSainteCanard().loaded!;
    const sim = createSimWorld(loaded.def);
    const failures: string[] = [];
    let walked = 0;
    for (const inst of loaded.extras.props) {
      const walks = manifest.props[inst.prop]?.walk;
      if (!walks) continue;
      const c = dcos(inst.rotY);
      const s = dsin(inst.rotY);
      const toWorld = ([lx, ly, lz]: Vec3): Vec3 => [inst.x + c * lx + s * lz, inst.y + ly, inst.z - s * lx + c * lz];
      walks.forEach((path, k) => {
        const pts = path.map(toWorld);
        const [x0, y0, z0] = pts[0]!;
        const duck = createPlayerSim(x0, y0 + 0.3, z0);
        const frame: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 1, buttons: 0, yaw: 0, pitch: 0 };
        const where = `${inst.prop} at (${inst.x}, ${inst.z}) path ${k}`;
        const limit = gait ? 420 : 240;
        for (let i = 1; i < pts.length; i++) {
          const [tx, ty, tz] = pts[i]!;
          let ticks = 0;
          for (; ticks < limit; ticks++) {
            const dx = tx - duck.x;
            const dz = tz - duck.z;
            const d = Math.hypot(dx, dz);
            if (d < 0.3) break;
            frame.yaw = Math.atan2(-dx, -dz);
            frame.mz = 1;
            frame.mx = 0;
            frame.buttons = gait | (d < 1.0 ? Button.Walk : 0); // walk near the waypoint, so it does not overshoot
            frame.seq++;
            sanitizeInputFields(frame);
            stepPlayer(sim, duck, frame);
          }
          if (ticks >= limit) {
            failures.push(`${where}: stuck before waypoint ${i} at (${duck.x.toFixed(2)}, ${duck.y.toFixed(2)}, ${duck.z.toFixed(2)})`);
            return;
          }
          if (Math.abs(duck.y - ty) > 0.45) {
            failures.push(`${where}: waypoint ${i} reached at height ${duck.y.toFixed(2)}, expected ${ty.toFixed(2)}`);
            return;
          }
        }
        walked++;
      });
    }
    sim.dispose();
    expect(failures).toEqual([]);
    expect(walked).toBeGreaterThanOrEqual(20);
  }, 120_000);
});
