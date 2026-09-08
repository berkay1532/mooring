# Mooring — Design

> Mooring is a **production product**, not a demo. The SCF sprint delivers a production-quality
> v1 on testnet; mainnet follows a security audit. See "Product roadmap" below.

Status: agreed via brainstorming (2026-08). W1 spike **resolved 2026-09-08** — see
`docs/spike-w1-auth-mechanism.md`. Next: implementation plan (`superpowers:writing-plans`).

## Problem
Autonomous agents need to pay per request (APIs, inference, data, tools) without a human
approving each payment. Today that means either a raw key the agent can drain, or a human in the
loop that kills autonomy. Stellar has no primitive for **bounded, chain-enforced** delegation of
spending to an agent.

## Solution
A non-custodial **spending-policy card** = a Soroban custom account that holds USDC and enforces
a spending policy on every payment. Delegate the card to an agent as its signer; the agent pays
x402 services per request within limits the network enforces.

## Components (all net-new Stellar code)
1. **Card contract (Soroban / Rust)** — the core. Each card is a deployed instance with its own
   address, holding USDC.
   - Storage: `owner`, `signer` (agent key), `token` (any SEP-41; USDC default), `period_amount`,
     `period_duration`, `period_start`, `spent_in_period`, `max_per_tx`, `expiry`,
     `state` (Active/Frozen/Cancelled), allowlist as persistent `Allowed(Address)` keys (bounded).
   - Owner ops: `freeze`, `unfreeze`, `cancel` (freeze + sweep to owner), `withdraw`,
     `add_merchant`, `remove_merchant`, `set_policy` (budget / cap / duration / expiry),
     `set_signer` (agent key rotation); anyone: `bump` (TTL). Funding = send USDC to the card address.
   - Policy: periodic budget that **resets** each period (no carry-over), per-tx cap, expiry,
     merchant allowlist, frozen/cancelled. Enforced in `__check_auth` on exactly one
     `token.transfer(self, to, amount)` context; any other context is rejected.
   - Card **code** is immutable (no upgrade entrypoint); **configuration** (policy, signer,
     allowlist) is owner-mutable. A **factory** deploys cards (`deploy_v2` + constructor) and
     emits `card_created(owner, card)` so the app can list them. New contract versions ship as a
     new factory; owners migrate by `cancel` (sweeps funds) + create.
2. **x402 server** (on `@x402/stellar`) — a 402-protected endpoint that verifies + settles agent
   payments pulled from the card.
3. **Agent client** — detects the 402 challenge, checks card policy locally (budget / per-tx cap /
   allowlist), signs the authorization with a custom `ClientStellarSigner` whose `address` is the
   card and whose key is the agent's, retries, handles denials (verify-time simulation failure
   and settle-time failure both mean "policy denied").
4. **Web app** (Stellar-native, Freighter / Wallets Kit connect):
   - *Card panel* — create / fund card, live budget & balance, freeze / unfreeze / cancel /
     withdraw, allowlist, policy edit, signer rotation. (SCF sprint scope.)
   - *Agent key management* — generate an agent keypair in the browser, show it once, produce a
     ready `.env` for the agent; rotate via `set_signer`. (SCF sprint scope.)
   - *Activity history* — payments and owner actions per card, backed by Mooring's own indexer
     (RPC keeps events ~7 days; policy rejections happen at simulation and leave no on-chain
     trace, so the agent client reports them to the indexer). (Post-sprint.)
   - *Merchant side* — x402 provider registration, receiving address, incoming payments.
     (Post-sprint.)
5. **Distribution** — `@mooring/x402-client` npm package (card signer + x402 client scheme +
   local policy pre-check, plugs into `@x402/fetch`), a `mooring` CLI (`keygen`, `status`, `pay`),
   and a hosted example merchant API anyone can pay with a card.

## Data flow (end to end)
```
agent → GET /api            server: 402 + payment terms
agent client                check card policy locally (budget / allowlist / expiry)
                            sign an authorization on behalf of the card
facilitator                 submit tx: USDC.transfer(from=card, to=merchant, amount)
card auth boundary          enforce policy: budget? allowlist? expiry? frozen?
                            OK → transfer + update spent_in_period ; else → revert
server → 200 + resource
```
Funds live inside the card, owner-controlled the whole time (non-custodial).

## W1 SPIKE — resolved
Decision: **Option A — `__check_auth` on a standard SAC `transfer`.** The `@x402/stellar`
facilitator only accepts `asset.transfer(from, payTo, amount)` with `from` signed, so a custom
`pay()` entrypoint cannot be used. Full reasoning, facilitator checks, signer shape, and the
`__check_auth` contract are in `docs/spike-w1-auth-mechanism.md`. One measurement remains
open (facilitator fee ceiling vs. custom-account auth cost) and is the first testnet task.

## Product roadmap
| Phase | Scope | Network |
|---|---|---|
| **v1 (SCF sprint, ~30 days)** | Card contract + factory, x402 integration, npm client, CLI, card panel + agent key management, docs, evidence | testnet |
| **v1.1** | Indexer + activity history, hosted example merchant API, landing waitlist → onboarding | testnet |
| **v2 (mainnet)** | Soroban Audit Bank audit, mainnet deployment, OZ Channels mainnet key (or self-hosted facilitator), merchant side | mainnet |

## Why Stellar
- Native account abstraction (Soroban custom accounts) → policy in the auth path, no shadow ledger.
- Contract-native authorization → agent-signed payments gated by the card's policy at settlement.
- Sub-cent fees → per-request micropayments viable. USDC first-class via SAC. Optional passkey signers.

## Testing
- Contract: TDD unit tests — budget reset, policy update, signer rotation, over-budget deny, expired deny, frozen deny, allowlist
  deny, withdraw authorization.
- Integration: testnet e2e — agent pays a real x402 call, budget decrements on-chain.
- Client: policy pre-check + retry unit tests.
- Evidence: testnet tx hashes (pass + rejections), CI green.
