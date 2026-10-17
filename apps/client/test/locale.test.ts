import { describe, expect, it, vi } from 'vitest';
import { chooseLocale } from '../src/i18n/locale.ts';
import { EN } from '../src/ui/menu/copy.en.ts';
import { TR } from '../src/ui/menu/copy.tr.ts';

function leaves(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => leaves(v, `${prefix}.${k}`)).sort();
}
describe('languages', () => {
  it('prefers a saved language, detects Turkish and falls back safely', () => {
    expect(chooseLocale('en', 'tr-TR')).toBe('en');
    expect(chooseLocale('tr', 'en-US')).toBe('tr');
    expect(chooseLocale(null, 'tr-TR')).toBe('tr');
    expect(chooseLocale('invalid', 'de-DE')).toBe('en');
  });
  it('has every menu key in both languages', () => expect(leaves(TR)).toEqual(leaves(EN)));
  it('formats Turkish prompts without translating inserted player names', async () => {
    vi.resetModules();
    vi.doMock('../src/i18n/locale.ts', () => ({ isTurkish: true }));
    const { t } = await import('../src/i18n/game.ts');
    expect(t('Watching {name}', { name: 'Rifle' })).toBe('Rifle izleniyor');
    expect(t('Waiting for {n} more', { n: 2 })).toBe('2 oyuncu bekleniyor');
    expect(t('Rifle')).toBe('Tüfek');
    vi.doUnmock('../src/i18n/locale.ts');
  });
});
