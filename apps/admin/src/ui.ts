/** Shared admin UI parts: cards, buttons, a toast, a confirm dialog and number formats. */
import { ApiError } from './api.ts';
import { COPY } from './copy.ts';
import { h, type Child } from './dom.ts';

export function card(title: string | null, ...children: Child[]): HTMLElement {
  return h('section', { class: 'card' }, title ? h('h2', { class: 'card-title' }, title) : null, ...children);
}

export function button(label: string, onClick: () => void, kind: 'primary' | 'ghost' | 'danger' = 'ghost', extra: Record<string, string> = {}): HTMLButtonElement {
  return h('button', { type: 'button', class: `btn btn-${kind}`, onclick: () => onClick(), ...extra }, label);
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return COPY.errors[err.code] ?? `${COPY.errors.generic} (${err.code})`;
  return COPY.errors.generic!;
}

let toastEl: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** A short message at the bottom of the screen. */
export function toast(text: string, bad = false): void {
  toastEl ??= document.body.appendChild(h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }));
  toastEl.textContent = text;
  toastEl.className = `toast is-on${bad ? ' is-bad' : ''}`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl?.classList.remove('is-on'), 3500);
}

/**
 * A modal confirm. Resolves true on Confirm. `fields` adds inputs (their
 * values come back in `values`); the dialog is a <dialog> so focus and Esc work.
 */
export function confirmDialog(message: string, opts: { danger?: boolean; confirmLabel?: string; fields?: HTMLElement[] } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const ok = h('button', { type: 'submit', class: `btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`, value: 'ok' }, opts.confirmLabel ?? COPY.confirm);
    const no = h('button', { type: 'button', class: 'btn btn-ghost' }, COPY.cancel);
    const form = h('form', { method: 'dialog', class: 'dialog-body' }, h('p', { class: 'dialog-text' }, message), ...(opts.fields ?? []), h('div', { class: 'dialog-actions' }, no, ok));
    const dlg = h('dialog', { class: 'dialog' }, form);
    let answer = false;
    no.addEventListener('click', () => dlg.close());
    form.addEventListener('submit', () => {
      answer = true;
    });
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(answer);
    });
    document.body.append(dlg);
    dlg.showModal();
    (opts.fields?.[0]?.querySelector('input, select, textarea') as HTMLElement | null)?.focus();
  });
}

export function labeled(label: string, control: HTMLElement): HTMLElement {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control);
}

export function duration(s: number): string {
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const hrs = Math.floor(m / 60);
  if (hrs < 48) return `${hrs} h ${m % 60} min`;
  return `${Math.floor(hrs / 24)} d ${hrs % 24} h`;
}

export function clock(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function when(v: string | number): string {
  const d = new Date(v);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function shortJson(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 140 ? `${s.slice(0, 137)}...` : s;
}

/** A page: its root element and how to stop it (timers) when the admin navigates away. */
export interface Page {
  el: HTMLElement;
  stop?(): void;
}
