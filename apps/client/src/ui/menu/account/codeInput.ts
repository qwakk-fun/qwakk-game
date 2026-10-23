/**
 * The 6-digit code field: six boxes drawn over ONE real input, so typing
 * moves on by itself, Backspace goes back, a pasted code (or "123 456",
 * or the whole email line) fills every box, and phones offer the code from
 * the keyboard (`autocomplete="one-time-code"`, numeric keypad). Six digits
 * fire `onComplete` once.
 */
import { CODE_DIGITS } from '@qwakk/shared/accounts';
import { COPY } from '../copy.ts';
import { h } from '../dom.ts';

export class CodeInput {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly boxes: HTMLElement[] = [];
  private readonly onComplete: (code: string) => void;
  private fired = '';

  constructor(onComplete: (code: string) => void) {
    this.onComplete = onComplete;
    this.input = h('input', {
      class: 'qa-code-input',
      type: 'text',
      inputmode: 'numeric',
      autocomplete: 'one-time-code',
      pattern: '[0-9]*',
      maxlength: 32,
      enterkeyhint: 'done',
      spellcheck: 'false',
      autocapitalize: 'off',
      'aria-label': COPY.code.label,
      name: 'code',
    });
    const row = h('div', { class: 'qa-code-boxes', 'aria-hidden': 'true' });
    for (let i = 0; i < CODE_DIGITS; i++) {
      const box = h('span', { class: 'qa-code-box' });
      this.boxes.push(box);
      row.append(box);
    }
    this.el = h('div', { class: 'qa-code' }, row, this.input);
    this.input.addEventListener('input', () => this.sync());
    this.input.addEventListener('focus', () => this.sync());
    this.input.addEventListener('blur', () => this.el.classList.remove('is-focus'));
    // Keep the caret at the end: the boxes always fill from the left.
    this.input.addEventListener('select', () => {
      const n = this.input.value.length;
      if (this.input.selectionStart !== n) this.input.setSelectionRange(n, n);
    });
  }

  get value(): string {
    return this.input.value;
  }

  focus(): void {
    this.input.focus({ preventScroll: true });
  }

  clear(): void {
    this.input.value = '';
    this.fired = '';
    this.sync();
  }

  setDisabled(on: boolean): void {
    this.input.disabled = on;
    this.el.classList.toggle('is-disabled', on);
  }

  setError(on: boolean): void {
    this.el.classList.toggle('is-error', on);
    this.input.setAttribute('aria-invalid', on ? 'true' : 'false');
  }

  private sync(): void {
    const digits = this.input.value.replace(/\D/g, '').slice(0, CODE_DIGITS);
    if (digits !== this.input.value) this.input.value = digits;
    const focused = document.activeElement === this.input;
    this.el.classList.toggle('is-focus', focused);
    this.boxes.forEach((b, i) => {
      b.textContent = digits[i] ?? '';
      b.classList.toggle('is-filled', i < digits.length);
      b.classList.toggle('is-current', focused && i === Math.min(digits.length, CODE_DIGITS - 1));
    });
    if (digits.length < CODE_DIGITS) {
      this.fired = '';
      this.setError(false);
    } else if (digits !== this.fired) {
      this.fired = digits;
      this.onComplete(digits);
    }
  }
}
