/**
 * Battle royale rules in the shared sim: loot rolls, pickups and inventory,
 * armor math, heals (time, slow-down, interruption), the drop (freefall,
 * glider, landing), the zone plan and timeline.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  absorbDamage,
  applyPickup,
  ARMOR,
  Button,
  choosePickup,
  circleAt,
  Container,
  createPlayerSim,
  createSimWorld,
  DROP,
  dropsOf,
  HEAL,
  initPhysics,
  Item,
  LOOT,
  Mode,
  MOVE,
  ejectForCircle,
  landShare,
  lootInside,
  planCircles,
  planeAt,
  planePathIndex,
  planeRoute,
  rollLoot,
  stepPlayer,
  ZONE,
  zoneAt,
  zoneDuration,
  type Armor,
  type BrMapData,
  type InputFrame,
  type LootPoint,
  type MapDef,
  type PlayerSim,
} from '../src/index.ts';

beforeAll(async () => {
  await initPhysics();
});

const noArmor = (): Armor => ({ vest: 0, vestDur: 0, helmet: 0, helmetDur: 0 });

function unarmed(): PlayerSim {
  const s = createPlayerSim(0, 0.02, 0);
  Object.assign(s, { arms: 0, mag0: 0, mag1: 0, res0: 0, res1: 0, grounded: 1 });
  return s;
}

/** A flat 400 m world with BR data (no colliders besides the ground). */
function flatMap(height = 0, br: Partial<BrMapData> = {}): MapDef {
  const cells = 40;
  return {
    id: 'flat',
    seed: 0,
    size: 400,
    seaLevel: -10,
    terrain: { cells, cellSize: 10, heights: new Float32Array((cells + 1) * (cells + 1)).fill(height) },
    boxes: [],
    rocks: [],
    spawns: [[0, height + 0.5, 0]],
    arena: { x: 0, z: 0, radius: 50 },
    arenaSpawns: [],
    shapes: [],
    water: null,
    br: { name: 'flat', phases: [], groundSpawns: [], flight: { altitude: 180, speed: 55, paths: [] }, finalCandidates: [], zones: [], loot: [], ...br },
  };
}

function input(buttons = 0, mz = 0, mx = 0, yaw = 0): InputFrame {
  return { seq: 0, tick: 0, mx, mz, buttons, yaw, pitch: 0 };
}

describe('loot rolls', () => {
  const points: LootPoint[] = Array.from({ length: 400 }, (_, i) => ({ id: i, kind: 'ground', x: i, y: 1, z: 0, tier: 1 + (i % 4), zone: 0, container: i % 10 === 0 ? Container.Small : Container.None }));

  it('is deterministic per seed and differs between seeds', () => {
    expect(rollLoot(points, 42)).toEqual(rollLoot(points, 42));
    expect(rollLoot(points, 42)).not.toEqual(rollLoot(points, 43));
  });

  it('fills about the spawn chance of floor points, every container, and puts ammo next to weapons', () => {
    const items = rollLoot(points, 7);
    const containerPts = points.filter((p) => p.container !== Container.None).length;
    // Points that got an item (an item exactly on its point).
    const filled = new Set(items.filter((it) => points.some((p) => p.x === it.x && p.z === it.z)).map((it) => it.x)).size;
    const floor = points.length - containerPts;
    expect(filled - containerPts).toBeGreaterThan(floor * (LOOT.spawnChance - 0.1));
    expect(filled - containerPts).toBeLessThan(floor * (LOOT.spawnChance + 0.1));
    const guns = items.filter((i) => i.kind === Item.Rifle || i.kind === Item.Pistol).length;
    const ammo = items.filter((i) => i.kind === Item.RifleAmmo || i.kind === Item.PistolAmmo).length;
    expect(guns).toBeGreaterThan(20);
    expect(ammo).toBeGreaterThanOrEqual(guns * 0.8);
  });

  it('better tiers give better loot', () => {
    const t1 = rollLoot(points.filter((p) => p.tier === 1), 3);
    const t4 = rollLoot(points.filter((p) => p.tier === 4), 3);
    const good = (l: typeof t1) => l.filter((i) => i.kind === Item.Vest2 || i.kind === Item.Helmet2 || i.kind === Item.Medkit).length / Math.max(1, l.length);
    expect(good(t4)).toBeGreaterThan(good(t1) * 2);
  });
});

describe('pickups and inventory', () => {
  it('a first gun equips with a full magazine; a second gun of a kind you have becomes ammo', () => {
    const s = unarmed();
    const a = noArmor();
    expect(applyPickup(s, a, Item.Pistol, 1)).toBe(1);
    expect(s.arms).toBe(2);
    expect(s.weapon).toBe(1);
    expect(s.mag1).toBe(12);
    expect(s.equip).toBeGreaterThan(0);
    // A rifle while holding the pistol: owned, but the pistol stays in hand.
    applyPickup(s, a, Item.Rifle, 1);
    expect(s.arms).toBe(3);
    expect(s.weapon).toBe(1);
    expect(s.mag0).toBe(30);
    applyPickup(s, a, Item.Rifle, 1);
    expect(s.res0).toBe(30);
  });

  it('ammo and heals stop at their caps and leave the rest', () => {
    const s = unarmed();
    const a = { ...noArmor(), pack: 3 };
    s.res0 = LOOT.maxRifleAmmo - 10;
    expect(applyPickup(s, a, Item.RifleAmmo, 30)).toBe(10);
    expect(s.res0).toBe(LOOT.maxRifleAmmo);
    expect(applyPickup(s, a, Item.RifleAmmo, 30)).toBe(0);
    s.medkits = LOOT.maxMedkits;
    expect(applyPickup(s, a, Item.Medkit, 1)).toBe(0);
    expect(applyPickup(s, a, Item.Bandage, 2)).toBe(2);
  });

  it('armor is taken only as an upgrade', () => {
    const s = unarmed();
    const a = noArmor();
    expect(applyPickup(s, a, Item.Vest2, 1)).toBe(1);
    expect(a.vest).toBe(2);
    expect(applyPickup(s, a, Item.Vest1, 1)).toBe(0);
    a.vestDur = 10;
    // Same level with more durability is an upgrade.
    expect(applyPickup(s, a, Item.Vest2, 1)).toBe(1);
    expect(a.vestDur).toBe(ARMOR.vestDurability[2]);
  });

  it('chooses the item near the crosshair within reach', () => {
    const items = [
      { id: 'behind', x: 0, y: 0, z: 1 },
      { id: 'ahead', x: 0, y: 0, z: -1.5 },
      { id: 'far', x: 0, y: 0, z: -9 },
    ];
    expect(choosePickup(items, 0, 0, 0, 0, 0, -1)?.id).toBe('ahead');
    expect(choosePickup(items, 0, 0, 0, 0, 0, 1)?.id).toBe('behind');
    expect(choosePickup([items[2]!], 0, 0, 0, 0, 0, -1)).toBeNull();
  });

  it('a dead duck drops its guns with their magazines, its reserve, armor as worn and heals; nothing is minted', () => {
    const s = unarmed();
    const a = { vest: 1, vestDur: 50, helmet: 0, helmetDur: 0 };
    Object.assign(s, { arms: 1, mag0: 12, res0: 40, bandages: 3 });
    const d = dropsOf(s, a);
    expect(d).toContainEqual({ kind: Item.Rifle, amount: 1, mag: 12 });
    expect(d).toContainEqual({ kind: Item.RifleAmmo, amount: 40 });
    expect(d).toContainEqual({ kind: Item.Vest1, amount: 1, dur: 50 });
    // Picking it all up gives exactly what was dropped.
    const t = unarmed();
    const ta = noArmor();
    for (const it of d) applyPickup(t, ta, it.kind, it.amount, it);
    expect(t.mag0 + t.res0).toBe(52);
    expect(ta.vestDur).toBe(50);
    expect(d).toContainEqual({ kind: Item.Bandage, amount: 3 });
    expect(d.some((x) => x.kind === Item.Pistol)).toBe(false);
  });
});

describe('armor math', () => {
  it('a vest cuts body damage, a helmet head damage, and both wear out', () => {
    const a = { vest: 2, vestDur: ARMOR.vestDurability[2]!, helmet: 1, helmetDur: ARMOR.helmetDurability[1]! };
    expect(absorbDamage(a, 24, false)).toBe(Math.round(24 * (1 - ARMOR.vestReduce[2]!)));
    expect(absorbDamage(a, 86, true)).toBe(Math.round(86 * (1 - ARMOR.helmetReduce[1]!)));
    expect(a.vestDur).toBeLessThan(ARMOR.vestDurability[2]!);
    // Enough hits break the helmet: then head damage is full again.
    for (let i = 0; i < 5; i++) absorbDamage(a, 86, true);
    expect(a.helmet).toBe(0);
    expect(absorbDamage(a, 86, true)).toBe(86);
  });

  it('no armor: damage unchanged', () => {
    expect(absorbDamage(noArmor(), 37, false)).toBe(37);
  });
});

describe('heals', () => {
  it('a bandage takes its time, slows you and heals up to its cap', () => {
    const sim = createSimWorld(flatMap());
    const s = createPlayerSim(0, 0.02, 0);
    Object.assign(s, { hp: 40, bandages: 2 });
    for (let i = 0; i < 20; i++) stepPlayer(sim, s, input());
    stepPlayer(sim, s, input(Button.Heal1));
    expect(s.heal).toBeGreaterThan(0);
    let maxSpeed = 0;
    for (let i = 0; i < HEAL.bandageTicks + 2; i++) {
      stepPlayer(sim, s, input(0, 1));
      if (s.heal > 0) maxSpeed = Math.max(maxSpeed, Math.hypot(s.vx, s.vz));
    }
    expect(maxSpeed).toBeLessThanOrEqual(HEAL.moveSpeed + 1e-3);
    expect(s.hp).toBe(40 + HEAL.bandageAmount);
    expect(s.bandages).toBe(1);
    s.hp = HEAL.bandageCap;
    stepPlayer(sim, s, input(Button.Heal1));
    expect(s.heal).toBe(0); // nothing to heal: does not start
  });

  it('firing or jumping interrupts a heal and keeps the item', () => {
    const sim = createSimWorld(flatMap());
    const s = createPlayerSim(0, 0.02, 0);
    Object.assign(s, { hp: 30, medkits: 1 });
    for (let i = 0; i < 10; i++) stepPlayer(sim, s, input());
    stepPlayer(sim, s, input(Button.Heal2));
    expect(s.healKind).toBe(2);
    for (let i = 0; i < 30; i++) stepPlayer(sim, s, input());
    stepPlayer(sim, s, input(Button.Fire));
    expect(s.heal).toBe(0);
    expect(s.medkits).toBe(1);
    expect(s.hp).toBe(30);
    stepPlayer(sim, s, input());
    stepPlayer(sim, s, input(Button.Heal2));
    for (let i = 0; i < HEAL.medkitTicks + 1; i++) stepPlayer(sim, s, input());
    expect(s.hp).toBe(100);
    expect(s.medkits).toBe(0);
  });
});

describe('the drop', () => {
  it('freefall, then the glider (by itself near the ground), then landing back on foot', () => {
    const sim = createSimWorld(flatMap(5));
    const s = createPlayerSim(0, 180, 0);
    Object.assign(s, { mode: Mode.Freefall, air: 0, grounded: 0 });
    let opened = -1;
    let landed = -1;
    let maxFall = 0;
    for (let t = 0; t < 30 * 90 && landed < 0; t++) {
      stepPlayer(sim, s, input(0, 0));
      maxFall = Math.max(maxFall, -s.vy);
      if (opened < 0 && s.mode === Mode.Glide) opened = t;
      if (s.mode === Mode.Ground) landed = t;
    }
    expect(maxFall).toBeLessThanOrEqual(DROP.freefallSpeed + 1e-3);
    expect(opened).toBeGreaterThan(0);
    expect(landed).toBeGreaterThan(opened);
    expect(s.grounded).toBe(1);
    expect(Math.hypot(s.vx, s.vz)).toBeLessThanOrEqual(MOVE.runSpeed + 1e-3);
  });

  it('gliding covers about 3 m forward per meter down', () => {
    const sim = createSimWorld(flatMap(0));
    const s = createPlayerSim(0, 150, 0);
    Object.assign(s, { mode: Mode.Glide, grounded: 0 });
    for (let t = 0; t < 60; t++) stepPlayer(sim, s, input(0, 0)); // settle on cruise speed
    const y0 = s.y;
    const z0 = s.z;
    for (let t = 0; t < 150; t++) stepPlayer(sim, s, input(0, 0));
    const ratio = (z0 - s.z) / (y0 - s.y);
    expect(ratio).toBeGreaterThan(2.6);
    expect(ratio).toBeLessThan(3.4);
  });

  it('Space opens the glider early, but not right at the jump', () => {
    const sim = createSimWorld(flatMap(0));
    const s = createPlayerSim(0, 180, 0);
    Object.assign(s, { mode: Mode.Freefall, air: 0, grounded: 0 });
    stepPlayer(sim, s, input(Button.Jump));
    expect(s.mode).toBe(Mode.Freefall);
    for (let t = 0; t < 30; t++) stepPlayer(sim, s, input());
    stepPlayer(sim, s, input(Button.Jump));
    expect(s.mode).toBe(Mode.Glide);
  });

  it('in the plane nothing moves', () => {
    const sim = createSimWorld(flatMap(0));
    const s = createPlayerSim(10, 50, 10);
    s.mode = Mode.Plane;
    stepPlayer(sim, s, input(Button.Jump | Button.Fire, 1, 1, 1));
    expect([s.x, s.y, s.z]).toEqual([10, 50, 10]);
    expect(s.yaw).toBeCloseTo(1, 6);
  });
});

describe('zone', () => {
  const map = flatMap(5, { finalCandidates: [{ name: 'A', x: 60, z: -40, r: 50, weight: 3 }, { name: 'B', x: -80, z: 90, r: 50, weight: 1 }] });

  it('the plan is seeded, every circle contains the next, radii follow the table', () => {
    const a = planCircles(map, 99);
    expect(planCircles(map, 99)).toEqual(a);
    expect(planCircles(map, 100)).not.toEqual(a);
    ZONE.phases.forEach((p, i) => expect(a[i]?.r).toBe(p.radius));
    for (let i = 0; i + 1 < a.length; i++) {
      const c = a[i]!;
      const n = a[i + 1]!;
      expect(Math.hypot(c.x - n.x, c.z - n.z) + n.r).toBeLessThanOrEqual(c.r + 1e-6);
    }
    // The final point lies in one of the candidate circles.
    const f = a[a.length - 1]!;
    expect(Math.min(Math.hypot(f.x - 60, f.z + 40), Math.hypot(f.x + 80, f.z - 90))).toBeLessThanOrEqual(25 + 1e-6);
  });

  it('the timeline: drop phase without damage, then wait, shrink and growing damage', () => {
    const plan = planCircles(map, 5);
    const z0 = zoneAt(plan, 10_000);
    expect(z0.phase).toBe(0);
    expect(z0.dps).toBe(0);
    // The first circle is up from the start (the plane), so players can aim their drop at it.
    expect(ZONE.firstShownS).toBeLessThan(ZONE.phases[0]!.waitS);
    expect(zoneAt(plan, 0).shown).toBe(ZONE.firstShownS === 0);
    expect(zoneAt(plan, ZONE.firstShownS * 1000 + 1).shown).toBe(true);
    const p1 = ZONE.phases[0]!.waitS * 1000;
    const z1 = zoneAt(plan, p1 + 1000);
    expect(z1.phase).toBe(1);
    expect(z1.dps).toBe(ZONE.phases[1]!.dps);
    // Mid-shrink the circle is between its ends.
    const mid = (z1.t0 + z1.t1) / 2;
    const c = circleAt(z1, mid);
    expect(c.r).toBeLessThan(z1.from.r);
    expect(c.r).toBeGreaterThan(z1.to.r);
    let lastDps = 0;
    for (let t = 0; t <= zoneDuration() * 1000 + 5000; t += 5000) {
      const z = zoneAt(plan, t);
      expect(z.dps).toBeGreaterThanOrEqual(lastDps);
      lastDps = z.dps;
    }
    const end = zoneAt(plan, zoneDuration() * 1000 + 10_000);
    expect(circleAt(end, zoneDuration() * 1000 + 10_000).r).toBe(0);
    expect(end.dps).toBe(ZONE.phases[ZONE.phases.length - 1]!.dps);
  });

  it('the whole timeline is about 5.5 minutes, from a first circle of about 220 m', () => {
    expect(zoneDuration()).toBeGreaterThanOrEqual(5 * 60);
    expect(zoneDuration()).toBeLessThanOrEqual(6 * 60);
    expect(ZONE.phases[0]!.radius).toBe(220);
    for (const p of ZONE.phases) expect(Number.isInteger(p.dps)).toBe(true);
  });

  it('circles lean toward the loot (the populated part) and keep enough land', () => {
    // Land only in the east half; loot spots only in the north-east corner.
    const half = flatMap(5, { finalCandidates: [{ name: 'C', x: 40, z: 0, r: 20, weight: 1 }] });
    const h = half.terrain.heights;
    const n = half.terrain.cells + 1;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = i * half.terrain.cellSize - 200 < -60 ? -5 : 5;
    half.br!.loot = Array.from({ length: 60 }, (_, i) => ({ id: i, kind: 'ground', x: 60 + (i % 10) * 6, y: 5, z: -80 - Math.floor(i / 10) * 6, tier: 1, zone: 0, container: Container.None }));
    const phases = [
      { waitS: 1, shrinkS: 0, radius: 120, dps: 0 },
      { waitS: 1, shrinkS: 1, radius: 20, dps: 1 },
    ];
    let toward = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const [c0, c1] = planCircles(half, seed, phases);
      expect(Math.hypot(c0!.x - c1!.x, c0!.z - c1!.z) + c1!.r).toBeLessThanOrEqual(c0!.r + 1e-6);
      expect(landShare(half, c0!)).toBeGreaterThanOrEqual(ZONE.minLandShare);
      // The first circle sits north-east of the final one (toward the loot) far more often than not.
      if (c0!.z < c1!.z && c0!.x > c1!.x - 5) toward++;
      expect(lootInside(half, c0!)).toBeGreaterThan(0);
    }
    expect(toward).toBeGreaterThanOrEqual(15);
  });
});

describe('the plane', () => {
  // A 300 m square island in a 400 m world (sea around it), crossed by two paths: west to east through
  // the middle, and north to south along x = 150 (terrain lookups past the world's edge clamp to the sea).
  const sea = flatMap(5, { flight: { altitude: 180, speed: 50, paths: [{ from: [-400, 0], to: [400, 0] }, { from: [150, 400], to: [150, -400] }] } });
  const ts = sea.terrain;
  const n = ts.cells + 1;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) ts.heights[j * n + i] = Math.abs(i * ts.cellSize - 200) > 150 || Math.abs(j * ts.cellSize - 200) > 150 ? -5 : 5;

  it('cuts the sea before the island and flies faster than the map says', () => {
    const r = planeRoute(sea, 0)!;
    expect(r.speed).toBeCloseTo(50 * DROP.planeSpeedScale, 6);
    // The path starts planeLeadIn before the first land point (x = -150), not at -400.
    expect(r.fromX).toBeGreaterThan(-150 - DROP.planeLeadIn - 6);
    expect(r.fromX).toBeLessThan(-150 - DROP.planeLeadIn + 6);
    expect(r.fromX + r.dirX * r.length).toBeCloseTo(400, 3);
    // Auto-eject before the coast.
    expect(planeAt(r, r.ejectS).x).toBeLessThanOrEqual(150 - DROP.autoEjectBeforeCoast + 6);
  });

  it('takes the path over the first circle and ejects at its far edge', () => {
    const near1 = { x: 150, z: -60, r: 60 };
    expect(planePathIndex(sea, 0, near1)).toBe(1);
    expect(planePathIndex(sea, 0, { x: 10, z: 5, r: 60 })).toBe(0);
    // Two choices: the seed picks between the two best paths.
    const picks = new Set([0, 1, 2, 3].map((seed) => planePathIndex(sea, seed, near1)));
    expect(picks).toEqual(new Set([0, 1]));
    // Without a circle: seed mod path count (the map's rule).
    expect(planePathIndex(sea, 3)).toBe(1);
    const r = planeRoute(sea, 0)!;
    const c = { x: 0, z: 10, r: 60 };
    const eject = ejectForCircle(sea, r, c);
    const farEdge = (c.x + c.r * DROP.autoEjectPastCircle - r.fromX) / r.speed;
    expect(eject).toBeCloseTo(Math.min(r.ejectS, Math.max(DROP.minEjectS, farEdge)), 6);
    // A slow plane reaches the far edge before the coast: it ejects there.
    const slow = { ...r, speed: 20, ejectS: (r.ejectS * r.speed) / 20 };
    expect(planeAt(slow, ejectForCircle(sea, slow, c)).x).toBeCloseTo(c.x + c.r * DROP.autoEjectPastCircle, 3);
  });
});
