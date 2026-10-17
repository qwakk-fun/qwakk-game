import { afterEach, describe, expect, it } from 'vitest';
import { CHARACTERS, characterCopy, DEFAULT_CHARACTER, loadCharacter, saveCharacter } from '../../src/ui/menu/characters.ts';
import { COPY } from '../../src/ui/menu/copy.ts';

const g = globalThis as { localStorage?: Storage };

afterEach(() => {
  delete g.localStorage;
});

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, String(v)) } as Storage;
}

describe('character catalog', () => {
  it('has unique ids, copy for every duck and the default in it', () => {
    const ids = CHARACTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_CHARACTER);
    for (const c of CHARACTERS) {
      expect(characterCopy(c.id).name.length).toBeGreaterThan(0);
      expect(c.accent).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(Object.keys(COPY.characters.list).sort()).toEqual([...ids].sort());
  });

  it('remembers the pick and falls back to the default', () => {
    expect(loadCharacter()).toBe(DEFAULT_CHARACTER); // no storage at all
    g.localStorage = memoryStorage();
    expect(loadCharacter()).toBe(DEFAULT_CHARACTER);
    saveCharacter(CHARACTERS[0]!.id);
    expect(loadCharacter()).toBe(CHARACTERS[0]!.id);
    g.localStorage.setItem('qwakk.character', 'gone-duck');
    expect(loadCharacter()).toBe(DEFAULT_CHARACTER);
  });
});
