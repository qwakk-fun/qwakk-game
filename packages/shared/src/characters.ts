/**
 * Playable ducks: the catalog the client and the server agree on. A character
 * is looks only. Every duck shares one skeleton, one set of clips, the same
 * weapons and the same hitboxes (`hitbox.ts` takes no character), so the pick
 * never makes a duck easier or harder to hit.
 *
 * The id travels as the `character` join option and sits on the public
 * player state. The server keeps only ids from this list (anything else, or
 * nothing, is the classic duck). Names, accent colors and portraits live in
 * the menu (`apps/client/src/ui/menu/characters.ts`, `copy.ts`); the model
 * file is `models/duck.glb` for the classic and `models/duck_<key>.glb` for
 * the others (the art asset contract in README.md).
 */
export const CHARACTERS = [
  { id: 0, key: 'classic' },
  { id: 1, key: 'mallard' },
] as const;

export type CharacterKey = (typeof CHARACTERS)[number]['key'];

/** The classic yellow duck: the fallback for a missing or unknown pick. */
export const DEFAULT_CHARACTER = 0;

export function isCharacterId(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && CHARACTERS.some((c) => c.id === v);
}

/** A join option as the server keeps it: a known id, else the classic duck. */
export function characterFromOption(v: unknown): number {
  return isCharacterId(v) ? v : DEFAULT_CHARACTER;
}

export function characterKey(id: number): CharacterKey {
  return (CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0]).key;
}

export function characterIdOf(key: string): number {
  return CHARACTERS.find((c) => c.key === key)?.id ?? DEFAULT_CHARACTER;
}

/**
 * A bot's duck: the character fewest ducks in the room wear right now (ties go
 * to the one after `salt` in the catalog, so a room filling up alternates).
 * `inUse` is every seated duck's character, humans included.
 */
export function pickBotCharacter(inUse: Iterable<number>, salt = 0): number {
  const counts = new Map<number, number>(CHARACTERS.map((c) => [c.id, 0]));
  for (const id of inUse) if (counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
  const n = CHARACTERS.length;
  const start = ((salt % n) + n) % n;
  let best: number = CHARACTERS[start]!.id;
  for (let k = 0; k < n; k++) {
    const id = CHARACTERS[(start + k) % n]!.id;
    if ((counts.get(id) ?? 0) < (counts.get(best) ?? 0)) best = id;
  }
  return best;
}
