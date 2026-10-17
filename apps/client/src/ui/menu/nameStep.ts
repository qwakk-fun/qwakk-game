/**
 * Step 1 of the join flow: the nickname field with the server-assigned #tag,
 * the hint or error line under it and the Turnstile slot (shown only when a new
 * guest needs the check). `commit()` validates the name and gets a session.
 */
import { ApiError } from './api.ts';
import { COPY } from './copy.ts';
import { h } from './dom.ts';
import { ensureSession, loadIdentity, NAME_RE, rememberName, suggestName } from './identity.ts';

const NO_TAG = '#----';

export class NameStep {
  readonly el: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly tagEl: HTMLElement;
  private readonly msg: HTMLElement;
  private readonly turnstileHost: HTMLElement;
  private readonly onChange: () => void;

  constructor(onChange: () => void) {
    this.onChange = onChange;
    const id = loadIdentity();
    this.input = h('input', {
      id: 'qm-name',
      class: 'qm-input qm-name-input',
      type: 'text',
      inputmode: 'text',
      autocomplete: 'nickname',
      autocapitalize: 'off',
      spellcheck: 'false',
      enterkeyhint: 'done',
      maxlength: 16,
      placeholder: COPY.namePlaceholder,
      'aria-label': COPY.steps.name,
      'aria-describedby': 'qm-name-msg',
    });
    this.input.value = id.name ?? suggestName();
    this.tagEl = h('span', { class: 'qm-tag', 'aria-label': COPY.aria.tag }, id.tag && id.name === this.input.value ? `#${id.tag}` : NO_TAG);
    this.msg = h('p', { id: 'qm-name-msg', class: 'qm-name-msg' }, COPY.nameHint);
    this.turnstileHost = h('div', { class: 'qm-turnstile', hidden: true });
    this.el = h('form', { class: 'qm-name', novalidate: true }, h('div', { class: 'qm-name-field' }, this.input, this.tagEl), this.msg, this.turnstileHost);
    this.el.addEventListener('submit', (e) => {
      e.preventDefault();
      this.input.blur(); // closes the phone keyboard
      this.commit().catch(() => {}); // the error is shown under the field
    });
    this.input.addEventListener('change', () => this.commit().catch(() => {}));
    this.input.addEventListener('input', () => {
      this.tagEl.textContent = NO_TAG;
      const v = this.input.value.trim();
      this.setMsg(NAME_RE.test(v) || this.input.value === '' ? COPY.nameHint : COPY.errors.name_format!, false);
      this.onChange();
    });
  }

  /** The typed name (trimmed). */
  get value(): string {
    return this.input.value.trim();
  }

  /** The tag on show ("#1234"), or null before the server gave one for this name. */
  get tag(): string | null {
    const t = this.tagEl.textContent ?? '';
    return t === NO_TAG ? null : t;
  }

  get valid(): boolean {
    return NAME_RE.test(this.value);
  }

  focus(): void {
    this.input.focus();
  }

  setDisabled(on: boolean): void {
    this.input.disabled = on;
  }

  /** Validate the name and get a session (and #tag) for it. Returns the session token, or null. */
  async commit(quiet = false): Promise<{ token: string } | null> {
    const name = this.value;
    if (!NAME_RE.test(name)) {
      if (!quiet) this.setMsg(COPY.errors.name_format!, true);
      return null;
    }
    rememberName(name);
    if (!quiet) this.setMsg(COPY.nameSaving, false);
    try {
      const s = await ensureSession(name, quiet ? undefined : this.turnstileHost);
      if (this.value === name) {
        this.tagEl.textContent = `#${s.tag}`;
        this.setMsg(quiet ? COPY.nameHint : COPY.nameSaved, false);
        this.onChange();
      }
      return { token: s.token };
    } catch (err) {
      if (!quiet) this.setMsg(errorText(err), true);
      else this.setMsg(COPY.nameHint, false);
      throw err;
    }
  }

  private setMsg(text: string, error: boolean): void {
    this.msg.textContent = text;
    this.msg.classList.toggle('is-error', error);
    this.input.setAttribute('aria-invalid', error ? 'true' : 'false');
  }
}

/** The menu's line for an API or session error. */
export function errorText(err: unknown): string {
  const code = err instanceof ApiError ? err.code : err instanceof Error ? err.message : 'generic';
  return COPY.errors[code] ?? COPY.errors.generic!;
}
