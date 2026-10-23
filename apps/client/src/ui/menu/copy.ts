import { locale } from '../../i18n/locale.ts';
import { EN } from './copy.en.ts';
import { TR } from './copy.tr.ts';
export const COPY = locale === 'tr' ? TR : EN;

/**
 * Links. The legal pages live on the game's own origin (/terms, /privacy,
 * /cookies; built from docs/legal by apps/client/build/legalPages.ts), under
 * the app's base URL (/game/ in dev and tests).
 */
export const LINKS = {
  home: 'https://qwakk.fun',
  terms: `${import.meta.env.BASE_URL}terms`,
  privacy: `${import.meta.env.BASE_URL}privacy`,
  cookies: `${import.meta.env.BASE_URL}cookies`,
} as const;
