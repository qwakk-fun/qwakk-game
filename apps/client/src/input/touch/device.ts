/**
 * What kind of device this is, for the menu, the settings defaults and the
 * game. No game imports: the menu loads this before the game bundle.
 */

function media(q: string): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia(q).matches;
  } catch {
    return false;
  }
}

/** The screen takes touch at all (phones, tablets, touch laptops). */
export function hasTouch(): boolean {
  if (typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0) return true;
  return media('(any-pointer: coarse)');
}

/** Touch is the only way in: no mouse or trackpad (phones, most tablets). */
export function isTouchOnly(): boolean {
  return hasTouch() && !media('(any-pointer: fine)');
}

/** The main pointer is a finger: lower graphics defaults (phones and tablets). */
export function coarsePointer(): boolean {
  return media('(pointer: coarse)');
}
