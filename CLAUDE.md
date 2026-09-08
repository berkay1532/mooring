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

- **SCF Instaward #2 — APPROVED.** ~30-day sprint. Nominal start was **2026-08-11**;
  actually starting later (approval came late) — that's fine, run the 30-day window from the
  real start.
- Budget **$5,000**, milestone-based. Chapter: **Stellar Türkiye** (lead **İrem Koçi**).
- **testnet-only.** License **Apache-2.0**.

## Architecture (agreed)

- **Card = a Soroban custom account instance** (its own address). It **holds USDC** (via SAC).
  The owner controls it (freeze / unfreeze / cancel / withdraw / set_policy / set_signer /
  allowlist); an **agent key is the signer**. Card code is immutable; config is owner-mutable.
- Policy enforced at the **authorization boundary**: **periodic budget** (with rollover) +
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
Open measurement: facilitator fee ceiling vs. custom-account auth cost — first testnet task.

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
- **W1:** facilitator/settlement spike + card contract core + TDD tests + testnet deploy.
- **W2:** x402 server + settlement wiring (card as payer) + e2e integration test.
- **W3:** `@mooring/x402-client` npm package + `mooring` CLI + allowlist.
- **W4:** web app (card panel + agent keys) + docs + evidence package.

### Post-sprint roadmap (not in the 30-day SOW)
v1.1: indexer + activity history, hosted example merchant API. v2: Soroban Audit Bank audit,
mainnet, merchant side (registration / receiving / incoming payments). Never: recurring billing
with fee split, passkey signer (until a wallet can sign Soroban auth entries for a C address).

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
Branch off `main` for feature work; commit/push only when the owner asks.
