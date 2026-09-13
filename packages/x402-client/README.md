# @mooring/x402-client

Pay [x402](https://x402.org)-protected APIs from a **Mooring spending card** on Stellar.

A card is a Soroban custom account (`__check_auth`) that holds USDC and enforces a spending
policy — periodic budget, per-payment cap, merchant allowlist, expiry, freeze/cancel — inside the
authorization path. This package is the agent-side client: it detects a `402`, checks the card's
policy locally, signs the payment with the agent key so the **card** is the payer, and turns every
refusal into a typed error instead of a bare `402` — `CardPolicyDenied` when the card's policy
said no, `PaymentError` for everything else.

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
import { CardPolicyDenied, PaymentError, createMooringFetch, getSettlement } from "@mooring/x402-client";

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

## Handling a refusal

```ts
try {
  await fetchWithPayment(url);
} catch (err) {
  if (err instanceof CardPolicyDenied) {
    // err.reason: "over_budget" | "not_allowlisted" | "expired" | …
    // err.stage:  "precheck" | "simulate" | "verify" | "settle"
    // err.contractError: the card's error code, when the contract spoke (1–8)
    console.error(`payment refused: ${err.reason} at ${err.stage}`);
  } else if (err instanceof PaymentError) {
    // Not the card's verdict. err.kind: "rejected" | "unconfirmed"
    console.error(`payment ${err.kind}: ${err.detail}`, err.transaction);
  } else {
    throw err; // a network/server problem the client did not classify
  }
}
```

**Failed payments are never retried automatically**, at any stage.

`CardPolicyDenied` means exactly one thing: **the card's policy refused**. Everything else is a
`PaymentError`, so a caller can treat the first as a policy decision without further checks.

| `PaymentError.kind` | When | Was the card debited? |
|---|---|---|
| `rejected` | the facilitator refused before submitting — a malformed payload, a fee above its ceiling, an expiration too far out, a 5xx — or the client's own CAP-71 credential guard fired before signing | no |
| `unconfirmed` | the settlement state is unknown or contradictory: the server reported a failure for a transaction the ledger accepted, the transaction was never observed within the reconciliation window, or the server answered a bare `402` with no `PAYMENT-REQUIRED` and no `PAYMENT-RESPONSE` | possibly — reconcile `err.transaction` and the card's `spent` before retrying |

The facilitator answers `settle_exact_stellar_transaction_failed` both for a transaction the
ledger rejected and for one it stopped waiting for, so a settle failure carrying a hash is
reconciled against the RPC (~10 s) before it is named: a transaction the ledger accepted is never
reported as a policy denial.

### Stages

| Stage | When | Reached the network? |
|---|---|---|
| `precheck` | the local policy mirror refused, before anything was signed | two read-only simulations of the card's views |
| `simulate` | the card's own `__check_auth` refused, in the enforcing simulation the client runs after signing | no — nothing left the process, no fee paid |
| `verify` | the facilitator refused the payload | yes; nothing submitted on-chain |
| `settle` | the settlement transaction failed on-chain — confirmed with the RPC, and attributed to the card only when the failure's diagnostics name it | yes; a transaction was submitted and failed |

### Reasons

`frozen`, `cancelled`, `expired`, `not_allowlisted`, `over_per_tx_cap`, `over_budget`,
`wrong_token`, `insufficient_balance`, `bad_signature`, `wrong_context`, `unknown`.

Card contract codes map as #1 `bad_signature`, #2 `wrong_context`, #3 `frozen`, #4 `cancelled`,
#5 `expired`, #6 `not_allowlisted`, #7 `over_per_tx_cap`, #8 `over_budget`. `wrong_token` and
`insufficient_balance` are pre-check-only verdicts. `unknown` is **not a policy verdict** — only
an unclassified one: the card refused but the client could not read which rule. It covers a card
that could not be read (the pre-check fails **closed**), a facilitator `simulation_failed` the
re-run pre-check no longer explains, and an on-chain failure whose diagnostics do not name the
card.

## Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `card` | `string` | — | card contract address (`C…`); it is the payer |
| `agent` | `Keypair` | — | the card's registered signer |
| `network` | `"stellar:testnet" \| "stellar:pubnet"` | — | CAIP-2 network |
| `rpcUrl` | `string` | testnet default; **required** on pubnet | Soroban RPC endpoint |
| `precheck` | `boolean` | `true` | run the local policy mirror before signing |
| `onDenial` | `(d: CardPolicyDenied) => void` | — | called at every denial stage |
| `onPaymentError` | `(e: PaymentError) => void` | — | called for every non-policy failure |
| `fetch` | `typeof fetch` | `globalThis.fetch` | transport (`createMooringFetch` only) |

## API

| Export | What it does |
|---|---|
| `createMooringFetch(opts)` | a `fetch` that pays from the card and rejects with `CardPolicyDenied` or `PaymentError`, never a bare `402`; builds a fresh client per call, so it is safe to share |
| `createMooringClient(opts)` | the underlying `x402Client`. **Single-flight per instance** — x402's hooks carry no request identity, so build one per payment. Used directly it is stock x402: it throws generic errors and returns bare `402`s, and only `onDenial` / `onPaymentError` carry the typed reason |
| `getSettlement(res)` | decodes `PAYMENT-RESPONSE`; `null` when absent or undecodable (a settlement you cannot read is not a failed payment) |
| `CardPolicyDenied`, `DenialReason`, `DenialStage`, `CARD_ERROR_CODES`, `classifyContractError`, `cardDenialFromEvents` | typed denials (payment-path codes 1-8) |
| `CARD_ERRORS` | the full contract error table (codes 1-13, including owner-operation errors like `InvalidLabel`) mapped to short user-facing sentences |
| `PaymentError` | every failure that is *not* the card's policy (`rejected` / `unconfirmed`) |
| `reconcileSettlement(rpcUrl, network, hash)` | asks the ledger what became of a settlement transaction |
| `precheck(info, merchants, terms, now)` | the local policy mirror, on its own |
| `readCardInfo(rpcUrl, passphrase, card)`, `readMerchants(…)` | read-only card views (`info()`, `merchants()`); `CardInfo.label` is the owner-chosen display name |
| `CardExactStellarScheme` | the x402 `exact` scheme client whose payer is the card |
| `signCardAuthEntries(tx, card, agent, expirationLedger)` | signs a card auth entry with the agent key |

## Notes

- The pre-check is **advisory**. The card contract is the authority and runs again at settlement;
  the pre-check only avoids spending a signature and a round-trip on an obvious refusal.
- Muxed (`M…`) destinations are not payable — a Soroban `Address` does not exist for them.
- The client records legacy (v1) auth credentials (`useUpgradedAuth: false`) because the deployed
  OZ Channels stack rejects CAP-71 `ADDRESS_V2` as malformed. It also **asserts** what the RPC
  actually recorded and refuses to sign a v2 card entry, and `@stellar/stellar-sdk` is pinned
  exactly to `17.0.1` while the workaround stands. All three go away together; see
  `docs/x402-integration.md`.
- The auth entry expires at `latestLedger + max(2, ceil(maxTimeoutSeconds / 6) - 2)` — a
  deliberately conservative ledger estimate, so the expiry stays inside the window the facilitator
  computes from its own.

Full guide: [`docs/x402-integration.md`](../../docs/x402-integration.md). Testnet evidence:
[`docs/testnet.md`](../../docs/testnet.md).
