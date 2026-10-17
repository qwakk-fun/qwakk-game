/**
 * Opens and closes the static deathmatch rooms as the `dm.room.*` settings
 * say: at start, and live when the admin flips one. Closing a room sends
 * everyone in it back to the menu (CLOSE_CODE.roomClosed) and disposes it;
 * opening creates it with its catalog id, exactly as at start. Changes run
 * one after another, so quick toggles cannot race.
 */
import { DM_ROOM_CATALOG } from '@qwakk/shared/lobby';
import { openDmRooms, settings } from '../settings/index.ts';

export interface DmRoomDriver {
  isOpen(id: string): boolean;
  open(id: string): Promise<unknown>;
  close(id: string): Promise<unknown>;
}

let queue: Promise<unknown> = Promise.resolve();

/** Bring the open rooms in line with the settings (runs after any change already queued). */
export function syncDmRooms(driver: DmRoomDriver): Promise<void> {
  const run = async (): Promise<void> => {
    const want = new Set(openDmRooms());
    for (const r of DM_ROOM_CATALOG) {
      try {
        if (want.has(r.id) && !driver.isOpen(r.id)) {
          await driver.open(r.id);
          console.log(`[ops] deathmatch room ${r.id} opened`);
        } else if (!want.has(r.id) && driver.isOpen(r.id)) {
          await driver.close(r.id);
          console.log(`[ops] deathmatch room ${r.id} closed`);
        }
      } catch (err) {
        console.error(`[ops] deathmatch room ${r.id} change failed:`, err instanceof Error ? err.message : err);
      }
    }
  };
  const next = queue.then(run, run);
  queue = next;
  return next;
}

/** Open the rooms now and follow every later change of a `dm.room.*` setting. */
export async function installDmRoomControl(driver: DmRoomDriver): Promise<() => void> {
  await syncDmRooms(driver);
  return settings.onChange((key) => {
    if (key.startsWith('dm.room.')) void syncDmRooms(driver);
  });
}
