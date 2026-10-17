/**
 * Server policy for new game rooms, from the admin settings, run by the
 * matchmaking guard before a room is opened: none during maintenance, and
 * battle royale rooms only in the team modes that are switched on.
 */
import { ServerError } from '@colyseus/core';
import { BR } from '@qwakk/shared';
import { LOBBY_ERROR, teamSizeOf } from '@qwakk/shared/lobby';
import { maintenanceOn, teamModes } from '../settings/index.ts';

export function beforeCreate(roomName: string, options: Record<string, unknown>): void {
  if (maintenanceOn()) throw new ServerError(LOBBY_ERROR.maintenance, 'the server is under maintenance');
  if (roomName === BR.roomName && !teamModes().includes(teamSizeOf(options.team))) throw new ServerError(LOBBY_ERROR.modeOff, 'that mode is off for now');
}
