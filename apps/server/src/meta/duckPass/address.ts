/**
 * The QoreChain account address of a secp256k1 public key:
 * bech32("qor", RIPEMD160(SHA256(compressed pubkey))), the Cosmos account
 * address rule. Matches `@qorechain/sdk` bytesToBech32(ripemd160(sha256(pk)))
 * and Diana: the signer key of a live QoreX MsgSend derives to the address in
 * its `pqc_hybrid_verify` event (checked 2026-11-14). Node crypto only.
 */
import { createHash } from 'node:crypto';

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i]!;
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >>> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

/** 8-bit bytes to 5-bit words, padded (BIP-173 convertbits). */
function toWords(bytes: Uint8Array): number[] {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out.push((acc >>> bits) & 31);
    }
  }
  if (bits > 0) out.push((acc << (5 - bits)) & 31);
  return out;
}

/** Bech32 (BIP-173, not bech32m) encoding of `bytes` under `hrp`. */
export function bech32Encode(hrp: string, bytes: Uint8Array): string {
  const words = toWords(bytes);
  const mod = polymod([...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const check = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...words, ...check].map((w) => CHARSET[w]).join('')}`;
}

/** The qor1 address of a base64 compressed secp256k1 key, or null when it is not one. */
export function addressOfPubKey(pubKeyB64: string): string | null {
  const pk = Buffer.from(pubKeyB64, 'base64');
  if (pk.length !== 33 || (pk[0] !== 2 && pk[0] !== 3)) return null;
  const ripe = createHash('ripemd160').update(createHash('sha256').update(pk).digest()).digest();
  return bech32Encode('qor', ripe);
}
