/**
 * Whether the touch controls are on right now, for HUD text that names a key
 * on desktop ("E", "Esc") and a button on touch. Set by TouchControls; the
 * body gets the `touch-ui` class for the compact HUD layout.
 */
import { COPY } from '../../ui/menu/copy.ts';

let on = false;

export function touchUiOn(): boolean {
  return on;
}

export function setTouchUi(v: boolean): void {
  on = v;
  document.body.classList.toggle('touch-ui', v);
}

/** The label of a prompt key: the keyboard key on desktop, the button's name on touch. */
export function keyLabel(key: string): string {
  return on ? (COPY.touch.keys[key] ?? key) : key;
}

/** Desktop text, or its touch version while the touch controls are on. */
export function hint(desktop: string, touch: string): string {
  return on ? touch : desktop;
}
