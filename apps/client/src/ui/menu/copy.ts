import { locale } from '../../i18n/locale.ts';
import { EN } from './copy.en.ts';
import { TR } from './copy.tr.ts';
export const COPY = locale === 'tr' ? TR : EN;

/** Absolute links (the game is served under qwakk.fun/game). */
export const LINKS = {
  home: 'https://qwakk.fun',
  terms: 'https://qwakk.fun/terms',
  privacy: 'https://qwakk.fun/privacy',
} as const;
