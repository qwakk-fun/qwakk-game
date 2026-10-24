/**
 * The hub duck in the shared sim: the hub sanitizer keeps only the movement
 * buttons; with them, every field outside HUB_SIM_FIELDS keeps its start
 * value, so a client that reconciles only the hub fields replays exactly what
 * the server stepped. Portal triggers and the hub map parser.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ALL_BUTTONS, Button, createSimWorld, generateMap, initPhysics, MOVE, PLAYER_SIM_FIELDS, stepPlayer, type InputFrame, type PlayerSim } from '../src/index.ts';
import { HUB_BUTTONS, HUB_SIM_FIELDS, applyHubFields, applyHubMovement, createHubSim, sanitizeHubInput } from '../src/hub/hubSim.ts';
import { HUB, parseHubMap, portalAt, PORTAL_TRIGGER, PORTALS } from '../src/hub/index.ts';

beforeAll(async () => {
  await initPhysics();
});

function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('hub sim', () => {
  it('the sanitizer keeps only jump, sprint, crouch and walk', () => {
    const f = { mx: 3, mz: Number.NaN, buttons: ALL_BUTTONS, yaw: 10, pitch: 9 };
    sanitizeHubInput(f);
    expect(f.buttons).toBe(HUB_BUTTONS);
    expect(f.buttons & (Button.Fire | Button.Aim | Button.Reload | Button.Use | Button.Grenade)).toBe(0);
    expect(f.mz).toBe(0);
    expect(Math.abs(f.mx)).toBeLessThanOrEqual(1);
  });

  it('only the hub fields change, and replaying from them gives the server state bit for bit', () => {
    const map = generateMap(1337);
    const sim = applyHubMovement(createSimWorld(map));
    const [x, y, z] = map.spawns[0]!;
    const server = createHubSim(x, y, z);
    const start = { ...server };
    const client = createHubSim(x, y, z);
    const r = rand(9);
    const others = PLAYER_SIM_FIELDS.filter((f) => !(HUB_SIM_FIELDS as readonly string[]).includes(f));
    for (let t = 0; t < 600; t++) {
      const f: InputFrame = { seq: t, tick: t, mx: r() * 2 - 1, mz: r() * 2 - 1, buttons: Math.floor(r() * ALL_BUTTONS), yaw: r() * 6, pitch: r() - 0.5 };
      sanitizeHubInput(f);
      stepPlayer(sim, server, f, 1 / 30);
      // The client only knows the reconciled fields; everything else is its own fresh hub duck.
      const fresh = applyHubFields(client as unknown as Record<(typeof HUB_SIM_FIELDS)[number], number>, createHubSim(x, y, z));
      stepPlayer(sim, fresh, f, 1 / 30);
      for (const k of HUB_SIM_FIELDS) client[k] = fresh[k];
      for (const k of HUB_SIM_FIELDS) expect(client[k], `${k} at ${t}`).toBe(server[k]);
    }
    for (const k of others) expect((server as PlayerSim)[k], k).toBe(start[k]);
    sim.dispose();
  });

  it('the plaza moves faster on the ground (HUB.moveScale) and leaves match worlds alone', () => {
    const map = generateMap(1337);
    const [x, y, z] = map.spawns[0]!;
    // Top ground speed held for two seconds of input on flat open ground at the spawn.
    const top = (sim: ReturnType<typeof createSimWorld>, buttons: number): number => {
      const s = createHubSim(x, y, z);
      let best = 0;
      for (let t = 0; t < 60; t++) {
        const f: InputFrame = { seq: t, tick: t, mx: 0, mz: 1, buttons, yaw: 0, pitch: 0 };
        sanitizeHubInput(f);
        stepPlayer(sim, s, f, 1 / 30);
        best = Math.max(best, Math.hypot(s.vx, s.vz));
      }
      return best;
    };
    const match = createSimWorld(map);
    const hub = applyHubMovement(createSimWorld(map));
    expect(match.moveScale).toBe(1);
    expect(HUB.moveScale).toBeGreaterThanOrEqual(1.3);
    expect(HUB.moveScale).toBeLessThanOrEqual(1.4);
    for (const [buttons, speed] of [[Button.Walk, MOVE.walkSpeed], [0, MOVE.runSpeed], [Button.Sprint, MOVE.sprintSpeed]] as const) {
      expect(top(match, buttons)).toBeCloseTo(speed, 1);
      expect(top(hub, buttons)).toBeCloseTo(speed * HUB.moveScale, 1);
    }
    match.dispose();
    hub.dispose();
  });
});

describe('hub map data', () => {
  const doc = {
    hub: {
      portals: [
        { id: 'raid', x: 30, y: 3, z: 0, rotY: -Math.PI / 2 },
        { id: 'dm', x: 0, y: 3, z: -30, rotY: 0 },
        { id: 'nope', x: 1, y: 1, z: 1 },
        { id: 'br', x: -30, y: 3, z: 0, rotY: Math.PI / 2 },
      ],
      spawns: [[0, 3, 10, 0], ['x']],
      exits: { dm: [[0, 3, -24, Math.PI]] },
      board: { x: 5, y: 3, z: 5, rotY: 1 },
    },
  };

  it('portals in wire order, junk dropped, missing exits empty', () => {
    const h = parseHubMap(doc);
    expect(h.portals.map((p) => p.id)).toEqual([...PORTALS]);
    expect(h.spawns).toEqual([[0, 3, 10, 0]]);
    expect(h.exits.br).toEqual([]);
    expect(h.board).toEqual({ x: 5, y: 3, z: 5, rotY: 1 });
    expect(() => parseHubMap({})).toThrow();
  });

  it('the trigger is the opening only: through the arch yes, beside it or above it no', () => {
    const h = parseHubMap(doc);
    expect(portalAt(h.portals, 0, 3, -30)?.id).toBe('dm');
    expect(portalAt(h.portals, PORTAL_TRIGGER.halfWidth - 0.1, 3, -30 + PORTAL_TRIGGER.halfDepth - 0.1)?.id).toBe('dm');
    expect(portalAt(h.portals, 3, 3, -30)).toBeNull();
    expect(portalAt(h.portals, 0, 3, -28)).toBeNull();
    expect(portalAt(h.portals, 0, 9, -30)).toBeNull();
    // Rotated gates: the opening runs along z for the east and west ones.
    expect(portalAt(h.portals, 30, 3, 1.5)?.id).toBe('raid');
    expect(portalAt(h.portals, 31.5, 3, 0)).toBeNull();
    expect(portalAt(h.portals, -30, 3, -1.5)?.id).toBe('br');
  });
});
