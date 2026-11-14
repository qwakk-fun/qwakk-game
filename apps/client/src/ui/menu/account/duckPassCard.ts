/**
 * The Duck Pass card on the Account tab: link a QoreX wallet to the account
 * with one hybrid-signed proof on the QoreChain testnet (duckPassFlow.ts),
 * show the linked wallet with its proof on the explorer, unlink it. States:
 * no wallet, outdated wallet, wrong network, declined, pending, verified.
 * Every message is fixed copy (COPY.duckPass); wallet and chain text never
 * reach the screen. Identity only: nothing here touches rewards or Tüy.
 */
import { QOREX_DOWNLOAD_URLS, getQorexNative } from '@qorechain/qorex-types';
import { DUCK_PASS_FEE_UQOR, explorerTxUrl, type DuckPassView } from '@qwakk/shared/duck-pass';
import { ApiError } from '../api.ts';
import { COPY } from '../copy.ts';
import { h } from '../dom.ts';
import { icon } from '../icons.ts';
import { qorexChallenge, qorexUnlink, qorexVerify } from './accountApi.ts';
import { checkProof, linkWallet, qorexState, uqorToQor, type FlowResult } from './duckPassFlow.ts';
import type { AccountSession } from './session.ts';

const DP = COPY.duckPass;
/** Server codes that all mean "that transaction is not the proof we asked for". */
const MISMATCH = new Set(['qorex_memo_mismatch', 'qorex_not_self_send', 'qorex_signer_mismatch', 'qorex_not_duck_pass', 'qorex_hash_mismatch', 'qorex_malformed']);

/** Fixed copy for a stop reason (wallet, Duck Pass server code, or a general API error). */
export function stopText(reason: string): string {
  const key = MISMATCH.has(reason) ? 'qorex_mismatch' : reason;
  return DP.errors[key] ?? COPY.errors[key] ?? COPY.errors.generic!;
}

const short = (s: string, head = 10, tail = 6): string => (s.length > head + tail + 3 ? `${s.slice(0, head)}...${s.slice(-tail)}` : s);

export class DuckPassCard {
  readonly el: HTMLElement;
  private readonly session: AccountSession;
  private readonly expired: () => void;
  private busy = false;

  constructor(session: AccountSession, expired: () => void) {
    this.session = session;
    this.expired = expired;
    this.el = h('section', { class: 'qm-card qm-account-card qm-duckpass', 'aria-live': 'polite' });
  }

  render(): void {
    const pass = this.session.account?.duckPass ?? null;
    if (pass) this.drawLinked(pass);
    else this.drawLink();
  }

  private head(): HTMLElement[] {
    return [h('h3', { class: 'qm-duckpass-title' }, icon('wallet'), DP.title, h('span', { class: 'qm-duckpass-tag' }, DP.tag)), h('p', { class: 'qm-fine' }, DP.intro)];
  }

  private drawLink(msg?: { text: string; error?: boolean; txHash?: string; again?: boolean }): void {
    const duck = this.session.active;
    const state = qorexState();
    const btn = h('button', { type: 'button', class: 'qm-btn qm-btn-yellow qm-duckpass-link', disabled: !duck || this.busy }, icon('link'), DP.link);
    btn.addEventListener('click', () => void this.link());
    const actions = h('div', { class: 'qm-account-actions' }, btn);
    if (state === 'missing') actions.append(h('a', { class: 'qm-btn qm-btn-ghost', href: QOREX_DOWNLOAD_URLS.chrome, target: '_blank', rel: 'noopener' }, DP.install));
    if (msg?.again && msg.txHash) {
      const again = h('button', { type: 'button', class: 'qm-btn qm-btn-ghost' }, DP.checkAgain);
      again.addEventListener('click', () => void this.check(msg.txHash!));
      actions.append(again);
    }
    const out = h('p', { class: `qa-msg${msg?.error ? ' is-error' : ''}`, role: 'status' }, msg?.text ?? '');
    if (msg?.txHash) out.append(' ', h('a', { href: explorerTxUrl(msg.txHash), target: '_blank', rel: 'noopener' }, DP.viewTx));
    this.el.replaceChildren(
      ...this.head(),
      h('p', { class: 'qm-fine' }, DP.how(uqorToQor(DUCK_PASS_FEE_UQOR))),
      h('p', { class: 'qm-fine' }, DP.publicNote),
      ...(duck ? [] : [h('p', { class: 'qm-fine' }, DP.pickDuck)]),
      actions,
      out,
    );
  }

  private drawLinked(pass: DuckPassView): void {
    const unlink = h('button', { type: 'button', class: 'qm-btn qm-btn-ghost' }, DP.unlink);
    unlink.addEventListener('click', () => void this.unlink(unlink));
    this.el.replaceChildren(
      ...this.head(),
      h('p', { class: 'qm-duckpass-ok' }, icon('check'), DP.linked, ' · ', DP.season(pass.season)),
      h(
        'dl',
        { class: 'qm-account-rows' },
        h('dt', {}, DP.walletLabel),
        h('dd', {}, h('span', { class: 'qm-account-email qm-duckpass-mono', title: pass.address }, pass.address)),
        h('dt', {}, DP.proofLabel),
        h('dd', {}, h('a', { class: 'qm-duckpass-mono', href: explorerTxUrl(pass.txHash), target: '_blank', rel: 'noopener', title: pass.txHash }, short(pass.txHash)), h('span', { class: 'qm-fine' }, DP.shielded)),
      ),
      h('p', { class: 'qm-fine' }, DP.unlinkNote),
      h('div', { class: 'qm-account-actions' }, unlink),
    );
  }

  private progress(text: string): void {
    const out = this.el.querySelector('.qa-msg');
    out?.classList.remove('is-error');
    out?.replaceChildren(h('span', { class: 'qm-spin', 'aria-hidden': 'true' }), h('span', {}, text));
  }

  private async link(): Promise<void> {
    const token = this.session.token;
    const duck = this.session.active;
    if (!token || !duck || this.busy) return;
    const state = qorexState();
    if (state !== 'ready') return this.drawLink({ text: stopText(state), error: true });
    this.busy = true;
    this.el.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      const r = await linkWallet({
        native: getQorexNative()!,
        challenge: (address) => qorexChallenge(token, address, duck.id),
        verify: (hash) => qorexVerify(token, hash),
        onStep: (step) => this.progress(DP.steps[step] ?? ''),
      });
      this.done(r);
    } finally {
      this.busy = false;
    }
  }

  private async check(txHash: string): Promise<void> {
    const token = this.session.token;
    if (!token || this.busy) return;
    this.busy = true;
    this.el.querySelectorAll('button').forEach((b) => (b.disabled = true));
    this.progress(DP.steps.checking ?? '');
    try {
      this.done(await checkProof({ verify: (hash) => qorexVerify(token, hash) }, txHash));
    } finally {
      this.busy = false;
    }
  }

  private done(r: FlowResult): void {
    if (r.kind === 'linked') {
      const a = this.session.account;
      if (a) this.session.update({ ...a, duckPass: r.duckPass });
      return this.drawLinked(r.duckPass);
    }
    if (r.kind === 'waiting') return this.drawLink({ text: DP.waiting, txHash: r.txHash, again: true });
    if (r.reason === 'session_expired') return this.expired();
    this.drawLink({ text: stopText(r.reason), error: true, ...(r.txHash ? { txHash: r.txHash } : {}) });
  }

  private async unlink(btn: HTMLButtonElement): Promise<void> {
    const token = this.session.token;
    const a = this.session.account;
    if (!token || !a) return;
    btn.disabled = true;
    try {
      await qorexUnlink(token);
      this.session.update({ ...a, duckPass: null });
      this.drawLink({ text: DP.unlinked });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return this.expired();
      btn.disabled = false;
      this.el.append(h('p', { class: 'qa-msg is-error', role: 'status' }, stopText(err instanceof ApiError ? err.code : 'generic')));
    }
  }
}
