import { describe, expect, it } from 'vitest';
import { matchPoints as server } from '../../../server/src/meta/score.ts';
import { matchPoints as client } from '../../src/ui/menu/score.ts';

describe('menu points', () => {
  it('match the server formula', () => {
    for (const mode of ['br', 'dm'] as const) {
      for (const field of [1, 2, 8, 16, 32]) {
        for (let place = 0; place <= field + 1; place++) {
          for (const kills of [-1, 0, 3, 20, 40]) expect(client(mode, place, field, kills), `${mode} ${place}/${field} ${kills}`).toBe(server(mode, place, field, kills));
        }
      }
    }
  });
});
