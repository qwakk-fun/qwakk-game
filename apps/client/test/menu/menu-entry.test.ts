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

  it('passes the picked duck: ?character= in dev, else the remembered pick (classic without storage)', () => {
    expect(directStart(true, '?mode=dm&character=mallard')?.character).toBe(1);
    expect(directStart(true, '?mode=dm&character=robot')?.character).toBe(0);
    expect(directStart(true, '?mode=dm')?.character).toBe(0);
  });

  it('suggests valid starter names', () => {
    for (let i = 0; i < 50; i++) expect(suggestName()).toMatch(NAME_RE);
    expect(suggestName(() => 0)).toBe('SoggyMallard');
  });
});
