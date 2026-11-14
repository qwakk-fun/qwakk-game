import { useEffect, useMemo, useState } from "react";

import {
  bytesToBech32,
  createClient,
  getTx,
  ripemd160,
  sha256,
  type QoreChainClient,
} from "@qorechain/sdk";

// The same rules the game server links a wallet with (packages/shared/src/duckPass.ts).
import {
  checkDuckPassTx,
  explorerTxUrl,
  isTxHash,
  type DuckPassFailure,
  type DuckPassProof,
} from "../../packages/shared/src/duckPass.ts";

// Scaffolded with create-qorechain-dapp 0.14.0 (fullstack-web, testnet).
// The public REST API sends no CORS headers, so the browser reads it through
// the /lcd proxy (vite.config.ts in dev and preview).
const REST_URL = import.meta.env.VITE_QORE_REST_URL ?? "/lcd";

const YELLOW = "#ffd43b";
const DARK = "#151619";

type Result =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "valid"; proof: DuckPassProof }
  | { kind: "invalid"; reason: DuckPassFailure | "key_mismatch" }
  | { kind: "missing" }
  | { kind: "error" };

const WHY: Record<DuckPassFailure | "key_mismatch", string> = {
  malformed: "QoreChain answered with something we cannot read.",
  hash_mismatch: "QoreChain answered with a different transaction.",
  tx_failed: "The transaction failed on chain, so it proves nothing.",
  not_duck_pass: "This transaction has no Duck Pass note.",
  memo_mismatch: "The note is not the expected one.",
  not_self_send: "A Duck Pass sends exactly 1 uqor from a wallet to itself. This one does not.",
  signer_mismatch: "It needs exactly one signer, the wallet itself.",
  no_hybrid: "QoreChain did not verify a post-quantum (ML-DSA-87) signature on it.",
  key_mismatch: "The key that signed it does not belong to the wallet named in it.",
};

/** The qor1 address of a base64 compressed secp256k1 key (SHA-256, then RIPEMD-160, then bech32). */
function addressOfKey(b64: string): string | null {
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    if (bytes.length !== 33) return null;
    return bytesToBech32(ripemd160(sha256(bytes)), "qor");
  } catch {
    return null;
  }
}

function isNotFound(err: unknown): boolean {
  const e = err as { status?: unknown; message?: unknown };
  return e?.status === 404 || (typeof e?.message === "string" && /not found|404/i.test(e.message));
}

export function App(): JSX.Element {
  const client: QoreChainClient = useMemo(
    () => createClient({ network: "testnet", endpoints: { rest: REST_URL } }),
    [],
  );
  const [hash, setHash] = useState(() => new URLSearchParams(location.search).get("tx") ?? "");
  const [result, setResult] = useState<Result>({ kind: "idle" });

  async function check(value = hash): Promise<void> {
    const h = value.trim().toUpperCase();
    if (!isTxHash(h)) {
      setResult({ kind: "invalid", reason: "malformed" });
      return;
    }
    setResult({ kind: "loading" });
    try {
      const answer = await getTx(client.rest, h);
      const verdict = checkDuckPassTx(answer, { txHash: h });
      if (!verdict.ok) return setResult({ kind: "invalid", reason: verdict.reason });
      if (addressOfKey(verdict.proof.signerPubKey) !== verdict.proof.address) {
        return setResult({ kind: "invalid", reason: "key_mismatch" });
      }
      setResult({ kind: "valid", proof: verdict.proof });
    } catch (err) {
      setResult(isNotFound(err) ? { kind: "missing" } : { kind: "error" });
    }
  }

  // A shared link (?tx=<hash>) checks itself.
  useEffect(() => {
    if (hash) void check(hash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 720,
        margin: "2rem auto",
        padding: "0 1rem",
        lineHeight: 1.5,
        color: "#f4f4f5",
      }}
    >
      <h1 style={{ marginBottom: 0 }}>
        Duck Pass <span style={{ color: YELLOW }}>checker</span>
      </h1>
      <p style={{ color: "#a1a1aa" }}>
        A Duck Pass links a QoreX wallet to a Qwakk account with one post-quantum signed
        transaction on QoreChain testnet (<code>{client.network.chainId ?? "qorechain-diana"}</code>).
        Paste its transaction hash. This page reads QoreChain directly and checks the proof
        itself: no Qwakk server involved.
      </p>

      <form
        style={{ display: "flex", gap: "0.5rem", marginTop: "1.5rem" }}
        onSubmit={(e) => {
          e.preventDefault();
          void check();
        }}
      >
        <input
          value={hash}
          onChange={(e) => setHash(e.target.value)}
          placeholder="Transaction hash (64 hex characters)"
          aria-label="Transaction hash"
          spellCheck={false}
          style={{ flex: 1, padding: "0.6rem", fontFamily: "ui-monospace, monospace", background: "#1f2024", color: "inherit", border: "1px solid #33343a", borderRadius: 8 }}
        />
        <button
          type="submit"
          disabled={result.kind === "loading"}
          style={{ padding: "0.6rem 1rem", background: YELLOW, color: DARK, border: 0, borderRadius: 8, fontWeight: 700, cursor: "pointer" }}
        >
          Check
        </button>
      </form>

      <section style={{ marginTop: "1.5rem" }} aria-live="polite">
        {result.kind === "loading" && <p>Asking QoreChain...</p>}
        {result.kind === "missing" && <p>QoreChain does not know this transaction (yet). If it was just sent, wait a few seconds and check again.</p>}
        {result.kind === "error" && <p style={{ color: "#ff8a3d" }}>QoreChain could not be reached. Try again in a moment.</p>}
        {result.kind === "invalid" && (
          <p style={{ color: "#ff8a3d" }} role="alert">
            Not a valid Duck Pass. {WHY[result.reason]}
          </p>
        )}
        {result.kind === "valid" && (
          <div style={{ border: `1px solid ${YELLOW}`, borderRadius: 12, padding: "1rem 1.25rem" }}>
            <p style={{ margin: 0, fontWeight: 700, color: YELLOW }}>Valid Duck Pass</p>
            <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.35rem 1rem", margin: "0.75rem 0 0" }}>
              <dt>Wallet</dt>
              <dd style={{ margin: 0, fontFamily: "ui-monospace, monospace", overflowWrap: "anywhere" }}>{result.proof.address}</dd>
              <dt>Season</dt>
              <dd style={{ margin: 0 }}>{result.proof.memo.season.replace(/^s/, "Season ")}</dd>
              <dt>Duck tag</dt>
              <dd style={{ margin: 0 }}>#{result.proof.memo.tag}</dd>
              <dt>Block</dt>
              <dd style={{ margin: 0 }}>{result.proof.height} ({result.proof.timestamp})</dd>
              <dt>Signature</dt>
              <dd style={{ margin: 0 }}>Hybrid secp256k1 + ML-DSA-87, verified by QoreChain (pqc_hybrid_verify)</dd>
            </dl>
            <p style={{ marginBottom: 0 }}>
              <a href={explorerTxUrl(result.proof.txHash)} target="_blank" rel="noopener" style={{ color: YELLOW }}>
                View on the explorer
              </a>
            </p>
          </div>
        )}
      </section>

      <p style={{ color: "#74757e", fontSize: 13, marginTop: "2rem" }}>
        Identity only: a Duck Pass carries no tokens, no rewards and no prizes. The 1 uqor goes
        straight back to the same wallet.
      </p>
    </main>
  );
}
