# Mooring — Project Context (CLAUDE.md)

> This file is the context bridge for any Claude Code session working in this repo.
> It carries the decisions made during brainstorming so a fresh session can continue the build.

## What Mooring is

**Programmable spending allowances for AI agents on Stellar.** Each spending "card" is a
**native Soroban custom account** (`__check_auth`) that holds USDC and lets an agent pay
**per request** for [x402](https://x402.org)-protected services within a hard **on-chain
budget, merchant allowlist, and expiry**. Non-custodial: funds live in the card under the
owner's control; over-limit / unauthorized / expired payments are rejected at settlement.

**Mooring is a production product, not a demo.** The SCF sprint ships a production-quality v1 on
testnet; mainnet follows an audit. Never describe the web app or the client as a "demo".

## Conventions

- Repo language: **English only** (all code, comments, docs, commits).
- All code is written fresh for Stellar/Soroban (net-new).
- See `CLAUDE.local.md` (local, not committed) for build-context notes.

## Award / sprint context

- **First month (SCF Instaward #2) — DELIVERED.** ~30-day sprint, nominal start **2026-08-11**,
  run from the real start. D1–D3 below are its deliverables (all merged). Budget **$5,000**.
- **Second month — APPROVED 2026-11-23, IN PROGRESS.** 30-day window runs from the approval
  date. Budget **$5,000**, split D1 35% / D2 40% / D3 25%. Full SOW (git-ignored):
  `instawards/2026-11-instaward-2nd-month-sow.md`; customer development plan next to it.
  - **D1 — Discovery & onboarding:** (a) merchant directory ("Browse services" in the wizard and
    on the card screen, fed server-side from Rail402, StellarSight, MPP Router and the CDP x402
    Bazaar, hourly cache, "Add" via the existing resolver + confirmation modal); (b) `npx
    create-mooring-agent` + a hosted example seller on `api.mooring.live`; (c) `@mooring-live/mcp`
    MCP server (`list_services`, `card_status`, `pay`, `explain_denial`) + a Mooring skill.
  - **D2 — Indexer, activity, alerts:** (a) indexer v1 (Node + Neon Postgres, factory/card events,
    read API, activity feed, merchant-name sync); (b) `mooring create` in the CLI using the app's
    index-based salt so CLI cards are discovered everywhere; (c) e-mail/webhook alerts (denial,
    low balance, threshold, 80% of period) + per-card CSV export.
  - **D3 — Protocol coverage & agent-side safety:** (a) MPP charge in the client/CLI behind one
    `pay()`; (b) guard parity (local caps, `stop()`, reservations, signed receipt ledger);
    (c) `stellar:pubnet` config behind a flag, simulation-level fee/flow check, mainnet runbook draft.
  - **Weekly plan:** W1 D1(a) + D2(b) · W2 D2(a) · W3 D3(a) + D3(b) + D1(b) · W4 D1(c) + D2(c) +
    D3(c) + docs/Loom/evidence. Evidence list in SOW §6.1 (hashes, screenshots, Loom, npm packages).
  - **Progress:** W1 delivered (PRs #24–#27: directory, `mooring create`, protocol-30 SDK bump, evidence
    in `docs/testnet.md`). W2 delivered: indexer v1 (PR #28, design
    `docs/superpowers/specs/2026-11-25-indexer-v1-design.md`, runbook `docs/indexer.md`, Neon via Vercel
    Marketplace, Hobby plan → read-time ticks + daily cron) **live on app.mooring.live since 2026-11-26**
    with the full history since 2026-09-13 imported; evidence in `docs/testnet.md`.
  - **Out of scope:** audit, real mainnet deployment, merchant-side product, recurring billing,
    passkey signer, other chains.
- Chapter: **Stellar Türkiye** (lead **İrem Koçi**). **testnet-only.** License **Apache-2.0**.

## Architecture (agreed)

- **Card = a Soroban custom account instance** (its own address). It **holds USDC** (via SAC).
  The owner controls it (freeze / unfreeze / cancel / withdraw / set_policy / set_signer /
  allowlist / set_label — an on-chain, owner-settable label); an **agent key is the signer**.
  Card code is immutable; config is owner-mutable.
- Policy enforced at the **authorization boundary**: **periodic budget** (resets each period, no carry-over) +
  **merchant allowlist** + **expiry** + **frozen/cancelled** state. No shadow ledger — the
  policy lives in the auth path.
- An x402 payment = a **USDC transfer from the card** to the merchant, gated by the card's
  policy. Built on **`@x402/stellar`** (Apache-2.0) + the OZ Channels facilitator.
- Non-custodial throughout.

### W1 SPIKE — RESOLVED (2026-09-08)
**Option A: `__check_auth` on a standard SAC `transfer`.** The facilitator requires the invoked
contract to be the asset and the function to be `transfer`, so a guarded `pay()` entrypoint is not
viable. `__check_auth` must allow exactly one context (`token.transfer(self, to, amount)`) and
reject everything else (e.g. `approve`). Details: `docs/spike-w1-auth-mechanism.md`.
Open measurement **closed**: card-paid transfers cost 33 926 stroops (1 merchant) and 49 380
stroops (full 32-merchant allowlist), and OZ Channels settled one at `max_fee` 51 175 — so
custom-account auth fits inside the real facilitator ceiling. Numbers and the reduction levers
are recorded in the "Open measurement" section of `docs/spike-w1-auth-mechanism.md`.

### Testnet deployment v2 (on-chain card label, 2026-09-13)
D3-A added an owner-settable on-chain `label` to the card constructor and `set_label`, which
required a new card WASM and a redeployed factory + card (existing cards cannot gain the field).
The previous card's funds were migrated to the new one. Full addresses, migration tx hashes, and
the re-measured fees (1-merchant and 32-merchant, with the label's storage cost isolated) are in
`docs/testnet.md` under "Deployment v2 (on-chain label, 2026-09-13)"; that section supersedes the
D1/D2 addresses earlier in the same file.

## Scope — 3 deliverables (see instawards/instaward-2-sow.md for the full SOW)

- **D1 — Card contract (Soroban custom account):** budget + expiry + freeze/cancel + withdraw +
  policy; TDD unit tests; deployed to testnet with ≥1 on-chain policy rejection.
- **D2 — x402 integration:** x402 server (`@x402/stellar`) + agent client (detect 402 → local
  policy check → sign → retry); settled testnet payment with on-chain budget decrement; allowlist
  added here.
- **D3 — Web app + docs + evidence:** Stellar-native card panel (Freighter / Wallets Kit):
  create/fund card, live budget/balance, freeze/cancel/withdraw, allowlist, policy edit, signer
  rotation, agent key generation; quickstart + architecture docs; evidence package (tx hashes, CI).

### Weekly plan
- **W1 (done):** facilitator/settlement spike + card contract core + TDD tests + testnet deploy.
- **W2 (done):** x402 server + settlement wiring (card as payer) + e2e integration test.
- **W3 (done):** `@mooring-live/x402-client` npm package + `mooring` CLI + allowlist.
- **W4 (done):** web app (`apps/web` — card panel, wizard, owner ops; 257 unit tests + 20
  Playwright flows in CI), documented (`docs/web-app.md`), deployed to Vercel
  (https://app.mooring.live), live testnet checklist run on 2026-09-25 (hashes + screenshots
  in `docs/web-app.md` / `docs/testnet.md`), merged in PR #4.

**All three deliverables are delivered** (D1 in PR #1, D2 in PR #2, D3-A in PR #3, D3-B in PR #4) —
evidence in `docs/testnet.md`, the integration guide in `docs/x402-integration.md`, the web app guide
in `docs/web-app.md`. Remaining work is the post-sprint roadmap below.

### Roadmap after the first month
Shipped since (v1.1): merchants added by service URL (402 resolution) + `/allow` denial links
(PR #15), confirmation modal (PR #16), brand + mascot "Bitt" (`brand/`). **Now:** the second-month
Instaward scope above (directory, indexer, MPP charge, MCP, alerts, pubnet prep). **Next sprint
(v2):** Soroban Audit Bank audit, mainnet, merchant side (registration / receiving / incoming
payments). Never: recurring billing with fee split, passkey signer (until a wallet can sign
Soroban auth entries for a C address).

## Tech stack
Rust / Soroban (contracts) · `@x402/stellar` + OZ Channels facilitator (payments) ·
USDC via SAC (SEP-41) · Freighter / Wallets Kit + JS stellar-sdk (web app) · Stellar **testnet**.

## Reference resources (consult these)
- **stellar-raven MCP** — connected at **user scope** (available here too). If tools aren't
  live, run `/mcp` → stellar-raven → Authenticate. Tools: `search` + `execute`.
- **Skills** (installed, available in this session):
  - `stellar-dev:agentic-payments` — x402 on Stellar (read `x402.md`): OZ Channels facilitator,
    USDC SEP-41 SAC, testnet flow. **Primary source for the W1 spike (x402 side).**
  - `stellar-dev:soroban` — Soroban contracts: `__check_auth`, custom accounts, storage, auth,
    testing. **Primary source for the card contract.**
  - `stellar-dev:dapp` — Freighter / Wallets Kit / contract invocation (web app).
  - `openzeppelin-stellar.setup-stellar-contracts` (via Raven) — workspace scaffold + OZ patterns.
- **Soroban docs** via Raven: `stellarDocs.search_soroban_contract_docs` (`__check_auth`, custom accounts).

## Build workflow (superpowers)
Brainstorming is **done** (design + SOW agreed — see docs/design.md and the SOW). W1 spike is
**done** (docs/spike-w1-auth-mechanism.md). Next steps:
`superpowers:writing-plans` (implementation plan) → `superpowers:subagent-driven-development`
(TDD build, task by task). Use TDD, frequent commits, CI green.

## Commit attribution
End commits with:
```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```
Workflow: branch off `main` per deliverable or task group → frequent commits → push → PR →
CI green → merge (owner's standing instruction since 2026-09-12). Never push to `main` directly;
never force-push.
