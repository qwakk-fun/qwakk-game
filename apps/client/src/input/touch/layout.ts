/**
 * The touch layer's DOM: the stick (base and knob), the thumb buttons around
 * the right-hand Fire, a second Fire on the left, the contextual Use and
 * Jump out buttons, heals, spectate arrows and the small top row (pause,
 * scores, map, bag). Positions and sizes live in touch.css; what each button
 * does lives in touchControls.ts.
 */
import { COPY } from '../../ui/menu/copy.ts';
import './touch.css';

const B = COPY.touch.buttons;

/** Every button id the layer knows. */
export type ButtonId = 'fire' | 'fireL' | 'aim' | 'jump' | 'crouch' | 'reload' | 'swap' | 'use' | 'deploy' | 'heal1' | 'heal2' | 'pause' | 'board' | 'map' | 'bag' | 'next' | 'prev' | 'grenade' | 'rocket' | 'dash' | 'quack' | 'storm';

const SPECS: { id: ButtonId; label: string; cls: string }[] = [
  { id: 'fire', label: B.fire, cls: 'tc-btn tc-fire' },
  { id: 'fireL', label: B.fire, cls: 'tc-btn tc-fire tc-fire-l' },
  { id: 'aim', label: B.aim, cls: 'tc-btn tc-aim' },
  { id: 'jump', label: B.jump, cls: 'tc-btn tc-jump' },
  { id: 'crouch', label: B.crouch, cls: 'tc-btn tc-crouch' },
  { id: 'reload', label: B.reload, cls: 'tc-btn tc-reload' },
  { id: 'swap', label: B.swap, cls: 'tc-btn tc-swap' },
  { id: 'use', label: B.use, cls: 'tc-btn tc-use' },
  { id: 'deploy', label: B.deploy, cls: 'tc-btn tc-deploy' },
  { id: 'heal1', label: B.bandage, cls: 'tc-btn tc-heal tc-heal1' },
  { id: 'heal2', label: B.medkit, cls: 'tc-btn tc-heal tc-heal2' },
  { id: 'prev', label: B.prev, cls: 'tc-btn tc-spec tc-prev' },
  { id: 'next', label: B.next, cls: 'tc-btn tc-spec tc-next' },
  // Deathmatch explosives: hold to aim the throw, let go to throw; the launcher slot while rockets last.
  { id: 'grenade', label: B.grenade, cls: 'tc-btn tc-grenade' },
  { id: 'rocket', label: B.rocket, cls: 'tc-btn tc-rocket' },
  // Hunt Season katana skills (tap): Dash, the "VAK!" shockwave, the Blade Storm. Cooldowns sweep over them (--cd).
  { id: 'dash', label: B.dash, cls: 'tc-btn tc-skill tc-dash' },
  { id: 'quack', label: B.quack, cls: 'tc-btn tc-skill tc-quack' },
  { id: 'storm', label: B.storm, cls: 'tc-btn tc-skill tc-storm' },
];

const TOP: { id: ButtonId; label: string }[] = [
  { id: 'pause', label: B.pause },
  { id: 'board', label: B.board },
  { id: 'map', label: B.map },
  { id: 'bag', label: B.bag },
];

export interface TouchLayout {
  root: HTMLElement;
  base: HTMLElement;
  knob: HTMLElement;
  buttons: Map<ButtonId, HTMLButtonElement>;
  /** A small count badge on the heal buttons and the weapon name on Swap. */
  badges: Map<ButtonId, HTMLElement>;
}

function button(id: ButtonId, label: string, cls: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.dataset.b = id;
  b.tabIndex = -1;
  b.setAttribute('aria-label', label);
  const t = document.createElement('span');
  t.className = 'tc-label';
  t.textContent = label;
  b.append(t);
  return b;
}

export function buildLayout(parent: HTMLElement): TouchLayout {
  const root = document.createElement('div');
  root.className = 'tc';
  root.hidden = true;
  const base = document.createElement('div');
  base.className = 'tc-stick';
  const knob = document.createElement('div');
  knob.className = 'tc-knob';
  base.append(knob);
  root.append(base);
  const buttons = new Map<ButtonId, HTMLButtonElement>();
  const badges = new Map<ButtonId, HTMLElement>();
  for (const s of SPECS) {
    const b = button(s.id, s.label, s.cls);
    buttons.set(s.id, b);
    root.append(b);
  }
  const top = document.createElement('div');
  top.className = 'tc-top';
  for (const s of TOP) {
    const b = button(s.id, s.label, `tc-btn tc-small tc-${s.id}`);
    buttons.set(s.id, b);
    top.append(b);
  }
  root.append(top);
  for (const id of ['heal1', 'heal2', 'swap', 'grenade', 'rocket'] as const) {
    const badge = document.createElement('span');
    badge.className = 'tc-badge';
    buttons.get(id)!.append(badge);
    badges.set(id, badge);
  }
  parent.append(root);
  return { root, base, knob, buttons, badges };
}
