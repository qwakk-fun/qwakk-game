import { describe, expect, it } from 'vitest';
import { suggestName, NAME_RE } from '../../src/ui/menu/identity.ts';
import { directStart } from '../../src/ui/menu/index.ts';

describe('menu entry', () => {
  it('skips the menu only in dev builds with ?mode= or a dev tool', () => {
    expect(directStart(false, '?mode=br')).toBeNull();
    expect(directStart(true, '')).toBeNull();
    expect(directStart(true, '?lat=120')).toBeNull();
    expect(directStart(true, '?mode=br')?.mode).toBe('br');
    expect(directStart(true, '?autopilot=fight')?.mode).toBe('dm');
    expect(directStart(true, '?spectate=1&name=Cam')).toMatchObject({ mode: 'dm', name: 'Cam' });
  });

  it('suggests valid starter names', () => {
    for (let i = 0; i < 50; i++) expect(suggestName()).toMatch(NAME_RE);
    expect(suggestName(() => 0)).toBe('SoggyMallard');
  });
});
