# Duck Pass checker

A small page that checks a Qwakk **Duck Pass** straight from QoreChain, with no Qwakk server in the loop. A Duck Pass links a QoreX wallet to a Qwakk game account with one hybrid-signed (secp256k1 + ML-DSA-87) transaction on the QoreChain testnet (`qorechain-diana`): 1 uqor from the wallet to itself with the memo `qwakk-duck-pass:v1:<season>:<duck tag>:<nonce>`. Identity only: no tokens, no rewards, no prizes. The game side is described in the repo README (Duck Pass) and `docs/accounts.md`.

Paste a transaction hash, or open `?tx=<hash>`. The page reads the transaction with `@qorechain/sdk` (`createClient` on testnet, `getTx`) and runs the same rules the game server links a wallet with (`../packages/shared/src/duckPass.ts`): code 0, exactly one 1 uqor self send, a Duck Pass memo, one signer, the `PQCHybridSignature` body extension and the chain's `pqc_hybrid_verify` event with status `verified` for the wallet. It also derives the address from the signer's public key (`sha256`, `ripemd160`, `bytesToBech32` from the SDK) and checks it is the wallet.

## Where it came from

Scaffolded with the official QoreChain starter, then adapted:

```sh
npx create-qorechain-dapp@0.14.0 duck-pass --template fullstack-web --network testnet --yes --no-install
```

Kept from the `fullstack-web` template: Vite + React + TypeScript, `@qorechain/sdk`, the `/lcd` REST proxy and the `.env` layout. Replaced: the balance and tokenomics demo in `src/App.tsx` with the checker.

## Run it

Node 20 or newer.

```sh
npm install
cp .env.example .env   # testnet endpoints (the scaffolder wrote them for testnet)
npm run dev            # http://localhost:5173 (use --port 5175 if the game's client runs)
npm run build          # type-check + production build
```

| Variable | Purpose | Default |
| --- | --- | --- |
| `VITE_QORE_REST_URL` | Native REST the page reads | `/lcd` (the dev and preview proxy) |
| `QORE_REST_PROXY_TARGET` | Where `/lcd` goes | `https://api-testnet.qore.host` |
| `VITE_QORE_EVM_RPC_URL` | Unused by the checker, kept from the template | `https://evm-testnet.qore.host` |

The public REST API sends no CORS headers, so the browser reaches it through the Vite dev and preview servers (`/lcd`, see `vite.config.ts`). A hosted copy needs a reverse proxy that forwards `/lcd` to the testnet REST the same way.

This folder is not an npm workspace of the game: it has its own `package.json` and lockfile so the SDK's dependency tree stays out of the game's images.

This folder started from the `create-qorechain-dapp` 0.14.0 template by QoreChain, licensed under Apache-2.0 (copy in [LICENSE-APACHE-2.0](LICENSE-APACHE-2.0)). The files that came from the template keep that licence; our own changes are MIT, like the rest of the repo.
