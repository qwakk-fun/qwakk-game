/**
 * What players see of the server operations: the menu banner and maintenance
 * state (GET /api/status, read by the menu) and in-game notices (Msg.Notice,
 * a HUD toast in every game room). The banner and maintenance are settings
 * (`ops.*`), so they survive a restart; a notice is sent once and not kept.
 */
import type { ServerStatus } from '@qwakk/shared/lobby';
import { liveRules, maintenanceOn, settings } from '../settings/index.ts';
import { liveRooms } from './rooms.ts';

export const NOTICE_MAX = 200;

export function publicStatus(): ServerStatus {
  const banner = settings.text('ops.banner');
  const note = settings.text('ops.maintenanceMessage');
  const maintenance = maintenanceOn();
  return { banner: banner || null, maintenance, maintenanceMessage: maintenance && note ? note : null, rules: liveRules() };
}

/** Clean notice text: one line, no control characters, at most NOTICE_MAX characters. Empty: nothing to send. */
export function cleanNotice(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NOTICE_MAX);
}

/** Send a notice to every player in every game room; returns how many rooms got it. */
export function broadcastNotice(text: string): number {
  let n = 0;
  for (const r of liveRooms) {
    r.notice(text);
    n++;
  }
  return n;
}
