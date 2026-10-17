/**
 * Nickname rules: 3 to 16 characters from letters, digits and underscore, and
 * not blocked by the word list in `blocked-names.json` (slurs, insults and
 * impersonation, English and Turkish).
 *
 * Every check runs on three spellings: digits read as letters with 1 as i
 * ("sh1t", "f4ck" as "fack"), the same with 1 as l, and digits dropped
 * ("f4ck" as "fck"). Underscores are dropped for the joined check ("f_u_c_k"),
 * each letter of a listed word may repeat ("fuuuck"), and the regex
 * `patterns` catch dropped or swapped vowels ("fck", "phuk") and Turkish stems
 * at the start of a word ("Sikdir", "sikimi") without hitting Klasik or Isik.
 */
import { readFileSync } from 'node:fs';

export const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

export type NameCheck = { ok: true; name: string } | { ok: false; reason: 'format' | 'blocked' | 'reserved' };

interface WordData {
  anywhere: string[];
  whole: string[];
  patterns: string[];
  obfuscatedOnly: string[];
  allow: string[];
  reservedAnywhere: string[];
  reservedWhole: string[];
}

const data = JSON.parse(readFileSync(new URL('./blocked-names.json', import.meta.url), 'utf8')) as WordData;

const LEET_I: Record<string, string> = { '0': 'o', '1': 'i', '2': 'z', '3': 'e', '4': 'a', '5': 's', '6': 'g', '7': 't', '8': 'b', '9': 'g' };
const LEET_L: Record<string, string> = { ...LEET_I, '1': 'l' };
const STRIP: Record<string, string> = Object.fromEntries([...'0123456789'].map((d) => [d, '']));

function leet(s: string, map: Record<string, string>): string {
  let out = '';
  for (const ch of s) out += map[ch] ?? ch;
  return out;
}

/** Each letter may repeat: "ass" matches "aass" and "asss" but not "as". */
function wordPattern(word: string): string {
  return [...word].map((c) => `${c}+`).join('');
}

const anywhereRe = data.anywhere.map((w) => new RegExp(wordPattern(w)));
const reservedAnywhereRe = data.reservedAnywhere.map((w) => new RegExp(wordPattern(w)));
const wholeRe = data.whole.map((w) => new RegExp(`^${wordPattern(w)}$`));
const reservedWholeRe = data.reservedWhole.map((w) => new RegExp(`^${wordPattern(w)}$`));
const patternRe = data.patterns.map((p) => new RegExp(p));
const obfuscatedRe = data.obfuscatedOnly.map((w) => new RegExp(wordPattern(w)));
const allowRe = data.allow.map((w) => new RegExp(wordPattern(w), 'g'));

/**
 * Extra blocked words added at runtime from the admin panel (stored in the
 * `blocked_names` table, loaded at start), checked in addition to the file:
 * `anywhere` words match inside a name like the file's `anywhere` list,
 * whole words only as a whole name or one of its parts. Letters only.
 */
export const EXTRA_WORD_RE = /^[a-z]{3,24}$/;
let extraAnywhereRe: RegExp[] = [];
let extraWholeRe: RegExp[] = [];

export function setExtraBlocked(list: readonly { word: string; whole: boolean }[]): void {
  const ok = list.filter((w) => EXTRA_WORD_RE.test(w.word));
  extraAnywhereRe = ok.filter((w) => !w.whole).map((w) => new RegExp(wordPattern(w.word)));
  extraWholeRe = ok.filter((w) => w.whole).map((w) => new RegExp(`^${wordPattern(w.word)}$`));
}

function allowOut(s: string): string {
  let out = s;
  for (const re of allowRe) out = out.replace(re, '_');
  return out;
}

/** Name parts: split on underscores and on CamelCase humps ("BigDuck_7" -> big, duck, 7). */
export function nameParts(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split('_')
    .filter(Boolean);
}

function variants(name: string): { parts: string[]; joined: string }[] {
  const parts = nameParts(name);
  return [LEET_I, LEET_L, STRIP].map((map) => {
    const p = parts.map((x) => leet(x, map));
    return { parts: p, joined: p.join('') };
  });
}

export function checkName(input: unknown): NameCheck {
  if (typeof input !== 'string') return { ok: false, reason: 'format' };
  const name = input.trim();
  if (!NAME_RE.test(name)) return { ok: false, reason: 'format' };
  const letters = name.toLowerCase().replace(/[^a-z]/g, '');
  for (const { parts, joined } of variants(name)) {
    const open = allowOut(joined);
    if (anywhereRe.some((re) => re.test(open))) return { ok: false, reason: 'blocked' };
    if (wholeRe.some((re) => re.test(joined) || parts.some((p) => re.test(p)))) return { ok: false, reason: 'blocked' };
    if (patternRe.some((re) => re.test(open) || parts.some((p) => re.test(allowOut(p))))) return { ok: false, reason: 'blocked' };
    if (extraAnywhereRe.some((re) => re.test(open))) return { ok: false, reason: 'blocked' };
    if (extraWholeRe.some((re) => re.test(joined) || parts.some((p) => re.test(p)))) return { ok: false, reason: 'blocked' };
    if (obfuscatedRe.some((re) => re.test(joined) && !re.test(letters))) return { ok: false, reason: 'blocked' };
    if (reservedAnywhereRe.some((re) => re.test(joined))) return { ok: false, reason: 'reserved' };
    if (reservedWholeRe.some((re) => re.test(joined))) return { ok: false, reason: 'reserved' };
  }
  return { ok: true, name };
}
