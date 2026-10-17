/**
 * The duck catalog for the character step. One duck today; a new one is a new
 * entry here plus its name and line in copy.ts (`COPY.characters.list`).
 *
 * The pick is remembered in this browser (localStorage `qwakk.character`) and
 * read by the menu only. It is not sent to the game or the server yet: a later
 * change wires it into the join options (and the server decides what it allows).
 */
import { COPY } from './copy.ts';

export type CharacterId = keyof typeof COPY.characters.list;

export interface Character {
  id: CharacterId;
  /** The card's accent (ring, glow, name plate). */
  accent: string;
  /** Portrait image under the app's base URL (the card thumbnail and the 2D stage fallback). */
  portrait: string;
}

export const CHARACTERS: readonly Character[] = [{ id: 'classic', accent: '#ffd43b', portrait: 'ui/duck-rifle.webp' }];

export const DEFAULT_CHARACTER: CharacterId = 'classic';

const KEY = 'qwakk.character';

export function characterById(id: string | null | undefined): Character | undefined {
  return CHARACTERS.find((c) => c.id === id);
}

/** The display name and line from copy.ts. */
export function characterCopy(id: CharacterId): { name: string; blurb: string } {
  return COPY.characters.list[id];
}

/** The remembered pick, or the default when there is none (or it left the catalog). */
export function loadCharacter(): CharacterId {
  try {
    return characterById(localStorage.getItem(KEY))?.id ?? DEFAULT_CHARACTER;
  } catch {
    return DEFAULT_CHARACTER;
  }
}

export function saveCharacter(id: CharacterId): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* storage blocked: the pick lasts for this page */
  }
}
