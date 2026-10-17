/**
 * Bot skill settings: keeps the live skill objects the bots read
 * (`SKILL` in bots.ts for the deathmatch, `BR_SKILL` in br/brBot.ts) in step
 * with the settings, by writing their fields in place. Every bot holds a
 * reference to one of those objects, so a change reaches all of them at once,
 * and a bot reads a plain field as before (nothing extra per tick).
 *
 * Presets set every knob of one group at once: normal is the constants
 * (`DM_BOT`, `BR_SKILL`), easy and hard are spelled out here.
 */
import { BR_SKILL } from '../br/brBot.ts';
import { SKILL, type BotSkill } from '../bots.ts';
import { BR_BOT_DEFAULTS, DM_BOT_DEFAULTS, SKILL_FIELD_IDS, type SkillValues } from './defs.ts';
import type { RuntimeSettings } from './runtime.ts';

export type SkillGroup = 'dmBot' | 'brBot';
export const PRESETS = ['easy', 'normal', 'hard'] as const;
export type Preset = (typeof PRESETS)[number];

const pair = (a: number, b: number): [number, number] => [a, Math.max(a, b)];

/** Write the skill knobs into a live skill object. Ranges whose upper end is below the lower one use the lower one. */
export function writeSkill(target: BotSkill, v: SkillValues): void {
  target.reactionTicks = pair(v.reactionMin!, v.reactionMax!);
  target.yawError = v.yawError!;
  target.pitchError = v.pitchError!;
  target.errorSettlePerTick = v.errorSettle!;
  target.burstYawError = v.burstYawError!;
  target.burstPitchError = v.burstPitchError!;
  target.trackRate = v.trackRate!;
  target.turnRatePerTick = v.turnRate!;
  target.recoilControl = v.recoilControl!;
  target.headChance = v.headChance!;
  target.viewRange = v.viewRange!;
  target.fovCos = Math.cos((v.fovDeg! * Math.PI) / 180);
  target.hearRange = v.hearRange!;
  target.burstShots = pair(v.burstMin!, v.burstMax!);
  target.longBurstShots = pair(v.longBurstMin!, v.longBurstMax!);
  target.burstPauseTicks = pair(v.pauseMin!, v.pauseMax!);
  target.semiPauseTicks = pair(v.semiPauseMin!, v.semiPauseMax!);
}

/** The current knobs of a group from the settings. */
export function skillFromSettings(s: RuntimeSettings, group: SkillGroup): SkillValues {
  const out: SkillValues = {};
  for (const id of SKILL_FIELD_IDS) out[id] = s.num(`${group}.${id}`);
  return out;
}

const DM_EASY: SkillValues = {
  reactionMin: 20, reactionMax: 32, yawError: 0.28, pitchError: 0.1, errorSettle: 0.97, burstYawError: 0.03, burstPitchError: 0.018,
  trackRate: 0.2, turnRate: 0.12, recoilControl: 0.4, headChance: 0.02, viewRange: 60, fovDeg: 50, hearRange: 5,
  burstMin: 2, burstMax: 4, longBurstMin: 1, longBurstMax: 3, pauseMin: 12, pauseMax: 22, semiPauseMin: 8, semiPauseMax: 14,
};
const DM_HARD: SkillValues = {
  reactionMin: 8, reactionMax: 14, yawError: 0.12, pitchError: 0.05, errorSettle: 0.92, burstYawError: 0.01, burstPitchError: 0.006,
  trackRate: 0.6, turnRate: 0.2, recoilControl: 0.7, headChance: 0.12, viewRange: 90, fovDeg: 70, hearRange: 8,
  burstMin: 3, burstMax: 6, longBurstMin: 2, longBurstMax: 4, pauseMin: 5, pauseMax: 10, semiPauseMin: 3, semiPauseMax: 7,
};
const BR_EASY: SkillValues = {
  reactionMin: 22, reactionMax: 36, yawError: 0.24, pitchError: 0.1, errorSettle: 0.96, burstYawError: 0.02, burstPitchError: 0.012,
  trackRate: 0.4, turnRate: 0.16, recoilControl: 0.45, headChance: 0.05, viewRange: 40, fovDeg: 60, hearRange: 6,
  burstMin: 2, burstMax: 4, longBurstMin: 1, longBurstMax: 3, pauseMin: 10, pauseMax: 18, semiPauseMin: 6, semiPauseMax: 12,
};
const BR_HARD: SkillValues = {
  reactionMin: 9, reactionMax: 16, yawError: 0.12, pitchError: 0.05, errorSettle: 0.9, burstYawError: 0, burstPitchError: 0,
  trackRate: 1, turnRate: 0.26, recoilControl: 0.75, headChance: 0.15, viewRange: 70, fovDeg: 80, hearRange: 11,
  burstMin: 4, burstMax: 8, longBurstMin: 2, longBurstMax: 5, pauseMin: 4, pauseMax: 9, semiPauseMin: 2, semiPauseMax: 5,
};

export function presetValues(group: SkillGroup, preset: Preset): SkillValues {
  if (preset === 'normal') return group === 'dmBot' ? DM_BOT_DEFAULTS : BR_BOT_DEFAULTS;
  if (group === 'dmBot') return preset === 'easy' ? DM_EASY : DM_HARD;
  return preset === 'easy' ? BR_EASY : BR_HARD;
}

/** Which preset the current knobs match exactly, or 'custom'. */
export function currentPreset(s: RuntimeSettings, group: SkillGroup): Preset | 'custom' {
  const now = skillFromSettings(s, group);
  for (const p of PRESETS) {
    const v = presetValues(group, p);
    if (SKILL_FIELD_IDS.every((id) => Math.abs((now[id] ?? 0) - (v[id] ?? 0)) < 1e-9)) return p;
  }
  return 'custom';
}

/** Keep SKILL and BR_SKILL in step with the settings (now, and on every change of a bot knob). */
export function installSkillSync(s: RuntimeSettings): () => void {
  writeSkill(SKILL, skillFromSettings(s, 'dmBot'));
  writeSkill(BR_SKILL, skillFromSettings(s, 'brBot'));
  return s.onChange((key) => {
    if (key.startsWith('dmBot.')) writeSkill(SKILL, skillFromSettings(s, 'dmBot'));
    else if (key.startsWith('brBot.')) writeSkill(BR_SKILL, skillFromSettings(s, 'brBot'));
  });
}
