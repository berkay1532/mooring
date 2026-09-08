# Mooring

**Programmable spending allowances for AI agents on Stellar.**

Mooring lets you delegate spending to an autonomous agent with hard, on-chain
limits. Each spending-policy **card** is a native Soroban custom account
(`__check_auth`) that holds USDC and enforces policy at the authorization
boundary — a periodic budget, a merchant allowlist, and an expiry — so an agent
can pay for [x402](https://x402.org)-protected services **per request** while
over-budget, unauthorized, or expired attempts are rejected on-chain.

Non-custodial throughout: funds live in the card under the owner's control; no
third party ever holds them.

## Why Stellar

- **Native account abstraction.** Soroban custom accounts put the spending
  policy *inside* the authorization path — no separate allowance ledger to keep
  in sync.
- **Contract-native authorization.** A contract can authorize a specific call
  natively, so an agent-signed payment is gated by the card's policy at
  settlement.
- **Sub-cent fees.** Per-request micropayments are economically viable.
- **USDC first-class** via the Stellar Asset Contract; optional passkey
  (secp256r1) signers for real card UX.

## Status

Active development, **Stellar testnet only** — not audited, not on mainnet.

- **Card contract** (`contracts/card`) — implemented: `__check_auth` policy
  enforcement (periodic budget, per-tx cap, merchant allowlist, expiry,
  frozen/cancelled), owner operations, `info()` view. Unit-tested.
- **Factory** (`contracts/factory`) — implemented: deterministic
  `create_card` with an owner-bound salt, `card_created` event.
- **Testnet deployment** — `scripts/testnet/deploy.sh` deploys the factory and
  one card; `scripts/agent` signs card authorization entries and submits
  payments. See `docs/testnet.md`.
- **x402 integration, web app, evidence package** — in progress.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Rust | 1.96 | pinned in `rust-toolchain.toml` |
| `wasm32v1-none` target | — | installed by the toolchain file |
| `stellar` CLI | ≥ 26 | required by `make build` (the factory needs `stellar contract build`) |
| `jq` | any | used by the testnet scripts |
| Node.js | 20+ | for `scripts/agent` |

## Build and test

```sh
make build   # card wasm (cargo) + factory wasm (stellar contract build)
make test    # make build, then cargo test --workspace
make lint    # cargo fmt --check + clippy -D warnings
```

The agent scripts type-check with `cd scripts/agent && npm ci && npx tsc --noEmit`.
The scripts under `scripts/testnet` and `npm run pay|race` submit real testnet
transactions; they are never run in CI.

## Documentation

- `docs/design.md` — architecture and product scope
- `docs/spike-w1-auth-mechanism.md` — why the card authorizes a plain SAC `transfer`
- `docs/testnet.md` — deployment and payment walkthrough

## License

Apache-2.0 — see [LICENSE](LICENSE).
