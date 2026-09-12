# @mooring/x402-client

Pay [x402](https://x402.org)-protected APIs from a **Mooring spending card** on Stellar.

A card is a Soroban custom account (`__check_auth`) that holds USDC and enforces a spending
policy — periodic budget, per-payment cap, merchant allowlist, expiry, freeze/cancel — inside the
authorization path. This package is the agent-side client: it detects a `402`, checks the card's
policy locally, signs the payment with the agent key so the **card** is the payer, and turns every
refusal into one typed error instead of a bare `402`.

The server side stays stock x402 (`@x402/express` + `@x402/stellar` + the OpenZeppelin Channels
facilitator); only the client scheme is Mooring's, because the stock one cannot sign for a
contract account.

Apache-2.0. **Stellar testnet only** — not audited, not on mainnet.

## Install

Not published to npm yet. Use it from the workspace (`npm ci && npm run build` at the repo root),
or add it as a file dependency:

```sh
npm i file:../mooring/packages/x402-client @stellar/stellar-sdk
```

Requires Node.js 20+.

## Usage

```ts
import { Keypair } from "@stellar/stellar-sdk";
import { CardPolicyDenied, createMooringFetch, getSettlement } from "@mooring/x402-client";

const fetchWithPayment = createMooringFetch({
  card: "CAJPWJBF…AHCJ",                                 // card contract address (the payer)
  agent: Keypair.fromSecret(process.env.AGENT_SECRET!),  // the card's registered signer
  network: "stellar:testnet",
});

const res = await fetchWithPayment("https://api.example.com/weather");
console.log(await res.json());
console.log("settled:", getSettlement(res)?.transaction);
```

That is the whole integration: `fetchWithPayment` is a drop-in `fetch`. A `402` is answered by
paying from the card and retrying; a `200` carries a `PAYMENT-RESPONSE` header that
`getSettlement` decodes into `{ success, transaction, network, payer }`, where `payer` is the
card.

## Handling a denial

```ts
try {
  await fetchWithPayment(url);
} catch (err) {
  if (err instanceof CardPolicyDenied) {
    // err.reason: "over_budget" | "not_allowlisted" | "expired" | …
    // err.stage:  "precheck" | "simulate" | "verify" | "settle"
    // err.contractError: the card's error code, when the contract spoke (1–8)
    console.error(`payment refused: ${err.reason} at ${err.stage}`);
  } else {
    throw err; // a network/server problem, not a policy decision
  }
}
```

**Denied payments are never retried automatically**, at any stage.

### Stages

| Stage | When | Reached the network? |
|---|---|---|
| `precheck` | the local policy mirror refused, before anything was signed | two read-only simulations of the card's views |
| `simulate` | the card's own `__check_auth` refused, in the enforcing simulation the client runs after signing | no — nothing left the process, no fee paid |
| `verify` | the facilitator refused the payload | yes; nothing submitted on-chain |
| `settle` | the settlement transaction failed on-chain | yes; a transaction was submitted and failed |

### Reasons

`frozen`, `cancelled`, `expired`, `not_allowlisted`, `over_per_tx_cap`, `over_budget`,
`wrong_token`, `insufficient_balance`, `bad_signature`, `wrong_context`, `unknown`.

Card contract codes map as #1 `bad_signature`, #2 `wrong_context`, #3 `frozen`, #4 `cancelled`,
#5 `expired`, #6 `not_allowlisted`, #7 `over_per_tx_cap`, #8 `over_budget`. `wrong_token` and
`insufficient_balance` are pre-check-only verdicts; `unknown` covers anything unclassifiable,
including a card that could not be read (the pre-check fails **closed**).

## Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `card` | `string` | — | card contract address (`C…`); it is the payer |
| `agent` | `Keypair` | — | the card's registered signer |
| `network` | `"stellar:testnet" \| "stellar:pubnet"` | — | CAIP-2 network |
| `rpcUrl` | `string` | testnet default; **required** on pubnet | Soroban RPC endpoint |
| `precheck` | `boolean` | `true` | run the local policy mirror before signing |
| `onDenial` | `(d: CardPolicyDenied) => void` | — | called at every denial stage |
| `fetch` | `typeof fetch` | `globalThis.fetch` | transport (`createMooringFetch` only) |

## API

| Export | What it does |
|---|---|
| `createMooringFetch(opts)` | a `fetch` that pays from the card and rejects with `CardPolicyDenied`; builds a fresh client per call, so it is safe to share |
| `createMooringClient(opts)` | the underlying `x402Client`. **Single-flight per instance** — x402's hooks carry no request identity, so build one per payment |
| `getSettlement(res)` | decodes `PAYMENT-RESPONSE`; `null` when absent or undecodable (a settlement you cannot read is not a failed payment) |
| `CardPolicyDenied`, `DenialReason`, `DenialStage`, `CARD_ERROR_CODES`, `classifyContractError` | typed denials |
| `precheck(info, merchants, terms, now)` | the local policy mirror, on its own |
| `readCardInfo(rpcUrl, passphrase, card)`, `readMerchants(…)` | read-only card views (`info()`, `merchants()`) |
| `CardExactStellarScheme` | the x402 `exact` scheme client whose payer is the card |
| `signCardAuthEntries(tx, card, agent, expirationLedger)` | signs a card auth entry with the agent key |

## Notes

- The pre-check is **advisory**. The card contract is the authority and runs again at settlement;
  the pre-check only avoids spending a signature and a round-trip on an obvious refusal.
- Muxed (`M…`) destinations are not payable — a Soroban `Address` does not exist for them.
- The client records legacy (v1) auth credentials (`useUpgradedAuth: false`) because the deployed
  OZ Channels stack rejects CAP-71 `ADDRESS_V2` as malformed. Transitional; see
  `docs/x402-integration.md`.

Full guide: [`docs/x402-integration.md`](../../docs/x402-integration.md). Testnet evidence:
[`docs/testnet.md`](../../docs/testnet.md).
