/**
 * A small modal for the menu's confirmations (delete a duck, delete the
 * account): a dimmed backdrop, a card with a title, text and its own
 * content, Escape or the backdrop closes it, focus moves in and comes back.
 */
import { h } from '../dom.ts';

export interface Dialog {
  el: HTMLElement;
  close(): void;
}

let open: Dialog | null = null;

export function openDialog(opts: { title: string; body: (Node | string)[]; content: HTMLElement; danger?: boolean; onClose?: () => void }): Dialog {
  open?.close();
  const before = document.activeElement as HTMLElement | null;
  const title = h('h2', { class: 'qa-dialog-title', id: 'qa-dialog-title' }, opts.title);
  const card = h('div', { class: `qm-card qa-dialog-card${opts.danger ? ' is-danger' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'qa-dialog-title' }, title, ...opts.body.map((b) => (typeof b === 'string' ? h('p', { class: 'qa-dialog-text' }, b) : b)), opts.content);
  const el = h('div', { class: 'qa-dialog' }, card);
  const host = document.getElementById('menu') ?? document.body;
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      d.close();
    }
  };
  const d: Dialog = {
    el,
    close() {
      if (!el.isConnected) return;
      el.remove();
      document.removeEventListener('keydown', onKey, true);
      if (open === d) open = null;
      before?.focus?.({ preventScroll: true });
      opts.onClose?.();
    },
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.target === el) d.close();
  });
  document.addEventListener('keydown', onKey, true);
  host.append(el);
  open = d;
  requestAnimationFrame(() => (card.querySelector<HTMLElement>('input, button:not([disabled])') ?? card).focus({ preventScroll: true }));
  return d;
}
