import { describe, expect, it } from 'vitest';
import { kdRatio, matchPoints } from '../../src/meta/score.ts';

describe('score formula', () => {
  it('winner of a 32-duck royale with 6 kills gets 160', () => {
    expect(matchPoints('br', 1, 32, 6)).toBe(160);
  });
  it('last place with no kills gets 0, the middle about half the placement points', () => {
    expect(matchPoints('br', 32, 32, 0)).toBe(0);
    expect(matchPoints('br', 16, 31, 0)).toBe(25);
  });
  it('caps kills at 20 per match', () => {
    expect(matchPoints('br', 2, 2, 50)).toBe(200);
  });
  it('weights deathmatch at half', () => {
    expect(matchPoints('dm', 1, 8, 25)).toBe(150);
  });
  it('clamps silly input', () => {
    expect(matchPoints('br', 0, 1, -3)).toBe(100);
    expect(matchPoints('br', 99, 8, 0)).toBe(0);
  });
  it('K/D floors deaths at 1', () => {
    expect(kdRatio(5, 0)).toBe(5);
    expect(kdRatio(7, 3)).toBe(2.33);
  });
});
