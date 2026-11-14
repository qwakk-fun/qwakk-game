/**
 * A Duck Pass proof transaction as Diana's REST answers it, for the shared
 * and server tests (not a test file itself).
 *
 * Test wallet: the secp256k1 key sha256("qwakk duck pass test key"). Its
 * address and the MsgSend bytes were made with the official SDK
 * (`@qorechain/sdk` bytesToBech32(ripemd160(sha256(pubkey))) and cosmjs-types
 * `MsgSend.encode`), so they check this code against an independent encoder.
 */
export const TEST_ADDRESS = 'qor14ehcaykvenjcyqudrac5jhfev8a40m9g5r3tzf';
export const TEST_PUBKEY = 'Am78vuoLDgOK0uIk0cBrI6H9ZciYQFbymJpAoCepjm+x';
export const PROOF_HASH = 'AB'.repeat(32);
export const PROOF_MEMO = 'qwakk-duck-pass:v1:s1:4821:AbCdEfGhIjKlMnOp';

/** The shape Diana answers for a QoreX hybrid MsgSend (trimmed; values as seen on 2026-11-14). */
export function proofTx(over: { code?: number; memo?: string; from?: string; to?: string; amount?: string; ext?: boolean; hybrid?: string; hybridAddress?: string; signers?: number; hash?: string } = {}) {
  const from = over.from ?? TEST_ADDRESS;
  const signer = { public_key: { '@type': '/cosmos.crypto.secp256k1.PubKey', key: TEST_PUBKEY }, mode_info: { single: { mode: 'SIGN_MODE_DIRECT' } }, sequence: '1' };
  return {
    tx: {
      body: {
        messages: [{ '@type': '/cosmos.bank.v1beta1.MsgSend', from_address: from, to_address: over.to ?? from, amount: [{ denom: 'uqor', amount: over.amount ?? '1' }] }],
        memo: over.memo ?? PROOF_MEMO,
        extension_options: over.ext === false ? [] : [{ '@type': '/qorechain.pqc.v1.PQCHybridSignature', algorithm_id: 1, pqc_signature: 'AAAA' }],
        non_critical_extension_options: [],
      },
      auth_info: { signer_infos: Array.from({ length: over.signers ?? 1 }, () => signer), fee: { amount: [{ denom: 'uqor', amount: '37500' }], gas_limit: '250000' } },
      signatures: ['AAAA'],
    },
    tx_response: {
      height: '10068068',
      txhash: over.hash ?? PROOF_HASH,
      codespace: '',
      code: over.code ?? 0,
      timestamp: '2026-11-14T10:25:25Z',
      events: [
        { type: 'pqc_verify', attributes: [{ key: 'address', value: from, index: true }, { key: 'key_type', value: 'hybrid', index: true }] },
        { type: 'pqc_hybrid_verify', attributes: [{ key: 'address', value: over.hybridAddress ?? from, index: true }, { key: 'algorithm_id', value: 'dilithium5', index: true }, { key: 'status', value: over.hybrid ?? 'verified', index: true }] },
        { type: 'message', attributes: [{ key: 'action', value: '/cosmos.bank.v1beta1.MsgSend', index: true }, { key: 'sender', value: from, index: true }] },
      ],
    },
  };
}

