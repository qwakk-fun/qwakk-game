/** Language is local to this browser. Switching in the menu reloads the UI safely. */
export type Locale = 'en' | 'tr';
export const LOCALE_KEY = 'qwakk.language';
export function chooseLocale(saved: unknown, browser = 'en'): Locale {
  if (saved === 'en' || saved === 'tr') return saved;
  return browser.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}
function initial(): Locale {
  let saved: string | null = null;
  try { saved = localStorage.getItem(LOCALE_KEY); } catch { /* Storage may be disabled. */ }
  if (typeof location !== 'undefined') {
    const requested = new URLSearchParams(location.search).get('lang');
    if (requested === 'en' || requested === 'tr') {
      try { localStorage.setItem(LOCALE_KEY, requested); } catch { /* optional */ }
      return requested;
    }
  }
  return chooseLocale(saved, typeof navigator === 'undefined' ? 'en' : navigator.language);
}
export const locale = initial();
export const isTurkish = locale === 'tr';
export function changeLocale(value: Locale): void {
  try { localStorage.setItem(LOCALE_KEY, value); } catch { /* The query keeps this selection even without storage. */ }
  const url = new URL(location.href);
  url.searchParams.set('lang', value);
  location.assign(url.href);
}
