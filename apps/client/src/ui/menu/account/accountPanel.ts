/**
 * The Account tab. Signed in: the email, the news opt-in switch (each change
 * is logged on the server with the wording version), how to get a copy of
 * your data, the legal pages, switch duck, log out and the danger zone
 * (delete the account: a code by email, then type DELETE), and the Duck
 * Pass card (link a QoreX wallet, duckPassCard.ts). A guest sees
 * why to sign in and the button for it.
 */
import { CODE_DIGITS } from '@qwakk/shared/accounts';
import { locale } from '../../../i18n/locale.ts';
import { ApiError } from '../api.ts';
import { COPY, LINKS } from '../copy.ts';
import { h } from '../dom.ts';
import { icon } from '../icons.ts';
import { errorText } from '../nameStep.ts';
import { deleteAccount, requestDeleteCode, setMarketing } from './accountApi.ts';
import { CodeInput } from './codeInput.ts';
import { openDialog } from './dialog.ts';
import { DuckPassCard } from './duckPassCard.ts';
import type { AccountSession } from './session.ts';

const AC = COPY.account;
const X = COPY.deleteAccount;

export interface AccountPanelHooks {
  signIn(): void;
  switchDuck(): void;
  logout(): void;
  /** The account was deleted: back to sign-in with a goodbye. */
  deleted(): void;
  expired(): void;
  /** Is a match running for this account right now (deleting waits)? */
  inMatch(): boolean;
}

export class AccountPanel {
  readonly el: HTMLElement;
  private readonly session: AccountSession;
  private readonly hooks: AccountPanelHooks;
  /** Duck Pass: link a QoreX wallet with one post-quantum proof on the testnet. */
  private readonly duckPass: DuckPassCard;

  constructor(session: AccountSession, hooks: AccountPanelHooks) {
    this.session = session;
    this.hooks = hooks;
    this.el = h('div', { class: 'qm-account' });
    this.duckPass = new DuckPassCard(session, () => hooks.expired());
  }

  /** Draw for the current state (signed in or a guest). */
  render(): void {
    const a = this.session.account;
    if (!a) {
      const signIn = h('button', { type: 'button', class: 'qm-btn qm-btn-yellow' }, icon('user'), AC.signIn);
      signIn.addEventListener('click', () => this.hooks.signIn());
      this.el.replaceChildren(
        h('section', { class: 'qm-card qm-account-card' }, h('h2', { class: 'qm-panel-title' }, AC.guestTitle), h('p', { class: 'qa-sub' }, COPY.auth.sub), h('p', { class: 'qm-fine' }, COPY.gate.brNote), h('div', { class: 'qm-account-actions' }, signIn)),
      );
      return;
    }
    const news = h('input', { type: 'checkbox', id: 'qm-news', role: 'switch' });
    news.checked = a.marketing;
    const newsMsg = h('p', { class: 'qa-msg', role: 'status', 'aria-live': 'polite' });
    news.addEventListener('change', () => void this.toggleNews(news, newsMsg));
    const switchBtn = h('button', { type: 'button', class: 'qm-btn qm-btn-ghost' }, icon('swap'), COPY.ducks.switch);
    const logout = h('button', { type: 'button', class: 'qm-btn qm-btn-ghost qm-account-logout' }, icon('leave'), AC.logout);
    const del = h('button', { type: 'button', class: 'qm-btn qm-btn-danger-ghost qm-account-delete' }, icon('trash'), X.open);
    this.duckPass.render();
    switchBtn.addEventListener('click', () => this.hooks.switchDuck());
    logout.addEventListener('click', () => this.hooks.logout());
    del.addEventListener('click', () => this.confirmDelete());
    const link = (text: string, href: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
    this.el.replaceChildren(
      h(
        'section',
        { class: 'qm-card qm-account-card' },
        h('h2', { class: 'qm-panel-title' }, AC.title),
        h('p', { class: 'qa-sub qm-account-who' }, AC.signedInAs(a.email)),
        h('dl', { class: 'qm-account-rows' }, h('dt', {}, AC.emailLabel), h('dd', {}, h('span', { class: 'qm-account-email' }, a.email), h('span', { class: 'qm-fine' }, AC.emailNote))),
        h(
          'label',
          { class: 'qm-switch', for: 'qm-news' },
          h('span', { class: 'qm-switch-text' }, h('span', { class: 'qm-switch-label' }, AC.newsLabel), h('span', { class: 'qm-fine' }, AC.newsNote)),
          news,
          h('span', { class: 'qm-switch-track', 'aria-hidden': 'true' }, h('span', { class: 'qm-switch-thumb' })),
        ),
        newsMsg,
        h('p', { class: 'qm-fine' }, AC.dataNote),
        h('p', { class: 'qm-fine qm-account-legal' }, link(COPY.legalUpdate.consent[1] ?? 'Terms', LINKS.terms), ' · ', link(COPY.legalUpdate.consent[3] ?? 'Privacy', LINKS.privacy), ' · ', link(COPY.storage.link, LINKS.cookies)),
        h('div', { class: 'qm-account-actions' }, switchBtn, logout),
      ),
      this.duckPass.el,
      h('section', { class: 'qm-card qm-account-card qm-danger-zone' }, h('h3', { class: 'qm-danger-title' }, X.heading), h('p', { class: 'qm-fine' }, X.note), h('div', { class: 'qm-account-actions' }, del)),
    );
  }

  private async toggleNews(box: HTMLInputElement, msg: HTMLElement): Promise<void> {
    const token = this.session.token;
    const a = this.session.account;
    if (!token || !a) return;
    const want = box.checked;
    box.disabled = true;
    try {
      const r = await setMarketing(token, want);
      this.session.update({ ...a, marketing: r.marketing });
      msg.textContent = r.marketing ? AC.newsOn : AC.newsOff;
      msg.classList.remove('is-error');
    } catch (err) {
      box.checked = !want;
      if (err instanceof ApiError && err.status === 401) return this.hooks.expired();
      msg.textContent = errorText(err);
      msg.classList.add('is-error');
    } finally {
      box.disabled = false;
    }
  }

  private confirmDelete(): void {
    const a = this.session.account;
    if (!a) return;
    const msg = h('p', { class: 'qa-msg', role: 'status', 'aria-live': 'polite' });
    if (this.hooks.inMatch()) {
      msg.textContent = X.inMatch;
      msg.classList.add('is-error');
    }
    const send = h('button', { type: 'button', class: 'qm-btn qm-btn-ghost qa-wide' }, icon('mail'), X.sendCode);
    const code = new CodeInput(() => check());
    const word = h('input', { id: 'qa-delete-word', class: 'qm-input', type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: 16 });
    const submit = h('button', { type: 'submit', class: 'qm-btn qm-btn-danger', disabled: true }, icon('trash'), X.submit);
    const cancel = h('button', { type: 'button', class: 'qm-btn qm-btn-ghost' }, X.cancel);
    const codeBlock = h('div', { class: 'qa-delete-code', hidden: true }, h('label', { class: 'qa-label', for: 'qa-delete-code' }, COPY.code.label), code.el, h('label', { class: 'qa-label', for: 'qa-delete-word' }, X.confirmLabel), word);
    code.input.id = 'qa-delete-code';
    const form = h('form', { class: 'qa-form', novalidate: true }, send, codeBlock, msg, h('div', { class: 'qa-dialog-actions' }, cancel, submit));
    const dialog = openDialog({ title: X.title, body: [X.body(a.characters.length)], content: form, danger: true });
    cancel.addEventListener('click', () => dialog.close());
    // The confirm word follows the menu language (DELETE, SİL), upper-cased in that locale (the dotted İ).
    const upper = (s: string): string => s.trim().toLocaleUpperCase(locale === 'tr' ? 'tr' : 'en');
    const wordOk = (): boolean => upper(word.value) === X.confirmWord;
    function check(): void {
      submit.disabled = !(code.value.length === CODE_DIGITS && wordOk());
    }
    word.addEventListener('input', () => {
      check();
      const typed = upper(word.value);
      msg.textContent = typed && !X.confirmWord.startsWith(typed) ? X.mismatch : '';
      msg.classList.toggle('is-error', msg.textContent !== '');
    });
    code.input.addEventListener('input', check);
    send.addEventListener('click', () => {
      void (async () => {
        const token = this.session.token;
        if (!token) return;
        send.disabled = true;
        msg.replaceChildren(h('span', { class: 'qm-spin', 'aria-hidden': 'true' }), h('span', {}, COPY.auth.sending));
        try {
          await requestDeleteCode(token);
          msg.textContent = X.codeSent(a.email);
          msg.classList.remove('is-error');
          codeBlock.hidden = false;
          send.hidden = true;
          code.focus();
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            dialog.close();
            return this.hooks.expired();
          }
          msg.textContent = errorText(err);
          msg.classList.add('is-error');
          send.disabled = false;
        }
      })();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (submit.disabled) return;
      void (async () => {
        const token = this.session.token;
        if (!token) return;
        submit.disabled = true;
        msg.replaceChildren(h('span', { class: 'qm-spin', 'aria-hidden': 'true' }));
        try {
          await deleteAccount(token, code.value);
          dialog.close();
          this.hooks.deleted();
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            dialog.close();
            return this.hooks.expired();
          }
          const left = err instanceof ApiError && err.code === 'code_wrong' && typeof err.body.left === 'number' ? err.body.left : null;
          msg.textContent = left !== null ? COPY.code.wrongLeft(left) : errorText(err);
          msg.classList.add('is-error');
          if (err instanceof ApiError && (err.code === 'code_locked' || err.code === 'code_expired')) {
            code.clear();
            send.hidden = false;
            send.disabled = false;
          }
          check();
        }
      })();
    });
  }
}
