/**
 * Runtime settings: the values (runtime.ts) over the definitions (defs.ts),
 * the bot skill sync and presets (skills.ts), the server weapon table
 * (weapons.ts) and typed reads for the rooms (rules.ts). Importing this
 * module installs the bot skill sync.
 */
import { settings } from './runtime.ts';
import { installSkillSync } from './skills.ts';

export { settings, RuntimeSettings, type SettingView, type SetResult } from './runtime.ts';
export { SETTING_DEFS, type SettingDef, type SettingValue, type Applies } from './defs.ts';
export { currentPreset, presetValues, PRESETS, type Preset, type SkillGroup } from './skills.ts';
export { serverWeapon } from './weapons.ts';
export { stackDamageScale } from './dmBuffs.ts';
export { explosiveRules, grenadesPerLife, rocketPickupRules, type ExplosiveRules, type BlastRules } from './explosives.ts';
export * from './rules.ts';

installSkillSync(settings);
