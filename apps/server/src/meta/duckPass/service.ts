/**
 * Duck Pass rules: link a QoreX wallet to a signed-in account with one
 * hybrid-signed proof transaction on the QoreChain testnet.
 *
 * 1. challenge: the menu sends the wallet address QoreX gave it and the duck
 *    it plays; the server answers the exact `signAndBroadcast` request: one
 *    MsgSend of 1 uqor from the wallet to itself with the memo
 *    `qwakk-duck-pass:v1:<season>:<duck tag>:<nonce>`. The nonce is random,
 *    single use, bound to this account and wallet, and expires.
 * 2. QoreX shows it, adds its ML-DSA-87 layer, signs and broadcasts. The
 *    server never sees a key or a signature and never broadcasts.
 * 3. verify: the menu sends only the transaction hash. The server reads that
 *    transaction from Diana and checks it (`checkDuckPassTx`: code 0, the self
 *    send, the exact memo, one signer, the chain's `pqc_hybrid_verify` event
 *    for the wallet) and that the signer's public key derives to the wallet.
 *    Then it stores the `qorex` login and the proof in one transaction.
 *
 * Nothing here moves value or grants anything in the game: a linked wallet
 * never touches Tüy, XP, the leaderboard or any reward (CLAUDE.md, Product
 * rules). Challenges live in memory only (one server instance, like the
 * limits); a restart drops them and the player starts again.
 */
import { randomBytes } from 'node:crypto';
import type { Sql } from 'postgres';
import {
  checkDuckPassTx,
  DUCK_PASS_CHAIN_ID,
  DUCK_PASS_CHALLENGE_MS,
  DUCK_PASS_FEE_UQOR,
  DUCK_PASS_GAS_LIMIT,
  duckPassMemo,
  duckPassMessage,
  isQorAddress,
  isTxHash,
  type DuckPassChallenge,
  type DuckPassFailure,
  type DuckPassVerifyResult,
} from '@qwakk/shared/duck-pass';
import { isUuid } from '../token.ts';
import { RateLimiter, type BucketOptions } from '../rateLimit.ts';
import { addressOfPubKey } from './address.ts';
import { fetchTx, type ChainFetch } from './chain.ts';
import { pgDuckPassStore, type DuckPassStore } from './store.ts';

export interface ApiAnswer {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/**
 * Per account: 5 challenges, then one every 2 minutes (each one means the
 * player is about to pay a network fee, so a loop here is a bug or abuse).
 * Checks: 40 per account, then one every 2 s (the menu polls while the
 * transaction is not indexed yet, about every 2.5 s for a minute).
 */
export const DUCK_PASS_LIMITS = {
  challenge: { capacity: 5, refillPerSec: 1 / 120 },
  verify: { capacity: 40, refillPerSec: 1 / 2 },
} as const satisfies Record<string, BucketOptions>;

/** At most this many open challenges in memory; the oldest go first. */
const MAX_CHALLENGES = 10_000;

interface Challenge {
  address: string;
  memo: string;
  expiresAt: number;
}

export interface DuckPassDeps {
  store?: DuckPassStore;
  fetch?: ChainFetch;
  now?: () => number;
}

const fail = (status: number, error: string, headers?: Record<string, string>): ApiAnswer => ({ status, body: { error }, ...(headers ? { headers } : {}) });
const obj = (b: unknown): Record<string, unknown> => (b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {});

/** Failures that end the challenge: this transaction can never become a valid proof for it. */
const FINAL: ReadonlySet<DuckPassFailure> = new Set(['tx_failed', 'not_duck_pass', 'memo_mismatch', 'not_self_send', 'signer_mismatch', 'no_hybrid', 'hash_mismatch']);

export class DuckPassService {
  readonly limits = {
    challenge: new RateLimiter(DUCK_PASS_LIMITS.challenge),
    verify: new RateLimiter(DUCK_PASS_LIMITS.verify),
  };
  private readonly store: DuckPassStore;
  private readonly fetchImpl: ChainFetch | undefined;
  private readonly now: () => number;
  /** Open challenges by account id: one per account, the newest wins. */
  private readonly challenges = new Map<string, Challenge>();
  /** Accounts with a chain read in flight (a second check waits for it instead of piling up). */
  private readonly checking = new Set<string>();

  constructor(deps: DuckPassDeps = {}) {
    this.store = deps.store ?? pgDuckPassStore;
    this.fetchImpl = deps.fetch;
    this.now = deps.now ?? Date.now;
  }

  private limited(kind: 'challenge' | 'verify', accountId: string): ApiAnswer | null {
    if (this.limits[kind].take(accountId, this.now())) return null;
    return fail(429, 'rate_limited', { 'Retry-After': String(this.limits[kind].retryAfter(accountId, this.now())) });
  }

  private openChallenge(accountId: string): Challenge | null {
    const c = this.challenges.get(accountId);
    if (!c) return null;
    if (c.expiresAt <= this.now()) {
      this.challenges.delete(accountId);
      return null;
    }
    return c;
  }

  /** Drops a failed challenge, but never a newer one the player started meanwhile. */
  private dropChallenge(accountId: string, ch: Challenge): void {
    if (this.challenges.get(accountId) === ch) this.challenges.delete(accountId);
  }

  /** POST /api/account/qorex/challenge { address, duckId } */
  async challenge(db: Sql, accountId: string, body: unknown): Promise<ApiAnswer> {
    const b = obj(body);
    if (!isQorAddress(b.address)) return fail(400, 'qorex_address');
    if (!isUuid(b.duckId)) return fail(400, 'bad_request');
    // Limit first, so the taken check below cannot be used to probe wallets.
    const limit = this.limited('challenge', accountId);
    if (limit) return limit;
    const tag = await this.store.duckTag(db, accountId, b.duckId);
    if (tag === null) return fail(404, 'not_found');
    // Refuse before the player pays a fee for a link that cannot happen.
    if (await this.store.duckPassOf(db, accountId)) return fail(409, 'qorex_linked');
    const owner = await this.store.walletOwner(db, b.address);
    if (owner !== null && owner !== accountId) return fail(409, 'qorex_taken');

    const season = await this.store.season(db);
    const nonce = randomBytes(12).toString('base64url');
    const memo = duckPassMemo({ season, tag, nonce });
    const expiresAt = this.now() + DUCK_PASS_CHALLENGE_MS;
    this.challenges.delete(accountId);
    if (this.challenges.size >= MAX_CHALLENGES) {
      for (const [id, c] of this.challenges) if (c.expiresAt <= this.now()) this.challenges.delete(id);
      if (this.challenges.size >= MAX_CHALLENGES) this.challenges.delete(this.challenges.keys().next().value!);
    }
    this.challenges.set(accountId, { address: b.address, memo, expiresAt });
    const msg = duckPassMessage(b.address);
    return {
      status: 200,
      body: {
        chainId: DUCK_PASS_CHAIN_ID,
        memo,
        messages: [{ typeUrl: msg.typeUrl, value: Buffer.from(msg.value).toString('base64') }],
        gasLimit: String(DUCK_PASS_GAS_LIMIT),
        feeUqor: DUCK_PASS_FEE_UQOR,
        expiresAt,
      } satisfies DuckPassChallenge,
    };
  }

  /** POST /api/account/qorex/verify { txHash }: 202 pending until the chain has it, then linked or a reason. */
  async verify(db: Sql, accountId: string, body: unknown): Promise<ApiAnswer> {
    const txHash = obj(body).txHash;
    if (!isTxHash(txHash)) return fail(400, 'bad_request');
    const limit = this.limited('verify', accountId);
    if (limit) return limit;
    const ch = this.openChallenge(accountId);
    if (!ch) return fail(410, 'qorex_expired');
    if (this.checking.has(accountId)) return { status: 202, body: { status: 'pending' } satisfies DuckPassVerifyResult };
    this.checking.add(accountId);
    try {
      const found = await fetchTx(txHash, this.fetchImpl);
      if (found.kind === 'not_found') return { status: 202, body: { status: 'pending' } satisfies DuckPassVerifyResult };
      if (found.kind === 'unreachable') return fail(503, 'chain_unreachable');
      const check = checkDuckPassTx(found.body, { txHash, address: ch.address, memo: ch.memo });
      if (!check.ok) {
        if (FINAL.has(check.reason)) this.dropChallenge(accountId, ch);
        return fail(422, `qorex_${check.reason}`);
      }
      // The key that signed must be the wallet's own key, not just a key the body names.
      if (addressOfPubKey(check.proof.signerPubKey) !== ch.address) {
        this.dropChallenge(accountId, ch);
        return fail(422, 'qorex_signer_mismatch');
      }
      // Still this account's challenge (a newer one would have replaced it meanwhile).
      if (this.challenges.get(accountId) !== ch) return fail(410, 'qorex_expired');
      const linked = await this.store.link(db, accountId, ch.address, check.proof.txHash, check.proof.memo.season);
      this.challenges.delete(accountId);
      if (linked === 'taken') return fail(409, 'qorex_taken');
      if (linked === 'linked') return fail(409, 'qorex_linked');
      if (linked === 'proof_used') return fail(409, 'qorex_proof_used');
      const duckPass = await this.store.duckPassOf(db, accountId);
      if (!duckPass) return fail(503, 'unavailable');
      return { status: 200, body: { status: 'linked', duckPass } satisfies DuckPassVerifyResult };
    } finally {
      this.checking.delete(accountId);
    }
  }

  /** POST /api/account/qorex/unlink: the wallet login and the stored proof go (the transaction stays on chain). */
  async unlink(db: Sql, accountId: string): Promise<ApiAnswer> {
    this.challenges.delete(accountId);
    await this.store.unlink(db, accountId);
    return { status: 200, body: { ok: true } };
  }

  /** Tests: drop every open challenge. */
  clear(): void {
    this.challenges.clear();
    this.checking.clear();
  }
}
