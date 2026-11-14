/**
 * Duck Pass: a player links a QoreX wallet to their Qwakk account by leaving
 * one hybrid-signed (secp256k1 + ML-DSA-87) proof on the QoreChain testnet.
 * The proof is a `MsgSend` of 1 uqor from the wallet to itself whose memo is
 * `qwakk-duck-pass:v1:<season>:<duck tag>:<nonce>`. No tokens, no prizes, no
 * money flows: the 1 uqor comes straight back and only the network fee is spent.
 *
 * Pure data and checks, shared by the game server (which links the wallet),
 * the menu (which shows the request) and the standalone checker in
 * `duck-pass/`. No network, no DOM, no Node APIs. See README.md (Duck Pass)
 * and docs/accounts.md.
 *
 * Facts this module codes against (checked on Diana, 2026-11-14):
 * - `GET /cosmos/tx/v1beta1/txs/{hash}` answers `{ tx, tx_response }`, and an
 *   unknown hash 404 with `{ code: 5, message: "tx not found: ..." }`.
 * - A QoreX `signAndBroadcast` MsgSend carries the body extension
 *   `/qorechain.pqc.v1.PQCHybridSignature` and the events `pqc_verify`
 *   (`key_type` hybrid) and `pqc_hybrid_verify` with `address` (the signer)
 *   and `status` `verified`. Attribute values arrive as plain strings.
 * - QoreX accepts `{ chainId, messages: [{ typeUrl, value }], memo, gasLimit }`
 *   (`@qorechain/qorex-types` 0.1.0, `QorexSignAndBroadcastRequest`): memo at
 *   most 256 bytes, gas clamped to 100,000 to 5,000,000, fee 0.15 uqor per gas.
 */

/** QoreChain testnet. Duck Pass runs on the testnet only. */
export const DUCK_PASS_CHAIN_ID = 'qorechain-diana';
/** Diana's public REST (no CORS headers: browsers go through a proxy, the server calls it directly). */
export const DUCK_PASS_REST_URL = 'https://api-testnet.qore.host';
export const DUCK_PASS_EXPLORER_TX = 'https://explore.qore.network/tx/';

export const DUCK_PASS_MEMO_PREFIX = 'qwakk-duck-pass';
export const DUCK_PASS_MEMO_VERSION = 'v1';
export const MSG_SEND_TYPE_URL = '/cosmos.bank.v1beta1.MsgSend';
/** The body extension that carries the ML-DSA-87 layer (`@qorechain/sdk` HYBRID_SIG_TYPE_URL). */
export const HYBRID_SIG_TYPE_URL = '/qorechain.pqc.v1.PQCHybridSignature';
export const SECP256K1_PUBKEY_TYPE_URL = '/cosmos.crypto.secp256k1.PubKey';
export const DUCK_PASS_DENOM = 'uqor';
/** The proof sends this much to the wallet itself (net zero). */
export const DUCK_PASS_AMOUNT = '1';
/**
 * Gas for the proof. A QoreX hybrid MsgSend used 166,421 to 180,071 gas on
 * Diana (qwakk-app lib/qwakk-native-tx.ts notes; 167,587 for a 1 uqor self
 * send seen on 2026-11-14), so 250,000 leaves room without overpaying.
 */
export const DUCK_PASS_GAS_LIMIT = 250_000;
/** The fee QoreX charges for that gas: 0.15 uqor per gas, rounded up (37,500 uqor, about 0.04 test QOR). */
export const DUCK_PASS_FEE_UQOR = Math.ceil((DUCK_PASS_GAS_LIMIT * 15) / 100);
/** A challenge (its nonce) lives this long; the wallet step and the check must fit in it. */
export const DUCK_PASS_CHALLENGE_MS = 15 * 60 * 1000;

const BECH32_CHARS = '[02-9ac-hj-np-z]';
const ADDRESS_RE = new RegExp(`^qor1${BECH32_CHARS}{38}$`);
const TX_HASH_RE = /^[0-9A-Fa-f]{64}$/;
const SEASON_RE = /^s[0-9]{1,6}$/;
const TAG_RE = /^[0-9]{1,8}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{16,32}$/;

/** A 20-byte QoreChain account address (`qor1` plus 38 bech32 characters, lower case). */
export function isQorAddress(v: unknown): v is string {
  return typeof v === 'string' && ADDRESS_RE.test(v);
}

export function isTxHash(v: unknown): v is string {
  return typeof v === 'string' && TX_HASH_RE.test(v);
}

export function isDuckPassNonce(v: unknown): v is string {
  return typeof v === 'string' && NONCE_RE.test(v);
}

/** The explorer link for a transaction (always explore.qore.network). */
export function explorerTxUrl(hash: string): string {
  return `${DUCK_PASS_EXPLORER_TX}${hash.toUpperCase()}`;
}

export interface DuckPassMemo {
  season: string;
  tag: string;
  nonce: string;
}

/** `qwakk-duck-pass:v1:<season>:<duck tag>:<nonce>`; throws on a field that does not fit the format. */
export function duckPassMemo(m: DuckPassMemo): string {
  if (!SEASON_RE.test(m.season) || !TAG_RE.test(m.tag) || !NONCE_RE.test(m.nonce)) throw new Error('duck pass memo field out of format');
  return `${DUCK_PASS_MEMO_PREFIX}:${DUCK_PASS_MEMO_VERSION}:${m.season}:${m.tag}:${m.nonce}`;
}

export function parseDuckPassMemo(memo: unknown): DuckPassMemo | null {
  if (typeof memo !== 'string' || memo.length > 128) return null;
  const parts = memo.split(':');
  if (parts.length !== 5 || parts[0] !== DUCK_PASS_MEMO_PREFIX || parts[1] !== DUCK_PASS_MEMO_VERSION) return null;
  const [, , season, tag, nonce] = parts as [string, string, string, string, string];
  if (!SEASON_RE.test(season) || !TAG_RE.test(tag) || !NONCE_RE.test(nonce)) return null;
  return { season, tag, nonce };
}

// ---- protobuf: cosmos.bank.v1beta1.MsgSend ----------------------------------

function ascii(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0x7e || c < 0x20) throw new Error('ascii only');
    out.push(c);
  }
  return out;
}

function varint(n: number): number[] {
  const out: number[] = [];
  let v = n;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
  return out;
}

/** Field `no` with wire type 2 (length-delimited). */
function field(no: number, bytes: number[]): number[] {
  return [(no << 3) | 2, ...varint(bytes.length), ...bytes];
}

/**
 * Protobuf bytes of `MsgSend { from_address = 1, to_address = 2, amount = 3
 * (repeated Coin { denom = 1, amount = 2 }) }`, the same bytes as
 * cosmjs-types `MsgSend.encode` (checked in test/duckPass.test.ts).
 */
export function encodeMsgSend(from: string, to: string, denom: string, amount: string): Uint8Array {
  const coin = [...field(1, ascii(denom)), ...field(2, ascii(amount))];
  return Uint8Array.from([...field(1, ascii(from)), ...field(2, ascii(to)), ...field(3, coin)]);
}

/** The one message of a Duck Pass proof for `address`: 1 uqor to itself. */
export function duckPassMessage(address: string): { typeUrl: string; value: Uint8Array } {
  return { typeUrl: MSG_SEND_TYPE_URL, value: encodeMsgSend(address, address, DUCK_PASS_DENOM, DUCK_PASS_AMOUNT) };
}

// ---- the proof check ---------------------------------------------------------

/** Why a transaction is not a valid Duck Pass proof. */
export type DuckPassFailure =
  | 'malformed'
  | 'hash_mismatch'
  | 'tx_failed'
  | 'not_duck_pass'
  | 'memo_mismatch'
  | 'not_self_send'
  | 'signer_mismatch'
  | 'no_hybrid';

export interface DuckPassProof {
  txHash: string;
  height: string;
  timestamp: string;
  /** The wallet: sender, receiver and the address the chain verified the hybrid signature for. */
  address: string;
  memo: DuckPassMemo;
  /** The secp256k1 public key the transaction was signed with (base64, 33 bytes compressed). */
  signerPubKey: string;
}

export type DuckPassCheck = { ok: true; proof: DuckPassProof } | { ok: false; reason: DuckPassFailure };

export interface DuckPassExpect {
  /** The hash that was asked for (any case). */
  txHash?: string;
  /** The wallet the challenge was made for. */
  address?: string;
  /** The exact memo the challenge handed out. */
  memo?: string;
}

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Attributes of every event of `type`, as plain key to value maps. */
function eventsOf(txResponse: Record<string, unknown>, type: string): Map<string, string>[] {
  return arr(txResponse.events)
    .map(rec)
    .filter((e): e is Record<string, unknown> => e !== null && e.type === type)
    .map((e) => new Map(arr(e.attributes).map(rec).filter((a): a is Record<string, unknown> => a !== null).map((a) => [str(a.key), str(a.value)])));
}

/**
 * Check a `GET /cosmos/tx/v1beta1/txs/{hash}` answer against the Duck Pass
 * rules: included with code 0, exactly one MsgSend of 1 uqor from the wallet
 * to itself, a Duck Pass memo (the expected one, when given), exactly one
 * secp256k1 signer, and the chain's own `pqc_hybrid_verify` event saying it
 * verified the ML-DSA-87 layer for that wallet, with the hybrid extension in
 * the body. Fails closed on anything it cannot read.
 *
 * It does not tie the signer's public key to the address (that needs
 * hashing); the game server does that too (`apps/server/src/meta/duckPass/address.ts`).
 */
export function checkDuckPassTx(answer: unknown, expect: DuckPassExpect = {}): DuckPassCheck {
  const root = rec(answer);
  const r = rec(root?.tx_response);
  const tx = rec(root?.tx) ?? rec(r?.tx);
  const body = rec(tx?.body);
  const auth = rec(tx?.auth_info);
  if (!r || !body || !auth) return { ok: false, reason: 'malformed' };

  const txHash = str(r.txhash).toUpperCase();
  if (!isTxHash(txHash)) return { ok: false, reason: 'malformed' };
  if (expect.txHash !== undefined && expect.txHash.toUpperCase() !== txHash) return { ok: false, reason: 'hash_mismatch' };
  if (Number(r.code) !== 0 || typeof r.code !== 'number') return { ok: false, reason: 'tx_failed' };

  const memo = parseDuckPassMemo(body.memo);
  if (!memo) return { ok: false, reason: 'not_duck_pass' };
  if (expect.memo !== undefined && body.memo !== expect.memo) return { ok: false, reason: 'memo_mismatch' };

  const msgs = arr(body.messages);
  const msg = rec(msgs[0]);
  const coins = arr(msg?.amount);
  const coin = rec(coins[0]);
  const from = str(msg?.from_address);
  if (msgs.length !== 1 || msg?.['@type'] !== MSG_SEND_TYPE_URL || coins.length !== 1 || coin?.denom !== DUCK_PASS_DENOM || coin?.amount !== DUCK_PASS_AMOUNT || !isQorAddress(from) || msg?.to_address !== from) {
    return { ok: false, reason: 'not_self_send' };
  }

  const signers = arr(auth.signer_infos);
  const key = rec(rec(signers[0])?.public_key);
  if (signers.length !== 1 || key?.['@type'] !== SECP256K1_PUBKEY_TYPE_URL || typeof key.key !== 'string' || key.key.length === 0) return { ok: false, reason: 'signer_mismatch' };
  if (expect.address !== undefined && from !== expect.address) return { ok: false, reason: 'signer_mismatch' };

  const hasExtension = arr(body.extension_options).some((x) => rec(x)?.['@type'] === HYBRID_SIG_TYPE_URL);
  const verified = eventsOf(r, 'pqc_hybrid_verify').some((e) => e.get('address') === from && e.get('status') === 'verified');
  if (!hasExtension || !verified) return { ok: false, reason: 'no_hybrid' };

  return { ok: true, proof: { txHash, height: str(r.height), timestamp: str(r.timestamp), address: from, memo, signerPubKey: key.key } };
}

/** A linked Duck Pass, as the account API sends it. */
export interface DuckPassView {
  address: string;
  txHash: string;
  season: string;
  linkedAt: string;
}

/** POST /api/account/qorex/challenge: what the menu hands to QoreX `signAndBroadcast`. */
export interface DuckPassChallenge {
  chainId: string;
  memo: string;
  /** Base64 protobuf values, as QoreX accepts them. */
  messages: { typeUrl: string; value: string }[];
  gasLimit: string;
  feeUqor: number;
  expiresAt: number;
}

/** POST /api/account/qorex/verify. */
export type DuckPassVerifyResult = { status: 'pending' } | { status: 'linked'; duckPass: DuckPassView };
