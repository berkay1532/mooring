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

**D1 (card contract) and D2 (x402 integration) are delivered; D3 (web app, docs,
evidence package) is next.** D1 landed in PR #1; D2 lands in the pull request
that carries this change.

- **Card contract** (`contracts/card`) — implemented: `__check_auth` policy
  enforcement (periodic budget, per-tx cap, merchant allowlist, expiry,
  frozen/cancelled), owner operations, `info()` view. Unit-tested.
- **Factory** (`contracts/factory`) — implemented: deterministic
  `create_card` with an owner-bound salt, `card_created` event.
- **Testnet deployment** — `scripts/testnet/deploy.sh` deploys the factory and
  one card; `scripts/agent` signs card authorization entries and submits
  payments. See `docs/testnet.md`.
- **x402 integration** — implemented: `@mooring/x402-client` (the card pays
  x402-protected APIs, with a local policy pre-check and typed denials),
  the `mooring` CLI, and an example `@x402/express` merchant server. A card
  payment settled on testnet through the OpenZeppelin Channels facilitator;
  see `docs/x402-integration.md` and the D2 evidence in `docs/testnet.md`.
- **Web app and evidence package** — next.

## Pay an API from a card

```ts
import { Keypair } from "@stellar/stellar-sdk";
import { CardPolicyDenied, createMooringFetch, getSettlement } from "@mooring/x402-client";

const fetchWithPayment = createMooringFetch({
  card: "CAJPWJBF…AHCJ",                                 // card contract address (the payer)
  agent: Keypair.fromSecret(process.env.AGENT_SECRET!),  // the card's registered signer
  network: "stellar:testnet",
});

try {
  const res = await fetchWithPayment("http://localhost:3001/weather");
  console.log(await res.json(), getSettlement(res)?.transaction);
} catch (err) {
  if (err instanceof CardPolicyDenied) console.error(err.reason, "at", err.stage);
  else throw err;
}
```

Or from the CLI (not published to npm yet — run it from the workspace):

```sh
npm ci && npm run build
alias mooring="node $PWD/packages/cli/dist/index.js"

mooring keygen --hex                        # a new agent keypair (--hex prints the signer bytes)
mooring status --card C… --json             # policy, period, remaining budget, allowlist
AGENT_SECRET=S… mooring pay http://localhost:3001/weather --card C…
```

A policy denial exits with code 2 and names the reason and the stage it was caught
at. See [`packages/x402-client/README.md`](packages/x402-client/README.md) and
[`docs/x402-integration.md`](docs/x402-integration.md) — which also covers running
the example merchant server in `examples/merchant-server`.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Rust | 1.96 | pinned in `rust-toolchain.toml` |
| `wasm32v1-none` target | — | installed by the toolchain file |
| `stellar` CLI | ≥ 26 | required by `make build` (the factory needs `stellar contract build`) |
| `jq` | any | used by the testnet scripts |
| Node.js | 20+ | for the npm workspaces (`packages/*`, `examples/*`, `scripts/agent`) |

## Build and test

```sh
make build   # card wasm (cargo) + factory wasm (stellar contract build)
make test    # make build, then cargo test --workspace
make lint    # cargo fmt --check + clippy -D warnings
```

The TypeScript workspaces (`packages/*`, `examples/*`, `scripts/agent`) build and
test from the repo root:

```sh
npm ci
npm run build      # @mooring/x402-client, then @mooring/cli, then the rest
npm run typecheck
npm test           # unit tests (vitest); no network
```

The scripts under `scripts/testnet`, `npm run pay|race` and `npm run e2e` submit
real testnet transactions; they are never run in CI.

## Documentation

- `docs/design.md` — architecture and product scope
- `docs/spike-w1-auth-mechanism.md` — why the card authorizes a plain SAC `transfer`
- `docs/x402-integration.md` — how a card pays an x402 API: flow, denial semantics, setup
- `docs/testnet.md` — deployment, payment walkthrough and testnet evidence
- `packages/x402-client/README.md` — the agent-side client package

## License

Apache-2.0 — see [LICENSE](LICENSE).
