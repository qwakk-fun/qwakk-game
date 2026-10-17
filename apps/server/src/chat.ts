import { CHAT } from '@qwakk/shared';

/** Bound work before normalizing; strip control/format characters and fold whitespace. */
export function cleanChat(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > CHAT.maxLength) return null;
  const text = raw.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/gu, ' ').trim();
  return text || null;
}

/** One limiter per game room, with entries removed when a player leaves. */
export class ChatLimiter {
  private readonly sent = new Map<string, number>();

  allow(id: string, now: number): boolean {
    const previous = this.sent.get(id);
    if (previous !== undefined && now - previous < CHAT.intervalMs) return false;
    this.sent.set(id, now);
    return true;
  }

  forget(id: string): void {
    this.sent.delete(id);
  }
}
