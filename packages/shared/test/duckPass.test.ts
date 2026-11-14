import { describe, expect, it } from 'vitest';
import {
  checkDuckPassTx,
  DUCK_PASS_FEE_UQOR,
  DUCK_PASS_GAS_LIMIT,
  duckPassMemo,
  duckPassMessage,
  encodeMsgSend,
  explorerTxUrl,
  isQorAddress,
  isTxHash,
  parseDuckPassMemo,
} from '../src/duckPass.ts';
import { PROOF_HASH as HASH, PROOF_MEMO as MEMO, proofTx, TEST_ADDRESS, TEST_PUBKEY } from './duckPassFixture.ts';

const SDK_MSG_SEND_B64 = 'Cipxb3IxNGVoY2F5a3ZlbmpjeXF1ZHJhYzVqaGZldjhhNDBtOWc1cjN0emYSKnFvcjE0ZWhjYXlrdmVuamN5cXVkcmFjNWpoZmV2OGE0MG05ZzVyM3R6ZhoJCgR1cW9yEgEx';
const OTHER = `qor1${'q'.repeat(38)}`;

const b64 = (u: Uint8Array): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < u.length; i += 3) {
    const n = (u[i]! << 16) | ((u[i + 1] ?? 0) << 8) | (u[i + 2] ?? 0);
    out += chars[(n >> 18) & 63]! + chars[(n >> 12) & 63]! + (i + 1 < u.length ? chars[(n >> 6) & 63]! : '=') + (i + 2 < u.length ? chars[n & 63]! : '=');
  }
  return out;
};

describe('Duck Pass memo', () => {
  it('builds and parses qwakk-duck-pass:v1:<season>:<tag>:<nonce>', () => {
    const memo = duckPassMemo({ season: 's1', tag: '4821', nonce: 'AbCdEfGhIjKlMnOp' });
    expect(memo).toBe(MEMO);
    expect(parseDuckPassMemo(memo)).toEqual({ season: 's1', tag: '4821', nonce: 'AbCdEfGhIjKlMnOp' });
    // ASCII only, so characters are bytes: far under QoreX's 256-byte memo cap.
    expect(memo.length).toBeLessThanOrEqual(64);
  });

  it('refuses fields that would break the format', () => {
    expect(() => duckPassMemo({ season: 'S1', tag: '4821', nonce: 'AbCdEfGhIjKlMnOp' })).toThrow();
    expect(() => duckPassMemo({ season: 's1', tag: '48:21', nonce: 'AbCdEfGhIjKlMnOp' })).toThrow();
    expect(() => duckPassMemo({ season: 's1', tag: '4821', nonce: 'short' })).toThrow();
    for (const bad of ['', 'hello', 'qwakk-duck-pass:v2:s1:4821:AbCdEfGhIjKlMnOp', 'qwakk-duck-pass:v1:s1:4821:AbCdEfGhIjKlMnOp:x', 'qwakk-duck-pass:v1:s1:abc:AbCdEfGhIjKlMnOp', 42, null]) {
      expect(parseDuckPassMemo(bad)).toBeNull();
    }
  });
});

describe('Duck Pass message', () => {
  it('encodes MsgSend exactly like cosmjs-types', () => {
    expect(b64(encodeMsgSend(TEST_ADDRESS, TEST_ADDRESS, 'uqor', '1'))).toBe(SDK_MSG_SEND_B64);
    const m = duckPassMessage(TEST_ADDRESS);
    expect(m.typeUrl).toBe('/cosmos.bank.v1beta1.MsgSend');
    expect(b64(m.value)).toBe(SDK_MSG_SEND_B64);
  });

  it('prices the fee like QoreX (0.15 uqor per gas, rounded up)', () => {
    expect(DUCK_PASS_GAS_LIMIT).toBe(250_000);
    expect(DUCK_PASS_FEE_UQOR).toBe(37_500);
  });

  it('validates addresses, hashes and explorer links', () => {
    expect(isQorAddress(TEST_ADDRESS)).toBe(true);
    for (const bad of ['qor1short', TEST_ADDRESS.toUpperCase(), `cosmos1${TEST_ADDRESS.slice(4)}`, `${TEST_ADDRESS}x`, 'qor1' + 'b'.repeat(38)]) expect(isQorAddress(bad)).toBe(false);
    expect(isTxHash(HASH)).toBe(true);
    expect(isTxHash(HASH.toLowerCase())).toBe(true);
    expect(isTxHash(HASH.slice(1))).toBe(false);
    expect(explorerTxUrl(HASH.toLowerCase())).toBe(`https://explore.qore.network/tx/${HASH}`);
  });
});

describe('Duck Pass proof check', () => {
  it('accepts a hybrid-signed self send with the expected memo', () => {
    const r = checkDuckPassTx(proofTx(), { txHash: HASH.toLowerCase(), address: TEST_ADDRESS, memo: MEMO });
    expect(r).toEqual({
      ok: true,
      proof: { txHash: HASH, height: '10068068', timestamp: '2026-11-14T10:25:25Z', address: TEST_ADDRESS, memo: { season: 's1', tag: '4821', nonce: 'AbCdEfGhIjKlMnOp' }, signerPubKey: TEST_PUBKEY },
    });
  });

  it('checks any Duck Pass without expectations (the standalone checker)', () => {
    expect(checkDuckPassTx(proofTx()).ok).toBe(true);
  });

  it('refuses every way a proof can be wrong', () => {
    const cases: [ReturnType<typeof proofTx> | unknown, string, Parameters<typeof checkDuckPassTx>[1]?][] = [
      [null, 'malformed'],
      [{ tx_response: {} }, 'malformed'],
      [proofTx(), 'hash_mismatch', { txHash: 'CD'.repeat(32) }],
      [proofTx({ code: 5 }), 'tx_failed'],
      [proofTx({ memo: 'gm' }), 'not_duck_pass'],
      [proofTx(), 'memo_mismatch', { memo: 'qwakk-duck-pass:v1:s1:4821:ZZZZZZZZZZZZZZZZ' }],
      [proofTx({ to: OTHER }), 'not_self_send'],
      [proofTx({ amount: '2' }), 'not_self_send'],
      [proofTx(), 'signer_mismatch', { address: OTHER }],
      [proofTx({ signers: 2 }), 'signer_mismatch'],
      [proofTx({ signers: 0 }), 'signer_mismatch'],
      [proofTx({ ext: false }), 'no_hybrid'],
      [proofTx({ hybrid: 'failed' }), 'no_hybrid'],
      [proofTx({ hybridAddress: OTHER }), 'no_hybrid'],
    ];
    for (const [tx, reason, expect_] of cases) expect(checkDuckPassTx(tx, expect_), reason).toEqual({ ok: false, reason });
  });

  it('refuses a proof with two messages', () => {
    const tx = proofTx();
    tx.tx.body.messages.push({ ...tx.tx.body.messages[0]! });
    expect(checkDuckPassTx(tx)).toEqual({ ok: false, reason: 'not_self_send' });
  });
});
