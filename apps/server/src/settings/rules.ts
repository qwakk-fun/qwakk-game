/**
 * Typed reads of the runtime settings for the rooms and the matchmaking guard.
 * Called when something starts (a room, a round, a spawn), never per tick.
 */
import { TICK_RATE } from '@qwakk/shared';
import { DM_ROOM_CATALOG, type LiveRules } from '@qwakk/shared/lobby';
import { TEAM_MODE_KEYS } from './defs.ts';
import { settings } from './runtime.ts';

/** Deathmatch round rules, read at the start of every round. */
export function dmRoundRules(): { scoreLimit: number; roundSeconds: number; intermissionSeconds: number } {
  return { scoreLimit: settings.num('dm.scoreLimit'), roundSeconds: settings.num('dm.roundSeconds'), intermissionSeconds: settings.num('dm.intermissionSeconds') };
}

export function dmPlayers(): number {
  return settings.num('dm.players');
}

export function dmMaxHumans(): number {
  return settings.num('dm.maxHumans');
}

/** Spawn protection in ticks, read at every deathmatch spawn. */
export function spawnProtectTicks(): number {
  return Math.round(settings.num('dm.spawnProtectionSeconds') * TICK_RATE);
}

/** The deathmatch rooms that should be open (catalog order). */
export function openDmRooms(): string[] {
  return DM_ROOM_CATALOG.filter((r) => settings.bool(`dm.room.${r.id}`)).map((r) => r.id);
}

export function brMaxRooms(): number {
  return settings.num('br.maxRooms');
}

export function brStartRules(): { minHumans: number; countdownSeconds: number } {
  return { minHumans: settings.num('br.minHumans'), countdownSeconds: settings.num('br.countdownSeconds') };
}

/** Battle royale team sizes players may open right now. */
export function teamModes(): number[] {
  return Object.entries(TEAM_MODE_KEYS)
    .filter(([, key]) => settings.bool(key))
    .map(([t]) => Number(t));
}

export function maintenanceOn(): boolean {
  return settings.bool('ops.maintenance');
}

/** The rules the menu shows (GET /api/status). */
export function liveRules(): LiveRules {
  return {
    brMaxRooms: brMaxRooms(),
    brMinHumans: settings.num('br.minHumans'),
    brCountdownSeconds: settings.num('br.countdownSeconds'),
    teamModes: teamModes(),
    dmPlayers: dmPlayers(),
    dmCap: dmMaxHumans(),
    dmRooms: openDmRooms(),
  };
}
