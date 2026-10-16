/**
 * Team play in the shared code: the knocked crawl in the sim (predicted like
 * any movement, so it must be deterministic), and the menu's party and team
 * helpers (codes, team sizes, Quick Play's pick).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Act, actionOf, Button, createPlayerSim, createSimWorld, generateMap, initPhysics, KNOCK, stepPlayer, terrainHeightAt, type InputFrame, type SimWorld } from '../src/index.ts';
import { partyCodeOf, pickQuickRoom, teamSizeFor, teamSizeOf, type RoomListing } from '../src/lobby.ts';

let world: SimWorld;
beforeAll(async () => {
  await initPhysics();
  world = createSimWorld(generateMap(1337));
});

function onGround(): ReturnType<typeof createPlayerSim> {
  const [x, , z] = world.map.spawns[0] ?? [0, 0, 0];
  const s = createPlayerSim(x, terrainHeightAt(world.map.terrain, x, z) + 0.05, z);
  const f: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0, yaw: 0, pitch: 0 };
  for (let i = 0; i < 20; i++) stepPlayer(world, s, f);
  return s;
}

describe('knocked crawl (sim)', () => {
  it('crawls at KNOCK.crawlSpeed at most, low, and never fires, jumps, aims or heals', () => {
    const s = onGround();
    s.down = 1;
    s.bandages = 3;
    s.hp = 50;
    const f: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 1, buttons: Button.Sprint | Button.Fire | Button.Jump | Button.Aim | Button.Heal1, yaw: 0, pitch: 0 };
    let shots = 0;
    let maxSpeed = 0;
    for (let i = 0; i < 60; i++) {
      // Fire and jump as press edges every other tick.
      f.buttons = i % 2 === 0 ? Button.Sprint | Button.Fire | Button.Jump | Button.Aim | Button.Heal1 : Button.Sprint;
      if (stepPlayer(world, s, f)) shots++;
      maxSpeed = Math.max(maxSpeed, Math.hypot(s.vx, s.vz));
      expect(s.vy).toBeLessThanOrEqual(0.01);
    }
    expect(shots).toBe(0);
    expect(maxSpeed).toBeLessThanOrEqual(KNOCK.crawlSpeed + 1e-6);
    expect(maxSpeed).toBeGreaterThan(KNOCK.crawlSpeed * 0.9);
    expect(s.crouch).toBe(1);
    expect(s.aim).toBe(0);
    expect(s.heal).toBe(0);
    expect(actionOf(s)).toBe(Act.Down);
  });

  it('is deterministic: the same inputs from the same state give the same state', () => {
    const run = () => {
      const s = onGround();
      s.down = 1;
      for (let i = 0; i < 90; i++) stepPlayer(world, s, { seq: 0, tick: i, mx: Math.sin(i / 9), mz: 1, buttons: i % 7 === 0 ? Button.Jump : 0, yaw: i * 0.02, pitch: 0 });
      return [s.x, s.y, s.z, s.vx, s.vz];
    };
    expect(run()).toEqual(run());
  });

  it('back up (revived): runs and fires again', () => {
    const s = onGround();
    s.down = 1;
    stepPlayer(world, s, { seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0, yaw: 0, pitch: 0 });
    s.down = 0;
    let fired = false;
    let top = 0;
    for (let i = 0; i < 40; i++) {
      fired = !!stepPlayer(world, s, { seq: 0, tick: 0, mx: 0, mz: 1, buttons: i === 30 ? Button.Fire : 0, yaw: 0, pitch: 0 }) || fired;
      top = Math.max(top, Math.hypot(s.vx, s.vz));
    }
    expect(fired).toBe(true);
    expect(top).toBeGreaterThan(KNOCK.crawlSpeed * 2);
  });
});

describe('party and team helpers (menu)', () => {
  it('reads a party code from a code or a share link', () => {
    expect(partyCodeOf('abc234')).toBe('ABC234');
    expect(partyCodeOf(' ab-c2 34 ')).toBe('ABC234');
    expect(partyCodeOf('https://play.qwakk.fun/?party=QWK234')).toBe('QWK234');
    expect(partyCodeOf('https://play.qwakk.fun/?x=1&party=qwk234#top')).toBe('QWK234');
    expect(partyCodeOf('ABC1O0')).toBe(null); // 1, O, 0 are not in the alphabet
    expect(partyCodeOf('ABC23')).toBe(null);
    expect(partyCodeOf(42)).toBe(null);
  });

  it('team sizes: a party needs a mode at least its size', () => {
    expect([1, 2, 3, 4, 5].map(teamSizeFor)).toEqual([1, 2, 4, 4, 4]);
    expect(teamSizeOf(2)).toBe(2);
    expect(teamSizeOf(3)).toBe(1);
    expect(teamSizeOf('4')).toBe(1);
  });

  it('Quick Play picks an open room whose teams fit the party, most humans first', () => {
    const room = (roomId: string, l: Partial<RoomListing>, locked = false) => ({ roomId, locked, listing: { label: roomId, stage: 'waiting' as const, humans: 1, cap: 16, need: 1, left: 0, ...l } });
    const rooms = [room('solo', { team: 1, humans: 5 }), room('duo', { team: 2, fit: 2, humans: 3 }), room('duoFull', { team: 2, fit: 1, humans: 9 }), room('squad', { team: 4, fit: 4, humans: 1 }), room('live', { team: 4, fit: 4, stage: 'playing' }, true)];
    expect(pickQuickRoom(rooms, 1)?.roomId).toBe('duoFull');
    expect(pickQuickRoom(rooms, 2)?.roomId).toBe('duo');
    expect(pickQuickRoom(rooms, 3)?.roomId).toBe('squad');
    expect(pickQuickRoom(rooms, 2, 4)?.roomId).toBe('squad');
    expect(pickQuickRoom(rooms, 1, 1)?.roomId).toBe('solo');
    expect(pickQuickRoom([], 2)).toBe(null);
  });
});
