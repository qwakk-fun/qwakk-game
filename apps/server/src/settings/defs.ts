/**
 * Every setting the admin panel can change at runtime, with its type, range,
 * default and when it takes effect. The defaults are the constants
 * (`MATCH`, `BR`, `ZONE`, `DM_BOT`, `SPAWN_PROTECTION`, `WEAPONS`, `BR_SKILL`,
 * `DM_ROOM_CATALOG`): with nothing stored, the server runs exactly as the
 * constants say. Only numbers the server alone decides are here; anything the
 * client also simulates for prediction (movement, fire rate, spread, recoil,
 * aim down sights) stays a constant (it needs a client deploy).
 */
import { BR, DM_BOT, DM_HERO, EXPLOSIVE, KILL_STACKS, MATCH, PUSH, RAID, ROOM, SPAWN_PROTECTION, TICK_RATE, WEAPONS, ZONE } from '@qwakk/shared';
import { DM_OPEN_ROOMS, DM_ROOM_CATALOG } from '@qwakk/shared/lobby';
import { BR_SKILL } from '../br/brBot.ts';

/** When a change takes effect. */
export type Applies = 'now' | 'next-round' | 'new-rooms';
export type SettingKind = 'int' | 'number' | 'bool' | 'text';
export type SettingValue = number | boolean | string;
export type SettingGroup = 'dm' | 'dmBot' | 'br' | 'brBot' | 'raid' | 'weapons' | 'ops';

export interface SettingDef {
  key: string;
  group: SettingGroup;
  label: string;
  help: string;
  kind: SettingKind;
  default: SettingValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Text settings: most characters. */
  maxLength?: number;
  applies: Applies;
  /** An environment variable that, when set, decides the value instead (test and benchmark switches). */
  env?: string;
}

/** A bot skill knob: suffix, label, unit, range, and how it reads from a skill object. */
interface SkillField {
  id: string;
  label: string;
  help: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  int: boolean;
}

const SKILL_FIELDS: readonly SkillField[] = [
  { id: 'reactionMin', label: 'Reaction, fastest', help: 'Ticks from first sight of a new target to the first shot (30 ticks = 1 s).', unit: 'ticks', min: 1, max: 90, step: 1, int: true },
  { id: 'reactionMax', label: 'Reaction, slowest', help: 'Upper end of the reaction range (raised to the fastest when lower).', unit: 'ticks', min: 1, max: 90, step: 1, int: true },
  { id: 'yawError', label: 'First aim error, sideways', help: 'Aim error on a new target, up to this either way.', unit: 'rad', min: 0, max: 0.6, step: 0.005, int: false },
  { id: 'pitchError', label: 'First aim error, up and down', help: 'Vertical aim error on a new target.', unit: 'rad', min: 0, max: 0.3, step: 0.005, int: false },
  { id: 'errorSettle', label: 'Aim error kept per tick', help: 'Share of the aim error left after each tick (lower settles faster).', unit: '', min: 0.8, max: 0.999, step: 0.001, int: false },
  { id: 'burstYawError', label: 'Burst error, sideways', help: 'Fresh aim error rolled at the start of every burst.', unit: 'rad', min: 0, max: 0.1, step: 0.001, int: false },
  { id: 'burstPitchError', label: 'Burst error, up and down', help: 'Fresh vertical error rolled at every burst.', unit: 'rad', min: 0, max: 0.06, step: 0.001, int: false },
  { id: 'trackRate', label: 'Tracking', help: 'Share of the gap to a moving target closed per tick (1 aims where it is now).', unit: '', min: 0.05, max: 1, step: 0.01, int: false },
  { id: 'turnRate', label: 'Turn speed', help: 'How fast it turns.', unit: 'rad/tick', min: 0.03, max: 0.5, step: 0.01, int: false },
  { id: 'recoilControl', label: 'Recoil control', help: 'Share of the spray pattern it pulls against.', unit: '', min: 0, max: 1, step: 0.05, int: false },
  { id: 'headChance', label: 'Headshot aim chance', help: 'Chance to aim at the head instead of the belly, per target.', unit: '', min: 0, max: 1, step: 0.01, int: false },
  { id: 'viewRange', label: 'View range', help: 'How far it sees (line of sight still applies).', unit: 'm', min: 10, max: 200, step: 1, int: true },
  { id: 'fovDeg', label: 'Field of view, half angle', help: 'How wide it looks.', unit: 'deg', min: 20, max: 90, step: 1, int: true },
  { id: 'hearRange', label: 'Notice range', help: 'Notices anyone this close, whichever way it faces.', unit: 'm', min: 0, max: 30, step: 0.5, int: false },
  { id: 'burstMin', label: 'Burst, fewest shots', help: 'Automatic weapons, close range.', unit: 'shots', min: 1, max: 30, step: 1, int: true },
  { id: 'burstMax', label: 'Burst, most shots', help: 'Automatic weapons, close range.', unit: 'shots', min: 1, max: 30, step: 1, int: true },
  { id: 'longBurstMin', label: 'Long range burst, fewest', help: 'Automatic weapons past 28 m.', unit: 'shots', min: 1, max: 30, step: 1, int: true },
  { id: 'longBurstMax', label: 'Long range burst, most', help: 'Automatic weapons past 28 m.', unit: 'shots', min: 1, max: 30, step: 1, int: true },
  { id: 'pauseMin', label: 'Pause between bursts, shortest', help: 'Ticks of pause after a burst.', unit: 'ticks', min: 0, max: 60, step: 1, int: true },
  { id: 'pauseMax', label: 'Pause between bursts, longest', help: 'Ticks of pause after a burst.', unit: 'ticks', min: 0, max: 60, step: 1, int: true },
  { id: 'semiPauseMin', label: 'Pistol pause, shortest', help: 'Ticks between trigger pulls on top of the fire rate.', unit: 'ticks', min: 0, max: 60, step: 1, int: true },
  { id: 'semiPauseMax', label: 'Pistol pause, longest', help: 'Ticks between trigger pulls on top of the fire rate.', unit: 'ticks', min: 0, max: 60, step: 1, int: true },
];

export type SkillValues = Record<string, number>;

/** The skill knobs of a BotSkill-shaped object, by field id (field of view in degrees). */
export function skillValues(s: {
  reactionTicks: readonly [number, number];
  yawError: number;
  pitchError: number;
  errorSettlePerTick: number;
  burstYawError: number;
  burstPitchError: number;
  trackRate: number;
  turnRatePerTick: number;
  recoilControl: number;
  headChance: number;
  viewRange: number;
  hearRange: number;
  burstShots: readonly [number, number];
  longBurstShots: readonly [number, number];
  burstPauseTicks: readonly [number, number];
  semiPauseTicks: readonly [number, number];
}, fovDeg: number): SkillValues {
  return {
    reactionMin: s.reactionTicks[0],
    reactionMax: s.reactionTicks[1],
    yawError: s.yawError,
    pitchError: s.pitchError,
    errorSettle: s.errorSettlePerTick,
    burstYawError: s.burstYawError,
    burstPitchError: s.burstPitchError,
    trackRate: s.trackRate,
    turnRate: s.turnRatePerTick,
    recoilControl: s.recoilControl,
    headChance: s.headChance,
    viewRange: s.viewRange,
    fovDeg: Math.round(fovDeg),
    hearRange: s.hearRange,
    burstMin: s.burstShots[0],
    burstMax: s.burstShots[1],
    longBurstMin: s.longBurstShots[0],
    longBurstMax: s.longBurstShots[1],
    pauseMin: s.burstPauseTicks[0],
    pauseMax: s.burstPauseTicks[1],
    semiPauseMin: s.semiPauseTicks[0],
    semiPauseMax: s.semiPauseTicks[1],
  };
}

/** Deathmatch bot defaults: `DM_BOT` in constants.ts. */
export const DM_BOT_DEFAULTS: SkillValues = skillValues(DM_BOT, DM_BOT.fovHalfAngleDeg);
/** Battle royale bot defaults: `BR_SKILL` in br/brBot.ts, read once at start (before any change). */
export const BR_BOT_DEFAULTS: SkillValues = skillValues(BR_SKILL, (Math.acos(BR_SKILL.fovCos) * 180) / Math.PI);

export const SKILL_FIELD_IDS: readonly string[] = SKILL_FIELDS.map((f) => f.id);

function skillDefs(group: 'dmBot' | 'brBot', defaults: SkillValues): SettingDef[] {
  return SKILL_FIELDS.map((f) => ({
    key: `${group}.${f.id}`,
    group,
    label: f.label,
    help: f.help,
    kind: f.int ? 'int' : 'number',
    default: f.int ? Math.round(defaults[f.id] ?? f.min) : (defaults[f.id] ?? f.min),
    min: f.min,
    max: f.max,
    step: f.step,
    unit: f.unit,
    applies: 'now',
  }));
}

const WEAPON_KEYS = ['rifle', 'pistol'] as const;

function weaponDefs(): SettingDef[] {
  return WEAPONS.flatMap((w, i) => {
    const id = WEAPON_KEYS[i] ?? `w${i}`;
    return [
      { key: `weapons.${id}.damage`, group: 'weapons', label: `${w.name} body damage`, help: 'Damage of a body hit before range falloff and armor. Server only: the client never predicts damage.', kind: 'int', default: w.damage, min: 1, max: 100, step: 1, unit: 'hp', applies: 'now' },
      { key: `weapons.${id}.headMultiplier`, group: 'weapons', label: `${w.name} headshot multiplier`, help: 'A head hit does body damage times this.', kind: 'number', default: w.headMultiplier, min: 1, max: 6, step: 0.1, unit: 'x', applies: 'now' },
    ] satisfies SettingDef[];
  });
}

/**
 * Deathmatch explosives (EXPLOSIVE in constants.ts): everything here is decided by the server alone
 * (the client only predicts the throw, the launch and their gates), read through settings/explosives.ts.
 */
function explosiveDefs(): SettingDef[] {
  const G = EXPLOSIVE.grenade;
  const R = EXPLOSIVE.rocket;
  return [
    { key: 'dm.grenadesPerLife', group: 'dm', label: 'Grenades per life', help: 'Grenades every deathmatch duck spawns with (G throws). 0 turns grenades off. Read at each spawn.', kind: 'int', default: G.perLife, min: 0, max: 5, step: 1, unit: 'grenades', applies: 'now' },
    { key: 'dm.rocketsPerPickup', group: 'dm', label: 'Rockets per launcher pickup', help: 'Rockets the rare launcher pickup gives (slot 3 until they are used up). 0 turns the pickup off.', kind: 'int', default: R.perPickup, min: 0, max: 10, step: 1, unit: 'rockets', applies: 'now' },
    { key: 'dm.rocketPickupMinSeconds', group: 'dm', label: 'Launcher pickup, shortest wait', help: 'Shortest time before the next launcher pickup appears (at most one on the map).', kind: 'int', default: R.pickupMinSeconds, min: 10, max: 600, step: 5, unit: 's', applies: 'now' },
    { key: 'dm.rocketPickupMaxSeconds', group: 'dm', label: 'Launcher pickup, longest wait', help: 'Longest wait (raised to the shortest when lower).', kind: 'int', default: R.pickupMaxSeconds, min: 10, max: 600, step: 5, unit: 's', applies: 'now' },
    { key: 'weapons.grenade.damage', group: 'weapons', label: 'Grenade damage', help: 'Damage at the blast center, falling off to the edge. Walls that stop bullets protect. Never hurts teammates.', kind: 'int', default: G.damage, min: 1, max: 200, step: 1, unit: 'hp', applies: 'now' },
    { key: 'weapons.grenade.radius', group: 'weapons', label: 'Grenade blast radius', help: 'No damage past this distance.', kind: 'number', default: G.blastRadius, min: 2, max: 12, step: 0.5, unit: 'm', applies: 'now' },
    { key: 'weapons.grenade.fuseSeconds', group: 'weapons', label: 'Grenade fuse', help: 'Time from the throw to the blast.', kind: 'number', default: G.fuseTicks / TICK_RATE, min: 1, max: 5, step: 0.1, unit: 's', applies: 'now' },
    { key: 'weapons.rocket.damage', group: 'weapons', label: 'Rocket splash damage', help: 'Damage at the blast center, falling off to the edge.', kind: 'int', default: R.damage, min: 1, max: 200, step: 1, unit: 'hp', applies: 'now' },
    { key: 'weapons.rocket.directDamage', group: 'weapons', label: 'Rocket direct hit bonus', help: 'Extra damage to the duck the rocket hits.', kind: 'int', default: R.directDamage, min: 0, max: 200, step: 1, unit: 'hp', applies: 'now' },
    { key: 'weapons.rocket.radius', group: 'weapons', label: 'Rocket blast radius', help: 'No splash damage past this distance.', kind: 'number', default: R.blastRadius, min: 1, max: 10, step: 0.5, unit: 'm', applies: 'now' },
    { key: 'weapons.explosive.selfDamage', group: 'weapons', label: 'Own explosion damage', help: 'Share of the damage your own grenade or rocket does to you.', kind: 'number', default: EXPLOSIVE.selfDamageScale, min: 0, max: 1, step: 0.05, unit: 'x', applies: 'now' },
    { key: 'weapons.explosive.knockback', group: 'weapons', label: 'Explosion knockback', help: 'Scales the push and the upward pop of every explosion. 0 turns knockback off.', kind: 'number', default: 1, min: 0, max: 3, step: 0.1, unit: 'x', applies: 'now' },
  ];
}

/** Weapon id to its settings key part (rifle, pistol). */
export function weaponKey(id: number): string {
  return WEAPON_KEYS[id] ?? `w${id}`;
}

function dmRoomDefs(): SettingDef[] {
  return DM_ROOM_CATALOG.map((r, i) => ({
    key: `dm.room.${r.id}`,
    group: 'dm',
    label: `${r.label} room open`,
    help: 'Open or close this deathmatch room. Closing it sends everyone in it back to the menu.',
    kind: 'bool',
    default: i < DM_OPEN_ROOMS,
    applies: 'now',
    env: 'QWAKK_DM_ROOMS',
  }));
}

/** Kill stacks and the caped hero (server-only numbers; flight and stack speed are client-simulated constants). */
function dmBuffDefs(): SettingDef[] {
  return [
    { key: 'dm.killStacks', group: 'dm', label: 'Kill stacks', help: 'Each kill since the last death adds a stack (up to 5): more damage, and 4% more move speed per stack. Off: nobody gains stacks.', kind: 'bool', default: true, applies: 'now' },
    { key: 'dm.stackDamagePercent', group: 'dm', label: 'Damage per kill stack', help: 'Extra bullet damage per kill stack. The speed part is fixed (client simulated).', kind: 'number', default: KILL_STACKS.damagePerStack * 100, min: 0, max: 20, step: 0.5, unit: '%', applies: 'now' },
    { key: 'dm.hero', group: 'dm', label: 'Caped hero', help: 'A random duck gets the cape (flight, extra health); whoever takes it down takes the cape. Off: no new heroes.', kind: 'bool', default: true, applies: 'now', env: 'QWAKK_DM_HERO' },
    { key: 'dm.heroEverySeconds', group: 'dm', label: 'Hero pick interval', help: 'When nobody holds the cape, a new hero is picked this often (and 5 s into every round).', kind: 'int', default: DM_HERO.everySeconds, min: 30, max: 900, step: 10, unit: 's', applies: 'now' },
    { key: 'dm.heroHealth', group: 'dm', label: 'Hero health', help: 'Health a duck gets when it becomes the hero (normal ducks have 100).', kind: 'int', default: DM_HERO.health, min: 100, max: 250, step: 5, unit: 'hp', applies: 'now' },
    { key: 'dm.heroKillPoints', group: 'dm', label: 'Hero takedown bonus', help: 'Extra points for taking down the hero.', kind: 'int', default: DM_HERO.killPoints, min: 0, max: 2000, step: 10, unit: 'points', applies: 'now' },
    { key: 'dm.heroHoldPoints', group: 'dm', label: 'Hero points every 5 s', help: 'Points the hero earns every 5 seconds while it keeps the cape.', kind: 'int', default: DM_HERO.holdPoints, min: 0, max: 200, step: 1, unit: 'points', applies: 'now' },
  ];
}

/** Hunt Season (raid/rules.ts): everything the server alone decides about a run. Read when a room opens. */
function raidDefs(): SettingDef[] {
  const n = (key: string, label: string, help: string, def: number, min: number, max: number, step: number, unit: string, kind: 'int' | 'number' = 'number'): SettingDef => ({ key: `raid.${key}`, group: 'raid', label, help, kind, default: def, min, max, step, unit, applies: 'new-rooms' });
  return [
    { key: 'raid.maxRooms', group: 'raid', label: 'Runs at once', help: 'Hunt Season rooms open at the same time (lobby or running). 0 opens none.', kind: 'int', default: 3, min: 0, max: 12, step: 1, unit: 'rooms', applies: 'now', env: 'QWAKK_RAID_MAX_ROOMS' },
    { ...n('lobbySeconds', 'Lobby countdown', 'The first duck starts it; each later duck adds 5 s (up to 30 s); four ducks start in 5 s.', RAID.lobbySeconds, 3, 60, 1, 's', 'int'), env: 'QWAKK_RAID_COUNTDOWN' },
    n('breakSeconds', 'Break between objectives', 'Time to pick an upgrade before the next objective.', RAID.breakSeconds, 4, 60, 1, 's', 'int'),
    n('coreHp', 'Core health', 'The QoreChain core in the courtyard (v3: it no longer ends a run; hunters only hammer the gate when ducks hide in the castle).', RAID.coreHp, 100, 5000, 50, 'hp', 'int'),
    n('maxLive', 'Hunters at once', 'Most hunters, minions and dogs alive at the same time with four ducks (solo about half, 15% more per extra duck); packs wait their turn.', RAID.maxLive, 5, 60, 1, 'hunters', 'int'),
    n('waveScale', 'Pack size', 'Minions and elites every pack brings, times this.', 1, 0.3, 3, 0.05, 'x'),
    n('hunterHpScale', 'Hunter health', 'Every hunter health times this.', 1, 0.3, 3, 0.05, 'x'),
    n('hunterDamageScale', 'Hunter damage', 'Every hunter shot, bite, trap and decoy times this.', 1, 0.2, 3, 0.05, 'x'),
    n('coreDamageScale', 'Core damage', 'How hard hunters at the core hit it, times this.', 1, 0.2, 3, 0.05, 'x'),
    n('gateHp', 'Gate health', 'The main gate breaks at 0 and lets hunters into the courtyard (repaired back past 30% it holds again).', RAID.gateHp, 100, 5000, 50, 'hp', 'int'),
    n('gateDamageScale', 'Gate damage', 'How hard hunters at the gate hit it, times this.', 1, 0.2, 3, 0.05, 'x'),
    n('gateRepairPerSecond', 'Gate repair', 'Gate health a duck holding Use at it puts back per second (a hit pauses it for 1.5 s).', 35, 5, 200, 5, 'hp/s', 'int'),
    n('gateBreakRepairPercent', 'Gate patched at a break', 'Share of the gate\'s health put back at every break between waves (a broken gate past 30% holds again).', 25, 0, 100, 5, '%', 'int'),
    n('bridgeMoveSeconds', 'Drawbridge travel', 'Time the drawbridge takes to rise or come down.', 2.5, 1, 8, 0.5, 's'),
    n('bridgeCooldownSeconds', 'Drawbridge lever cooldown', 'Time after a pull before the lever moves again.', 10, 2, 60, 1, 's', 'int'),
    n('bridgeUpMaxSeconds', 'Drawbridge up at most', 'A raised drawbridge comes down by itself after this long (the hunters always get a way in).', 25, 5, 120, 1, 's', 'int'),
    n('raftSpeed', 'Raft speed', 'How fast hunters paddle across the moat while the drawbridge is up.', 1.5, 0.5, 4, 0.1, 'm/s'),
    n('cannon.damage', 'Bread cannon damage', 'Damage at the center of a loaf\'s splash (falls off to a quarter at the edge).', 75, 10, 400, 5, 'hp', 'int'),
    n('cannon.radius', 'Bread cannon splash', 'Radius of a loaf\'s splash.', 3.5, 1, 8, 0.25, 'm'),
    n('cannon.knockback', 'Bread cannon knockback', 'How hard a loaf shoves hunters at its center (dogs fly further, the Big Hunter less).', 8, 0, 20, 0.5, 'm/s'),
    n('cannon.reloadSeconds', 'Bread cannon reload', 'Time between two loaves.', 1.3, 0.4, 5, 0.1, 's'),
    n('cannon.heatPerShot', 'Bread cannon heat per loaf', 'Heat a loaf adds (100 overheats it).', 30, 5, 100, 1, '%', 'int'),
    n('cannon.coolPerSecond', 'Bread cannon cooling', 'Heat it loses per second.', 10, 1, 50, 1, '%/s', 'int'),
    n('cannon.ventBelow', 'Bread cannon vents to', 'An overheated cannon fires again once it cooled below this.', 35, 0, 90, 1, '%', 'int'),
    n('hunterReactionMin', 'Hunter reaction, fastest', 'Ticks from first seeing a duck to the first shot (on top of the aim telegraph; 30 ticks = 1 s).', 15, 0, 90, 1, 'ticks', 'int'),
    n('hunterReactionMax', 'Hunter reaction, slowest', 'Upper end of the reaction range.', 25, 0, 90, 1, 'ticks', 'int'),
    n('hunterAimError', 'Hunter aim error', 'Aim error on a new target (rad, either way); it settles while the hunter aims.', 0.1, 0, 0.4, 0.005, 'rad'),
    n('hunterSpreadDeg', 'Hunter spread', 'Random cone added to every hunter bullet and pellet.', 1.1, 0, 6, 0.1, 'deg'),
    n('blade.slash1', 'Katana: first cut', 'Damage of the combo\'s first light cut (a Recruit has 20 health, a Beater 40).', 24, 1, 200, 1, 'hp', 'int'),
    n('blade.slash2', 'Katana: second cut', 'Damage of the combo\'s second light cut.', 24, 1, 200, 1, 'hp', 'int'),
    n('blade.slash3', 'Katana: finisher', 'Damage of the combo\'s third cut (the overhead chop).', 42, 1, 300, 1, 'hp', 'int'),
    n('blade.heavy', 'Katana: heavy spin', 'Damage of the heavy spin with no charge.', 34, 1, 300, 1, 'hp', 'int'),
    n('blade.heavyCharge', 'Katana: heavy charge bonus', 'Extra damage of a fully charged heavy spin.', 40, 0, 300, 1, 'hp', 'int'),
    n('blade.storm', 'Blade Storm pulse', 'Damage of each pulse of the ultimate (5 a second for 4 s).', 12, 1, 100, 1, 'hp', 'int'),
    n('blade.quack', 'Quack shockwave damage', 'The "VAK!" shockwave mostly pushes and staggers; this is its damage.', 10, 0, 100, 1, 'hp', 'int'),
    n('blade.dash', 'Dash cut', 'Damage to every hunter a dash passes through (once per dash).', 16, 0, 100, 1, 'hp', 'int'),
    n('blade.crit', 'Crit multiplier', 'Damage multiplier of a back-stab or a fully charged heavy spin.', 1.6, 1, 4, 0.05, 'x'),
    n('blade.staggerSeconds', 'Stagger', 'How long a minion reels after a cut (elites half as long, the Big Hunter a quarter).', 0.35, 0, 2, 0.05, 's'),
    n('blade.knockScale', 'Blade knockback', 'Scales every push of the katana and the quack. 0 turns it off.', 1, 0, 3, 0.1, 'x'),
    n('blade.meterPerHit', 'Storm meter per hit', 'Blade Storm meter for each landed hit (100 fills it).', 1.2, 0, 20, 0.1, ''),
    n('blade.meterPerKill', 'Storm meter per kill', 'Blade Storm meter for each hunter bagged.', 3, 0, 50, 0.5, ''),
    n('blade.comboSeconds', 'Combo window', 'The combo counter resets after this long without a hit.', 3, 1, 10, 0.5, 's'),
    n('blade.beaterDamage', 'Beater hit', 'Damage of a Beater\'s club.', 6, 1, 60, 1, 'hp', 'int'),
    n('blade.recruitDamage', 'Recruit hit', 'Damage of a Recruit\'s pitchfork.', 4, 1, 60, 1, 'hp', 'int'),
    n('push.trenchKills', 'Trench: hunters to bag', 'Hunters to bag around the trench (one duck; more with more ducks).', PUSH.trenchKills, 5, 200, 1, 'hunters', 'int'),
    n('push.crates', 'Supply crates', 'Supply crates to smash at the dugouts.', PUSH.crates, 1, 6, 1, 'crates', 'int'),
    n('push.crateHp', 'Supply crate health', 'Health of a supply crate (one duck; 35% more per extra duck).', PUSH.crateHp, 20, 2000, 10, 'hp', 'int'),
    n('push.snipersPerTower', 'Snipers per watchtower', 'Snipers to take out on each southern watchtower.', PUSH.snipersPerTower, 1, 4, 1, 'snipers', 'int'),
    n('push.packGapScale', 'Time between packs', 'Seconds between two packs, times this (lower: more pressure).', 1, 0.3, 3, 0.05, 'x'),
    n('upgrade.damagePercent', 'Upgrade: damage', 'More katana and pistol damage per card.', 15, 1, 50, 1, '%', 'int'),
    n('upgrade.maxHealth', 'Upgrade: max health', 'More max health per card.', 20, 5, 60, 5, 'hp', 'int'),
    n('upgrade.armorPercent', 'Upgrade: armor', 'Less damage taken per card (at most 70% in all).', 10, 1, 30, 1, '%', 'int'),
    n('upgrade.regenPerSecond', 'Upgrade: regen', 'Health per second per card, after 3 s without a hit.', 1.5, 0.5, 6, 0.5, 'hp/s'),
    n('upgrade.revivePercent', 'Upgrade: faster revive', 'Shorter revives per card.', 25, 5, 50, 5, '%', 'int'),
    n('upgrade.reachPercent', 'Upgrade: wider arcs', 'More katana reach per card.', 15, 5, 50, 1, '%', 'int'),
    n('upgrade.critPercent', 'Upgrade: crits', 'More crit damage (back-stabs, full heavy spins) per card.', 30, 5, 100, 5, '%', 'int'),
    n('upgrade.lifesteal', 'Upgrade: lifesteal', 'Health back per landed cut, per card.', 1, 0.5, 10, 0.5, 'hp'),
    n('upgrade.stormPercent', 'Upgrade: storm charge', 'Faster Blade Storm meter per card.', 25, 5, 100, 5, '%', 'int'),
    n('upgrade.bleedDps', 'Upgrade: bleed', 'Damage per second for 3 s after a cut, per card.', 6, 1, 40, 1, 'hp/s', 'int'),
    n('upgrade.chainPercent', 'Upgrade: chain lightning', 'Share of a heavy spin\'s damage that arcs to up to 3 more hunters nearby, per card.', 40, 5, 100, 5, '%', 'int'),
    n('upgrade.finisherPercent', 'Upgrade: finisher', 'More damage on the combo\'s third cut per card.', 40, 5, 150, 5, '%', 'int'),
    n('dropAmmoPercent', 'Ammo drop chance', 'Chance a defeated hunter drops ammo.', 22, 0, 100, 1, '%', 'int'),
    n('dropHealPercent', 'Heal drop chance', 'Chance a defeated hunter drops a small heal.', 12, 0, 100, 1, '%', 'int'),
    n('healAmount', 'Heal drop', 'Health a heal drop gives.', 25, 5, 100, 5, 'hp', 'int'),
  ];
}

export const SETTING_DEFS: readonly SettingDef[] = [
  ...dmRoomDefs(),
  { key: 'dm.players', group: 'dm', label: 'Ducks per room', help: 'Humans plus bots in every deathmatch room. Bots fill the seats humans do not take.', kind: 'int', default: MATCH.players, min: 2, max: 32, step: 1, unit: 'ducks', applies: 'now' },
  { key: 'dm.maxHumans', group: 'dm', label: 'Most humans per room', help: 'Human players a deathmatch room takes (past the ducks per room there are no bots).', kind: 'int', default: ROOM.maxClients, min: 1, max: 32, step: 1, unit: 'players', applies: 'now', env: 'QWAKK_MAX_CLIENTS' },
  { key: 'dm.scoreLimit', group: 'dm', label: 'Kill limit', help: 'First to this many kills wins the round.', kind: 'int', default: MATCH.scoreLimit, min: 5, max: 500, step: 1, unit: 'kills', applies: 'next-round' },
  { key: 'dm.roundSeconds', group: 'dm', label: 'Round time', help: 'Most kills when the time runs out wins.', kind: 'int', default: MATCH.roundSeconds, min: 60, max: 3600, step: 30, unit: 's', applies: 'next-round' },
  { key: 'dm.intermissionSeconds', group: 'dm', label: 'Break between rounds', help: 'Results time before the next round.', kind: 'int', default: MATCH.intermissionSeconds, min: 3, max: 60, step: 1, unit: 's', applies: 'next-round' },
  { key: 'dm.spawnProtectionSeconds', group: 'dm', label: 'Spawn protection', help: 'A fresh duck takes no damage for this long (firing ends it early). 0 turns it off.', kind: 'number', default: SPAWN_PROTECTION.ticks / TICK_RATE, min: 0, max: 10, step: 0.5, unit: 's', applies: 'now' },
  ...dmBuffDefs(),
  ...skillDefs('dmBot', DM_BOT_DEFAULTS),
  { key: 'br.maxRooms', group: 'br', label: 'Rooms at once', help: 'Battle royale rooms open at the same time (waiting, counting down or playing). 0 opens none.', kind: 'int', default: BR.maxRooms, min: 0, max: 8, step: 1, unit: 'rooms', applies: 'now', env: 'QWAKK_BR_MAX_ROOMS' },
  { key: 'br.minHumans', group: 'br', label: 'Humans to start', help: 'Human target without bots. Bot rooms start a countdown with the first player; later arrivals add 15 s.', kind: 'int', default: BR.minHumans, min: 1, max: BR.players, step: 1, unit: 'players', applies: 'new-rooms', env: 'QWAKK_BR_MIN_HUMANS' },
  { key: 'br.countdownSeconds', group: 'br', label: 'Start countdown', help: 'Countdown without bots. With bots and a human target of 1, can shorten the initial 30 s wait; later arrivals add 15 s.', kind: 'int', default: BR.countdownSeconds, min: 5, max: 120, step: 1, unit: 's', applies: 'new-rooms', env: 'QWAKK_BR_COUNTDOWN' },
  { key: 'br.mode.solo', group: 'br', label: 'Solo rooms', help: 'Players may open Solo rooms.', kind: 'bool', default: true, applies: 'now' },
  { key: 'br.mode.duo', group: 'br', label: 'Duo rooms', help: 'Players may open Duo rooms.', kind: 'bool', default: true, applies: 'now' },
  { key: 'br.mode.squad', group: 'br', label: 'Squad rooms', help: 'Players may open Squad rooms.', kind: 'bool', default: true, applies: 'now' },
  { key: 'br.zoneTimeScale', group: 'br', label: 'Zone timing', help: 'Every zone wait and shrink takes this many times its default (0.8 is a faster match, 1.2 a slower one). The defaults close the zone 5.5 minutes after the plane starts.', kind: 'number', default: 1, min: 0.5, max: 2, step: 0.05, unit: 'x', applies: 'new-rooms' },
  { key: 'br.zoneDamageScale', group: 'br', label: 'Zone damage', help: 'Damage per second outside the zone, times this (rounded, at least 1 per second).', kind: 'number', default: 1, min: 0.5, max: 3, step: 0.1, unit: 'x', applies: 'new-rooms' },
  { key: 'br.firstCircleRadius', group: 'br', label: 'First circle', help: 'Radius of the first safe circle, shown while the plane flies. The plane flies over it and ejects everyone soon after its center.', kind: 'int', default: ZONE.phases[0].radius, min: 160, max: 380, step: 5, unit: 'm', applies: 'new-rooms' },
  ...skillDefs('brBot', BR_BOT_DEFAULTS),
  ...raidDefs(),
  ...weaponDefs(),
  ...explosiveDefs(),
  { key: 'ops.banner', group: 'ops', label: 'Menu banner', help: 'A short line at the top of the menu. Empty hides it.', kind: 'text', default: '', maxLength: 160, applies: 'now' },
  { key: 'ops.maintenance', group: 'ops', label: 'Maintenance mode', help: 'Refuses new joins and new rooms. Matches already running finish.', kind: 'bool', default: false, applies: 'now' },
  { key: 'ops.maintenanceMessage', group: 'ops', label: 'Maintenance note', help: 'Shown in the menu during maintenance. Empty uses the default line.', kind: 'text', default: '', maxLength: 160, applies: 'now' },
];

/** Team size to its mode switch. */
export const TEAM_MODE_KEYS: Record<number, string> = { 1: 'br.mode.solo', 2: 'br.mode.duo', 4: 'br.mode.squad' };
