/**
 * Hub chat runs through the room chat rules (chat.ts: length, control
 * characters, the per-duck cooldown) and then through the name word list
 * (meta/names.ts, blocked-names.json plus the admin panel's extra words):
 * a word a name could not be is masked with asterisks. Speech bubbles float
 * over ducks in a public square, so they get the same filter as names.
 */
import { checkName } from '../meta/names.ts';
import { cleanChat } from '../chat.ts';

/** Turkish and other Latin letters folded to the ASCII the word list checks. */
const FOLD: Record<string, string> = { ı: 'i', İ: 'I', ş: 's', Ş: 'S', ğ: 'g', Ğ: 'G', ü: 'u', Ü: 'U', ö: 'o', Ö: 'O', ç: 'c', Ç: 'C', â: 'a', î: 'i', û: 'u' };

function fold(word: string): string {
  let out = '';
  for (const ch of word) out += FOLD[ch] ?? ch;
  return out.normalize('NFKD').replace(/[^A-Za-z0-9_]/g, '');
}

/** Is this one word blocked by the name list? */
export function blockedWord(word: string): boolean {
  const ascii = fold(word);
  if (ascii.length < 3) return false;
  // Names are 3 to 16 characters: check long words in overlapping windows too.
  const parts = ascii.length <= 16 ? [ascii] : Array.from({ length: Math.ceil((ascii.length - 8) / 8) + 1 }, (_, i) => ascii.slice(i * 8, i * 8 + 16)).filter((p) => p.length >= 3);
  return parts.some((p) => {
    const r = checkName(p);
    return !r.ok && r.reason === 'blocked';
  });
}

/** A chat line for the hub: cleaned, with blocked words masked; null when unusable. */
export function filterHubChat(raw: unknown): string | null {
  const text = cleanChat(raw);
  if (!text) return null;
  return text.replace(/[\p{L}\p{N}_]+/gu, (w) => (blockedWord(w) ? '*'.repeat(Math.min(8, [...w].length)) : w));
}
