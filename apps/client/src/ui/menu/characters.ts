/**
 * The duck catalog for the character step: the menu's side of the shared
 * catalog (`@qwakk/shared/characters`, numeric ids the server checks). A new
 * duck is a new entry there and here, its name and line in copy.ts
 * (`COPY.characters.list`), its model (`models/duck_<id>.glb`) and portrait.
 *
 * The pick is remembered in this browser (localStorage `qwakk.character`) and
 * sent as the `character` join option (`gameId`); the server keeps it only
 * when it is in the catalog and shows it to everyone (looks only: every duck
 * has the same hitboxes, weapons and moves).
 */
import { characterIdOf, characterKey } from '@qwakk/shared/characters';
import { COPY } from './copy.ts';

export type CharacterId = keyof typeof COPY.characters.list;

export interface Character {
  id: CharacterId;
  /** The card's accent (ring, glow, name plate). */
  accent: string;
  /** Portrait image under the app's base URL (the card thumbnail and the 2D stage fallback). */
  portrait: string;
}

export const CHARACTERS: readonly Character[] = [
  { id: 'classic', accent: '#ffd43b', portrait: 'ui/duck-rifle.webp' },
  { id: 'mallard', accent: '#3fbf7f', portrait: 'ui/duck-mallard-rifle.webp' },
];

export const DEFAULT_CHARACTER: CharacterId = 'classic';

const KEY = 'qwakk.character';

export function characterById(id: string | null | undefined): Character | undefined {
  return CHARACTERS.find((c) => c.id === id);
}

/** The numeric id the game and the server use (the `character` join option). */
export function gameId(id: CharacterId): number {
  return characterIdOf(id);
}

/** The menu entry for a shared catalog id (an account duck's stored look); unknown ids are the classic duck. */
export function characterOfLook(look: number): Character {
  return characterById(characterKey(look)) ?? CHARACTERS[0]!;
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
