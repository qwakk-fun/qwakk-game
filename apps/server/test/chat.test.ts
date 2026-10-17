import { describe, expect, it } from 'vitest';
import { CHAT } from '@qwakk/shared';
import { ChatLimiter, cleanChat } from '../src/chat.ts';

describe('room chat validation', () => {
  it('accepts Turkish and emoji, folding whitespace and removing invisible controls', () => {
    expect(cleanChat('  Selam\n\tördekler! 🦆\u202e  ')).toBe('Selam ördekler! 🦆');
  });

  it('rejects malformed, blank and oversized messages', () => {
    for (const raw of [null, undefined, 1, {}, ['hi'], { text: 'hi', name: 'Admin' }, ' \n\u0000 ', 'x'.repeat(CHAT.maxLength + 1)]) {
      expect(cleanChat(raw)).toBeNull();
    }
    expect(cleanChat('x'.repeat(CHAT.maxLength))).toHaveLength(CHAT.maxLength);
  });

  it('limits each sender independently, then releases their state on leave', () => {
    const limiter = new ChatLimiter();
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', CHAT.intervalMs - 1)).toBe(false);
    expect(limiter.allow('b', 0)).toBe(true);
    expect(limiter.allow('a', CHAT.intervalMs)).toBe(true);
    limiter.forget('a');
    expect(limiter.allow('a', CHAT.intervalMs + 1)).toBe(true);
  });
});
