import { describe, expect, it } from 'vitest';
import { CHARACTERS, characterFromOption, characterIdOf, characterKey, DEFAULT_CHARACTER, HITBOX, isCharacterId, pickBotCharacter, rayHitbox } from '../src/index.ts';

describe('character catalog', () => {
  it('has the classic duck and the mallard, with unique small ids', () => {
    expect(CHARACTERS.map((c) => c.key)).toEqual(['classic', 'mallard']);
    expect(new Set(CHARACTERS.map((c) => c.id)).size).toBe(CHARACTERS.length);
    for (const c of CHARACTERS) {
      // uint8 on the wire
      expect(c.id).toBeGreaterThanOrEqual(0);
      expect(c.id).toBeLessThan(256);
    }
    expect(characterKey(DEFAULT_CHARACTER)).toBe('classic');
  });

  it('keeps a known join option and turns anything else into the classic duck', () => {
    expect(characterFromOption(1)).toBe(1);
    expect(characterFromOption(0)).toBe(0);
    for (const bad of [undefined, null, 2, -1, 0.5, '1', 'mallard', true, {}, [1], Number.NaN, Infinity]) {
      expect(isCharacterId(bad)).toBe(false);
      expect(characterFromOption(bad)).toBe(DEFAULT_CHARACTER);
    }
  });

  it('maps keys and ids both ways (unknown keys and ids are the classic duck)', () => {
    expect(characterIdOf('mallard')).toBe(1);
    expect(characterIdOf('classic')).toBe(0);
    expect(characterIdOf('robot')).toBe(0);
    expect(characterKey(1)).toBe('mallard');
    expect(characterKey(99)).toBe('classic');
  });

  it('gives bots the duck the room has fewest of', () => {
    expect(pickBotCharacter([0, 0, 1])).toBe(1);
    expect(pickBotCharacter([1, 1, 0])).toBe(0);
    // ties alternate with the salt
    expect(pickBotCharacter([], 0)).toBe(0);
    expect(pickBotCharacter([], 1)).toBe(1);
    expect(pickBotCharacter([0, 1], 3)).toBe(1);
    // unknown ids in the room are ignored
    expect(pickBotCharacter([7, 7, 0])).toBe(1);
    const room: number[] = [];
    for (let pid = 1; pid <= 24; pid++) room.push(pickBotCharacter(room, pid));
    expect(room.filter((c) => c === 0).length).toBe(12);
  });

  it('hitboxes are one table for every duck (the character is not an input)', () => {
    // rayHitbox reads a HitTarget (position and stance) only; no character field exists to change it.
    const target = { id: 'a', x: 0, y: 0, z: -10, crouch: 0 };
    const withCharacter = { ...target, character: 1 } as typeof target;
    const head = rayHitbox(0, HITBOX.stand.headY, 0, 0, 0, -1, target, 50);
    expect(head?.head).toBe(true);
    expect(rayHitbox(0, HITBOX.stand.headY, 0, 0, 0, -1, withCharacter, 50)).toEqual(head);
    expect(Object.keys(HITBOX)).toEqual(['stand', 'crouch']);
  });
});
