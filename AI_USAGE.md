# AI usage

Qwakk Island is designed and run by one builder, who uses Claude Code as the coding tool. This file explains how: which tools, how the work is split, what the builder did, what Claude Code wrote, and how the output is checked. Facts here can be checked against the commit history.

## Tools

- **Claude Code** (Anthropic), running Claude Opus models, in the terminal on the builder's machine. It runs a lead agent and specialist agents (code, art pipeline, docs, deploys, a read-only reviewer).
- **Blender**, run headless by Python scripts the AI writes, for every 3D model, animation and map. No AI image or 3D generator made the game's art: the ducks, weapons, hunters, castles and props are built by code, then rendered and approved by the builder.
- No other AI tool was used in this repository.

24 of the 29 commits in this repository (as of 15 November 2026) carry a `Co-Authored-By: Claude` trailer. The other 5 were committed by the builder without one: `c3570fb`, `2041400`, `5651898`, `7a141ca`, `32a9622`. They were written with Claude Code too; the builder committed them without adding the trailer.

## Workflow

### From a one-line request to a tested feature

The builder opens Claude Code in a workspace folder that holds this repo next to the DEX and the marketing site. They give short commands, often in Turkish ("add a co-op raid", "the duck spins upside down"). A lead agent turns each one into work:

1. **Architecture first.** The builder set the architecture before any code: a server-authoritative 30 Hz simulation, Three.js plus Rapier plus Colyseus, start small with bots, browser first. Research agents checked engines, netcode libraries and hosting against it, and the plan was written down point by point for the builder to approve.
2. **Brief.** The lead writes a full brief for each agent: the goal, the files, the facts already checked, the rules from `CLAUDE.md`, and what "done" means.
3. **Build in parallel.** Independent features run as separate agents in their own git worktrees, then get merged. For example, lobby rooms, the backpack, openable crates, aiming down sights, magazine reloads and detailed houses landed together in one commit (`f54eb56`).
4. **Review.** A read-only QA agent runs the checks below and reviews the diff against the rules. The lead fixes what it confirms.
5. **Report.** Each task ends with a plain report: what changed, how it was tested, and what was not tested (real phones, Safari, real GPUs, sound by ear).

Some large phases ran overnight. The builder read the report in the morning, played the build and decided what to keep.

### Rules the AI must follow

`CLAUDE.md` in this repo is binding for every agent. Among other things it says:

- The server is the only authority. Never trust a client message for hits, positions, damage or player identity.
- Never send an enemy the client cannot see (anti-wallhack). Bots follow the same sight rules as players.
- No crypto rewards in the game. Tüy, the soft currency, is earned only by playing, never sold, never tradeable, never a token, never linked to a wallet.
- Duck Pass: the server never signs, broadcasts or holds keys, and a linked wallet never touches Tüy, XP, rewards, the leaderboard or anything another player sees.
- No asset packs whose license bans blockchain projects. No em dashes in user-facing copy or docs.
- Commit or push only when the builder asks. Deploys and anything outward-facing need their approval.

## What the builder did

- **Architecture.** The server is the only authority, clients send inputs only, the anti-wallhack culling, the shared deterministic sim, one CapRover app for client and server. These rules come from the builder and are binding in `CLAUDE.md`.
- **Direction and taste.** What the game is, which modes come next, how it should feel. The builder approved the first procedural duck before the art pipeline was kept, and sends feedback after every play session.
- **Decisions the AI must not make.** Hosting on their own server, the lobby rules (3 humans start a countdown, bots fill the rest), guests only in deathmatch, no crypto rewards, the Duck Pass design.
- **Real-world testing.** Playing with a real mouse, keyboard and phone, which the AI cannot do.
- **Approvals and secrets.** DNS, CapRover apps, environment variables, mail settings and every deploy. Secrets live only in the server environment, never in the repository.

## What Claude Code wrote

- The shared simulation (movement, weapons, hitscan, zone, loot, heals), the Colyseus server (rooms, lag compensation, culling, bots, parties, accounts, the raid, the plaza) and the Three.js client (rendering, prediction, HUD, menus, touch controls).
- The Blender Python scripts behind every duck, animation clip, weapon and map, and the WebAudio code that synthesizes the sounds.
- Tests: 619 unit tests at the 24 October check, plus browser end-to-end scripts that drive real headless Chrome players through deathmatch, battle royale, parties, mobile controls, accounts, the raid and the plaza.
- Operations work: the Docker image, the CapRover deploy runbook (`docs/deploy.md`) and the deploy steps, run only with the builder's approval. The admin panel for running the live game.
- The docs, including this file, and the draft legal pages (terms, privacy, cookies), which a lawyer should still review.

## How the output is checked

- `npm test`, typecheck and build on every change.
- Browser end-to-end runs with two or more real headless Chrome players, checking that prediction errors stay at zero and that culling works.
- Headless bot matches and benchmarks for server CPU and bandwidth.
- One QA agent review per change, then the builder's own play test.

## Where Claude Code was wrong, and how it was caught

- **The spinning duck.** Procedural bone rotations stacked frame after frame and flipped the duck upside down. The builder saw it in their first play session; the fix restores the base pose each frame (`dac3afc`).
- **A raid exploit.** Hunters stuck at a raised drawbridge could let a team clear a wave without fighting. Caught in review before release (`bf5720f`).
- **A bridge that lifted under a duck.** Also caught in review and fixed in the same commit.

## Fest work: Duck Pass

Duck Pass was built the same way, during the fest.

- **Research.** The AI inspected the QoreX extension's shipped code across several versions and found that it offers `signAndBroadcast` to any site but no message signing for third-party sites. So the link is proven with one tiny hybrid-signed (secp256k1 + ML-DSA-87) self transfer with a single-use code in the memo, instead of a signed message.
- **Build.** On 14 November the AI wrote the shared proof rules, the server check, the Duck Pass card in the account screen, the standalone checker (started from `create-qorechain-dapp`), the tests (memo, transaction bytes, proof check, signer address, server rules against a fake chain, the menu flow against a fake QoreX, the database routes) and the privacy and terms updates. All of it is one commit, `2238356`.
- **Deploy.** The same day it went live on play.qwakk.fun with the builder's approval: the database migration was applied and the smoke checks passed.
- **The builder.** They approved the design, including the rule that a linked wallet never touches Tüy, XP, rewards or the leaderboard. On 15 November 2026 they linked their own QoreX wallet on the testnet, the first real run ([proof transaction](https://explore.qore.network/tx/5425E98D0D8896956FBF38A3FC65656BEB3E6BEB3CFFA86ADF7396ADF3FEADAA)). What a linked duck shows in game is still their call.
