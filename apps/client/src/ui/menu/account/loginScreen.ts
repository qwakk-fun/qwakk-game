/**
 * The sign-in screen: email, then the 6-digit code, then (a new address
 * only) the sign-up step with the required terms and 16+ box and the
 * optional news box; also the "updated terms" step for a signed-in player
 * on an older legal version. "Play as guest" (Deathmatch only) and the
 * QoreX button (disabled until wallet sign-in ships) sit under the form.
 *
 * QoreX plug-in point: the `.qa-qorex` button in showEmail() is the slot. When wallet sign-in
 * ships, enable it and have it run the wallet's proof and call a new
 * `/api/auth/qorex/verify` route that answers like `/api/auth/verify` (signed
 * in, or a sign-up ticket), then go through `afterVerify()` like the email path
 * (docs/accounts.md).
 */
import { CODE_RESEND_MS, LEGAL_VERSION, normalizeEmail, type SignedIn, type VerifyResult } from '@qwakk/shared/accounts';
import { ApiError } from '../api.ts';
import { COPY, LINKS } from '../copy.ts';
import { asset, h } from '../dom.ts';
import { icon } from '../icons.ts';
import { errorText } from '../nameStep.ts';
import { getTurnstileToken, turnstileEnabled } from '../turnstile.ts';
import { acceptLegal, requestCode, signup, verifyCode } from './accountApi.ts';
import { CodeInput } from './codeInput.ts';
import type { AccountSession } from './session.ts';

const A = COPY.auth;
const C = COPY.code;
const S = COPY.signup;

export interface LoginHooks {
  /** Signed in (a known address, or a new account). `claimed`: the guest duck that came along. */
  signedIn(s: SignedIn): void;
  /** "Play as guest". */
  guest(): void;
  /** Back to the menu (shown when the menu sent the player here, for example the Battle Royale lock). */
  back(): void;
  /** The legal update was accepted (or declined: then the account tab opens). */
  legalDone(accepted: boolean): void;
  /** This device's guest duck, which would come along at sign-up. */
  guestCarry(): { deviceToken: string; name: string; tag: string; look: number } | null;
}

type Step = 'email' | 'code' | 'signup' | 'legal';

/** The consent line: text, a link, text, a link, text (copy.ts). */
function consentLine(parts: readonly string[]): HTMLElement {
  const link = (text: string, href: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
  return h('span', {}, parts[0] ?? '', link(parts[1] ?? '', LINKS.terms), parts[2] ?? '', link(parts[3] ?? '', LINKS.privacy), parts[4] ?? '');
}

export class LoginScreen {
  readonly el: HTMLElement;
  private readonly hooks: LoginHooks;
  private readonly body: HTMLElement;
  private readonly backBtn: HTMLButtonElement;
  private step: Step = 'email';
  private email = '';
  private signupToken = '';
  private resendAt = 0;
  private timer = 0;
  private busy = false;
  private legalSession: AccountSession | null = null;

  constructor(hooks: LoginHooks) {
    this.hooks = hooks;
    this.body = h('div', { class: 'qa-auth-body' });
    this.backBtn = h('button', { type: 'button', class: 'qm-btn qm-btn-quiet qm-btn-sm qa-auth-back', hidden: true }, h('span', { 'aria-hidden': 'true' }, '←'), A.back);
    this.backBtn.addEventListener('click', () => this.hooks.back());
    this.el = h(
      'section',
      { class: 'qa-auth', 'aria-labelledby': 'qa-auth-title' },
      h(
        'div',
        { class: 'qm-card qa-auth-card' },
        h('div', { class: 'qa-auth-top' }, h('span', { class: 'qa-auth-brand' }, h('img', { src: asset('ui/brand-mark.svg'), alt: '', width: 40, height: 40 }), h('span', {}, 'Qwakk')), this.backBtn),
        this.body,
      ),
      h('div', { class: 'qa-auth-art', 'aria-hidden': 'true' }, h('img', { src: asset('ui/duck-rifle.webp'), alt: '', width: 520, height: 520, decoding: 'async' })),
    );
  }

  /** Show the screen at the email step. `canGoBack`: the menu is behind it (guest mode). */
  open(opts: { canGoBack?: boolean; message?: string; error?: boolean } = {}): void {
    this.backBtn.hidden = !opts.canGoBack;
    this.showEmail(opts.message, opts.error);
  }

  /** The "updated terms" step for a signed-in account on an older legal version. */
  openLegal(session: AccountSession): void {
    this.legalSession = session;
    this.backBtn.hidden = true;
    this.showLegal();
  }

  /** Does this account need to accept the current terms first? */
  static needsLegal(session: AccountSession): boolean {
    return !!session.account && session.account.legalVersion !== LEGAL_VERSION;
  }

  close(): void {
    clearInterval(this.timer);
  }

  private set(step: Step, ...children: (Node | null)[]): void {
    this.step = step;
    this.el.dataset.step = step;
    this.body.replaceChildren(...children.filter((c): c is Node => c !== null));
  }

  private msgLine(): HTMLElement {
    return h('p', { class: 'qa-msg', role: 'status', 'aria-live': 'polite' });
  }

  private say(el: HTMLElement, text: string, error = false): void {
    el.textContent = text;
    el.classList.toggle('is-error', error);
  }

  private spin(el: HTMLElement, text: string): void {
    el.classList.remove('is-error');
    el.replaceChildren(h('span', { class: 'qm-spin', 'aria-hidden': 'true' }), h('span', {}, text));
  }

  // ---- email --------------------------------------------------------------

  private showEmail(message?: string, error = true): void {
    clearInterval(this.timer);
    const input = h('input', {
      id: 'qa-email',
      class: 'qm-input',
      type: 'email',
      inputmode: 'email',
      autocomplete: 'email',
      autocapitalize: 'off',
      spellcheck: 'false',
      enterkeyhint: 'send',
      maxlength: 254,
      required: true,
      placeholder: A.emailPlaceholder,
      'aria-describedby': 'qa-email-hint',
    });
    input.value = this.email;
    const msg = this.msgLine();
    if (message) this.say(msg, message, error);
    const turnstileHost = h('div', { class: 'qm-turnstile', hidden: true });
    const send = h('button', { type: 'submit', class: 'qm-btn qm-btn-yellow qa-wide qa-send' }, icon('mail'), A.send);
    const form = h(
      'form',
      { class: 'qa-form', novalidate: true },
      h('label', { class: 'qa-label', for: 'qa-email' }, A.emailLabel),
      input,
      h('p', { id: 'qa-email-hint', class: 'qm-fine' }, A.emailHint),
      turnstileHost,
      send,
      msg,
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.sendCode(input, msg, send, turnstileHost);
    });
    const qorex = h('button', { type: 'button', class: 'qm-btn qm-btn-ghost qa-wide qa-qorex', disabled: true, 'aria-describedby': 'qa-qorex-note' }, icon('wallet'), A.qorex);
    const guest = h('button', { type: 'button', class: 'qm-link qa-guest' }, A.guest);
    guest.addEventListener('click', () => this.hooks.guest());
    this.set(
      'email',
      h('h1', { id: 'qa-auth-title', class: 'qa-title' }, A.title),
      h('p', { class: 'qa-sub' }, A.sub),
      form,
      h('div', { class: 'qa-or' }, h('span', {}, A.or)),
      qorex,
      h('p', { id: 'qa-qorex-note', class: 'qm-fine qa-center' }, A.qorexNote),
      h('div', { class: 'qa-guest-row' }, guest, h('p', { class: 'qm-fine' }, A.guestNote)),
    );
    if (!matchMedia('(pointer: coarse)').matches) input.focus({ preventScroll: true });
  }

  private async sendCode(input: HTMLInputElement, msg: HTMLElement, btn: HTMLButtonElement, turnstileHost: HTMLElement): Promise<void> {
    if (this.busy) return;
    const email = normalizeEmail(input.value);
    if (!email) {
      this.say(msg, COPY.errors.email_invalid!, true);
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    input.setAttribute('aria-invalid', 'false');
    this.busy = true;
    btn.disabled = true;
    input.blur(); // closes the phone keyboard
    this.spin(msg, A.sending);
    try {
      const check = turnstileEnabled() ? await getTurnstileToken(turnstileHost) : undefined;
      await requestCode(email, check);
      this.email = email;
      this.resendAt = Date.now() + CODE_RESEND_MS;
      this.showCode();
    } catch (err) {
      this.say(msg, errorText(err), true);
    } finally {
      this.busy = false;
      btn.disabled = false;
    }
  }

  // ---- code ---------------------------------------------------------------

  private showCode(notice?: string): void {
    const msg = this.msgLine();
    if (notice) this.say(msg, notice);
    const submit = h('button', { type: 'submit', class: 'qm-btn qm-btn-yellow qa-wide', disabled: true }, C.submit);
    const code: CodeInput = new CodeInput((value) => void this.verify(value, code, msg, submit));
    code.input.addEventListener('input', () => (submit.disabled = code.value.length < 6));
    const turnstileHost = h('div', { class: 'qm-turnstile', hidden: true });
    const form = h('form', { class: 'qa-form', novalidate: true }, h('label', { class: 'qa-label', for: 'qa-code' }, C.label), code.el, submit, turnstileHost, msg);
    code.input.id = 'qa-code';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (code.value.length === 6) void this.verify(code.value, code, msg, submit);
      else this.say(msg, COPY.errors.code_format!, true);
    });
    const resend = h('button', { type: 'button', class: 'qm-link qa-resend' }, C.resend);
    const change = h('button', { type: 'button', class: 'qm-link' }, C.changeEmail);
    change.addEventListener('click', () => this.showEmail());
    resend.addEventListener('click', () => void this.resend(resend, msg, code, turnstileHost));
    this.set(
      'code',
      h('h1', { id: 'qa-auth-title', class: 'qa-title' }, C.title),
      h('p', { class: 'qa-sub' }, C.sub(this.email)),
      form,
      h('p', { class: 'qm-fine' }, C.spam),
      h('div', { class: 'qa-links' }, resend, change),
    );
    this.tickResend(resend);
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tickResend(resend), 1000);
    code.focus();
  }

  private tickResend(btn: HTMLButtonElement): void {
    const left = Math.ceil((this.resendAt - Date.now()) / 1000);
    btn.disabled = left > 0 || this.busy;
    btn.textContent = left > 0 ? C.resendIn(left) : C.resend;
  }

  private async resend(btn: HTMLButtonElement, msg: HTMLElement, code: CodeInput, turnstileHost: HTMLElement): Promise<void> {
    if (this.busy || Date.now() < this.resendAt) return;
    this.busy = true;
    btn.disabled = true;
    this.spin(msg, A.sending);
    try {
      const check = turnstileEnabled() ? await getTurnstileToken(turnstileHost) : undefined;
      await requestCode(this.email, check);
      this.resendAt = Date.now() + CODE_RESEND_MS;
      code.clear();
      this.say(msg, C.resent);
    } catch (err) {
      this.say(msg, errorText(err), true);
    } finally {
      this.busy = false;
      this.tickResend(btn);
    }
  }

  private async verify(value: string, code: CodeInput, msg: HTMLElement, submit: HTMLButtonElement): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    code.setDisabled(true);
    submit.disabled = true;
    this.spin(msg, C.checking);
    let r: VerifyResult;
    try {
      r = await verifyCode(this.email, value);
    } catch (err) {
      this.busy = false;
      code.setDisabled(false);
      code.setError(true);
      const left = err instanceof ApiError && err.code === 'code_wrong' && typeof err.body.left === 'number' ? err.body.left : null;
      this.say(msg, left !== null ? C.wrongLeft(left) : errorText(err), true);
      if (err instanceof ApiError && (err.code === 'code_locked' || err.code === 'code_expired')) code.clear();
      code.focus();
      submit.disabled = code.value.length < 6;
      return;
    }
    this.busy = false;
    this.afterVerify(r);
  }

  /** A proven sign-in (the email code now; the QoreX wallet proof later): signed in, or the sign-up step. */
  private afterVerify(r: VerifyResult): void {
    clearInterval(this.timer);
    if (r.status === 'signed_in') return this.hooks.signedIn(r);
    this.signupToken = r.signupToken;
    this.showSignup();
  }

  // ---- sign-up ------------------------------------------------------------

  private showSignup(): void {
    clearInterval(this.timer);
    const consent = h('input', { type: 'checkbox', id: 'qa-consent', required: true });
    const news = h('input', { type: 'checkbox', id: 'qa-news' });
    const msg = this.msgLine();
    const submit = h('button', { type: 'submit', class: 'qm-btn qm-btn-yellow qa-wide' }, S.submit);
    const carry = this.hooks.guestCarry();
    const form = h(
      'form',
      { class: 'qa-form', novalidate: true },
      h('label', { class: 'qa-check is-required', for: 'qa-consent' }, consent, h('span', { class: 'qa-box', 'aria-hidden': 'true' }, icon('check')), consentLine(S.consent)),
      h('label', { class: 'qa-check', for: 'qa-news' }, news, h('span', { class: 'qa-box', 'aria-hidden': 'true' }, icon('check')), h('span', {}, S.marketing)),
      carry ? h('p', { class: 'qa-carry' }, icon('swap'), h('span', {}, S.guestCarry(`${carry.name}#${carry.tag}`))) : null,
      submit,
      msg,
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.createAccount(consent, news, submit, msg);
    });
    this.set('signup', h('h1', { id: 'qa-auth-title', class: 'qa-title' }, S.title), h('p', { class: 'qa-sub' }, S.sub), form);
  }

  private async createAccount(consent: HTMLInputElement, news: HTMLInputElement, submit: HTMLButtonElement, msg: HTMLElement): Promise<void> {
    if (this.busy) return;
    if (!consent.checked) {
      this.say(msg, COPY.errors.consent_required!, true);
      consent.focus();
      return;
    }
    this.busy = true;
    submit.disabled = true;
    this.spin(msg, COPY.create.hatching);
    try {
      const carry = this.hooks.guestCarry();
      const s = await signup(this.signupToken, news.checked, carry ? { deviceToken: carry.deviceToken, look: carry.look } : undefined);
      this.hooks.signedIn(s);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'signup_expired') return this.showEmail(errorText(err));
      this.say(msg, errorText(err), true);
    } finally {
      this.busy = false;
      submit.disabled = false;
    }
  }

  // ---- updated terms ------------------------------------------------------

  private showLegal(): void {
    const L = COPY.legalUpdate;
    const consent = h('input', { type: 'checkbox', id: 'qa-legal' });
    const msg = this.msgLine();
    const submit = h('button', { type: 'submit', class: 'qm-btn qm-btn-yellow qa-wide' }, L.submit);
    const decline = h('button', { type: 'button', class: 'qm-link' }, L.decline);
    decline.addEventListener('click', () => this.hooks.legalDone(false));
    const form = h(
      'form',
      { class: 'qa-form', novalidate: true },
      h('label', { class: 'qa-check is-required', for: 'qa-legal' }, consent, h('span', { class: 'qa-box', 'aria-hidden': 'true' }, icon('check')), consentLine(L.consent)),
      submit,
      msg,
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void (async () => {
        const session = this.legalSession;
        if (!consent.checked) return this.say(msg, COPY.errors.consent_required!, true);
        if (!session?.token || this.busy) return;
        this.busy = true;
        submit.disabled = true;
        try {
          session.update((await acceptLegal(session.token)).account);
          this.hooks.legalDone(true);
        } catch (err) {
          this.say(msg, errorText(err), true);
        } finally {
          this.busy = false;
          submit.disabled = false;
        }
      })();
    });
    this.set('legal', h('h1', { id: 'qa-auth-title', class: 'qa-title' }, L.title), h('p', { class: 'qa-sub' }, L.sub), form, h('div', { class: 'qa-links' }, decline));
  }

  /** The step on show (tests and the menu). */
  get current(): Step {
    return this.step;
  }
}
