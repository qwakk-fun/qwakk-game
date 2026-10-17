/**
 * Every setting the admin panel can change at runtime, with its type, range,
 * default and when it takes effect. The defaults are the constants
 * (`MATCH`, `BR`, `DM_BOT`, `SPAWN_PROTECTION`, `WEAPONS`, `BR_SKILL`,
 * `DM_ROOM_CATALOG`): with nothing stored, the server runs exactly as the
 * constants say. Only numbers the server alone decides are here; anything the
 * client also simulates for prediction (movement, fire rate, spread, recoil,
 * aim down sights) stays a constant (it needs a client deploy).
 */
import { BR, DM_BOT, MATCH, ROOM, SPAWN_PROTECTION, TICK_RATE, WEAPONS } from '@qwakk/shared';
import { DM_OPEN_ROOMS, DM_ROOM_CATALOG } from '@qwakk/shared/lobby';
import { BR_SKILL } from '../br/brBot.ts';

/** When a change takes effect. */
export type Applies = 'now' | 'next-round' | 'new-rooms';
export type SettingKind = 'int' | 'number' | 'bool' | 'text';
export type SettingValue = number | boolean | string;
export type SettingGroup = 'dm' | 'dmBot' | 'br' | 'brBot' | 'weapons' | 'ops';

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

export const SETTING_DEFS: readonly SettingDef[] = [
  ...dmRoomDefs(),
  { key: 'dm.players', group: 'dm', label: 'Ducks per room', help: 'Humans plus bots in every deathmatch room. Bots fill the seats humans do not take.', kind: 'int', default: MATCH.players, min: 2, max: 32, step: 1, unit: 'ducks', applies: 'now' },
  { key: 'dm.maxHumans', group: 'dm', label: 'Most humans per room', help: 'Human players a deathmatch room takes (past the ducks per room there are no bots).', kind: 'int', default: ROOM.maxClients, min: 1, max: 32, step: 1, unit: 'players', applies: 'now', env: 'QWAKK_MAX_CLIENTS' },
  { key: 'dm.scoreLimit', group: 'dm', label: 'Kill limit', help: 'First to this many kills wins the round.', kind: 'int', default: MATCH.scoreLimit, min: 5, max: 500, step: 1, unit: 'kills', applies: 'next-round' },
  { key: 'dm.roundSeconds', group: 'dm', label: 'Round time', help: 'Most kills when the time runs out wins.', kind: 'int', default: MATCH.roundSeconds, min: 60, max: 3600, step: 30, unit: 's', applies: 'next-round' },
  { key: 'dm.intermissionSeconds', group: 'dm', label: 'Break between rounds', help: 'Results time before the next round.', kind: 'int', default: MATCH.intermissionSeconds, min: 3, max: 60, step: 1, unit: 's', applies: 'next-round' },
  { key: 'dm.spawnProtectionSeconds', group: 'dm', label: 'Spawn protection', help: 'A fresh duck takes no damage for this long (firing ends it early). 0 turns it off.', kind: 'number', default: SPAWN_PROTECTION.ticks / TICK_RATE, min: 0, max: 10, step: 0.5, unit: 's', applies: 'now' },
  ...skillDefs('dmBot', DM_BOT_DEFAULTS),
  { key: 'br.maxRooms', group: 'br', label: 'Rooms at once', help: 'Battle royale rooms open at the same time (waiting, counting down or playing). 0 opens none.', kind: 'int', default: BR.maxRooms, min: 0, max: 8, step: 1, unit: 'rooms', applies: 'now', env: 'QWAKK_BR_MAX_ROOMS' },
  { key: 'br.minHumans', group: 'br', label: 'Humans to start', help: 'Humans a room needs before the start countdown runs.', kind: 'int', default: BR.minHumans, min: 1, max: BR.players, step: 1, unit: 'players', applies: 'new-rooms', env: 'QWAKK_BR_MIN_HUMANS' },
  { key: 'br.countdownSeconds', group: 'br', label: 'Start countdown', help: 'Countdown once enough humans are in.', kind: 'int', default: BR.countdownSeconds, min: 5, max: 120, step: 1, unit: 's', applies: 'new-rooms', env: 'QWAKK_BR_COUNTDOWN' },
  { key: 'br.mode.solo', group: 'br', label: 'Solo rooms', help: 'Players may open Solo rooms.', kind: 'bool', default: true, applies: 'now' },
  { key: 'br.mode.duo', group: 'br', label: 'Duo rooms', help: 'Players may open Duo rooms.', kind: 'bool', default: true, applies: 'now' },
  { key: 'br.mode.squad', group: 'br', label: 'Squad rooms', help: 'Players may open Squad rooms.', kind: 'bool', default: true, applies: 'now' },
  ...skillDefs('brBot', BR_BOT_DEFAULTS),
  ...weaponDefs(),
  { key: 'ops.banner', group: 'ops', label: 'Menu banner', help: 'A short line at the top of the menu. Empty hides it.', kind: 'text', default: '', maxLength: 160, applies: 'now' },
  { key: 'ops.maintenance', group: 'ops', label: 'Maintenance mode', help: 'Refuses new joins and new rooms. Matches already running finish.', kind: 'bool', default: false, applies: 'now' },
  { key: 'ops.maintenanceMessage', group: 'ops', label: 'Maintenance note', help: 'Shown in the menu during maintenance. Empty uses the default line.', kind: 'text', default: '', maxLength: 160, applies: 'now' },
];

/** Team size to its mode switch. */
export const TEAM_MODE_KEYS: Record<number, string> = { 1: 'br.mode.solo', 2: 'br.mode.duo', 4: 'br.mode.squad' };
