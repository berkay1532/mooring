# x402 integration (D2)

How a Mooring card pays an [x402](https://x402.org)-protected API, what the client does at each
step, and what it does when the card's policy says no.

The pieces:

| Piece | Where | What it is |
|---|---|---|
| `@mooring/x402-client` | `packages/x402-client` | x402 client whose payer is a card (`C…`), plus the local policy mirror and typed denials |
| `@mooring/cli` | `packages/cli` | `mooring keygen` / `status` / `pay` |
| Example merchant server | `examples/merchant-server` | stock `@x402/express` + `@x402/stellar` resource server |
| Facilitator | OpenZeppelin Channels | unmodified; verifies and settles, sponsors the Stellar fee |

Everything on the server side is stock x402. Only the **client scheme** is Mooring's, and only
because the stock one cannot sign for a contract account — see
["Why Mooring ships its own client scheme"](#why-mooring-ships-its-own-client-scheme).

## How a payment flows

```
agent                     merchant server            facilitator            Stellar
  │  GET /weather              │                          │                    │
  │ ─────────────────────────► │                          │                    │
  │  402 + PAYMENT-REQUIRED    │                          │                    │
  │ ◄───────────────────────── │                          │                    │
  │                                                                            │
  │ (1) pre-check: read info() + merchants() from the card ────────────────────►│
  │     over budget / not allowlisted / expired → CardPolicyDenied @ precheck   │
  │                                                                            │
  │ (2) build USDC.transfer(card, payTo, amount), simulate ────────────────────►│
  │ (3) sign the card's auth entry with the agent key (custom authorizeEntry)   │
  │ (4) re-simulate — signed entries make it enforcing: __check_auth runs ─────►│
  │     card refuses → CardPolicyDenied @ simulate (nothing sent, no fee)       │
  │                                                                            │
  │  GET /weather + PAYMENT     │                         │                    │
  │ ──────────────────────────► │   POST /verify          │                    │
  │                             │ ──────────────────────► │  simulate ────────►│
  │                             │   POST /settle          │                    │
  │                             │ ──────────────────────► │  submit (fees ────►│
  │                             │                         │  sponsored)        │
  │  200 + PAYMENT-RESPONSE     │                         │                    │
  │ ◄────────────────────────── │                         │                    │
```

Step by step:

1. **402.** The resource server answers with the payment terms: `scheme: "exact"`, `network`,
   `payTo`, `asset` (the USDC SAC), `amount` in base units, `maxTimeoutSeconds`, and
   `extra.areFeesSponsored: true`.
2. **Pre-check** (`onBeforePaymentCreation`). The client simulates the card's `info()` and
   `merchants()` views — read-only, nothing signed or submitted — and evaluates the same rules
   the contract will: token, state, expiry, allowlist, per-tx cap, remaining budget, balance. A
   refusal aborts the payment before the agent key touches anything. Reading the card is
   **fail-closed**: if the RPC call fails, the payment is aborted, not attempted.
3. **Build.** `CardExactStellarScheme` assembles one `invokeHostFunction` calling
   `asset.transfer(card, payTo, amount)` — the card contract address is the `from` argument, so
   the card is the payer — and simulates it.
4. **Sign.** `signCardAuthEntries` signs the card's auth entry with the agent ed25519 key through
   a custom `authorizeEntry`, with
   `expiration = latestLedger + max(2, ceil(maxTimeoutSeconds / 6) - 2)`. The facilitator derives
   its own ceiling from a Horizon-sampled ledger time and refuses anything more than two ledgers
   past it, so the client assumes a *slower* ledger (6 s) than the stock client's 5 s constant and
   keeps a two-ledger margin: the expiry only has to outlive settlement, and shorter is never
   rejected.
5. **Enforcing simulation.** The transaction is re-simulated with the signed entry in place. Now
   the host actually runs the card's `__check_auth`, so a payment the policy refuses fails
   *here* — locally, before any facilitator sees it and before any fee is paid.
6. **Retry with payment.** `@x402/fetch` re-sends the request with the base64 transaction
   envelope in the `PAYMENT` header.
7. **Verify / settle.** The server hands the payload to the facilitator, which re-simulates it
   (`/verify`), then rebuilds it with its own account as the transaction source, signs, submits
   and polls (`/settle`). The card pays USDC; the facilitator pays the Stellar fee.
8. **200 + `PAYMENT-RESPONSE`.** `getSettlement(res)` decodes the header into
   `{ success, transaction, network, payer }` — `payer` is the card's `C…` address.

## Why Mooring ships its own client scheme

The stock `@x402/stellar` client cannot sign for a card. `AssembledTransaction.signAuthEntries`
(stellar-sdk 17) coerces the SEP-43 `signAuthEntry` result to raw signature bytes and takes the
public key **from the auth entry's credential address** — here the card's `C…` address, on which
`Keypair.fromPublicKey` throws. The `{ signature, publicKey }` return shape a custom account
needs is only reachable by passing a custom `authorizeEntry` to `signAuthEntries`, which
`ExactStellarScheme` does not expose.

So Mooring ships `CardExactStellarScheme implements SchemeNetworkClient`. It produces **exactly
the same payload** as the stock scheme — one `invokeHostFunction` calling
`asset.transfer(from, to, amount)`, re-simulated after signing, returned as a base64 envelope.
Only the signing differs. The facilitator, the server middleware and `@x402/fetch` are used
unmodified.

The other half of the same decision: the payment path is a **plain SAC `transfer`**, not a
guarded `card.pay()` entrypoint. The facilitator rejects any payload whose invoked contract is
not the payment asset or whose function is not `transfer`, so the policy has to live in the
authorization path. Full reasoning in `docs/spike-w1-auth-mechanism.md`.

## Denial semantics

A refusal by the **card's policy** surfaces as `CardPolicyDenied`, carrying a `reason`, the
`stage` it was caught at, and — where the contract spoke — `contractError`. That error means one
thing and only that thing: *the card said no*. Every other way a payment can fail to deliver the
resource is a `PaymentError` (see [below](#paymenterror-everything-that-is-not-the-cards-verdict)),
so a caller can treat `CardPolicyDenied` as a policy decision without checking anything else.

| Stage | How it is detected | What the client throws | Reached the network? | Retryable |
|---|---|---|---|---|
| `precheck` | local mirror of the policy over `info()` + `merchants()`, before signing | `CardPolicyDenied(reason, "precheck")` | two read-only simulations, nothing signed | Not automatically. The card must change (owner action, funding, or the budget period rolling over) before the same payment can succeed. |
| `simulate` | the client's own **enforcing** simulation runs the card's `__check_auth`; the host diagnostic `["failed account authentication with error", <card>, Error(Contract, #N)]` names the code | `CardPolicyDenied(reason, "simulate", { contractError })` | no — the payload never leaves the process, no fee is paid | Not automatically. This is the card's own verdict. |
| `verify` | the facilitator answered the paid request with another 402; the client re-evaluates the card and parses any contract error out of the response | `CardPolicyDenied(reason, "verify", { contractError?, detail })` | yes — the payload reached the facilitator; nothing was submitted on-chain | Not automatically. |
| `settle` | the settlement response came back `success: false`; the facilitator did not observe success within its window, so the client reconciles the hash against the RPC before deciding, and reports a denial only for a transaction the ledger actually rejected whose diagnostics name the card | `CardPolicyDenied(reason, "settle", { contractError?, detail: "… tx=<hash>" })` | yes — a transaction was submitted and failed | Not automatically. This is the concurrency case (see Known limits); whether a caller re-tries is the caller's decision, made once it knows the reason. |

**Denied payments are never retried automatically.** `createMooringFetch` rejects; it does not
re-attempt the request, and it never returns a bare 402 for a payment that was denied.

Reasons (`DenialReason`):

| Reason | Card error | Meaning |
|---|---|---|
| `bad_signature` | #1 | the signature is not the card's registered agent key |
| `wrong_context` | #2 | the auth context is not exactly one `token.transfer(card, …)` |
| `frozen` | #3 | the owner froze the card |
| `cancelled` | #4 | the card is cancelled |
| `expired` | #5 | past the policy expiry |
| `not_allowlisted` | #6 | `payTo` is not on the card's merchant allowlist |
| `over_per_tx_cap` | #7 | amount above `max_per_tx` |
| `over_budget` | #8 | amount above what is left in the current period |
| `wrong_token` | — | the 402 asks for an asset that is not the card's token (pre-check only) |
| `insufficient_balance` | — | the card's USDC balance is below the amount (pre-check only) |
| `unknown` | — | the card refused, but the client could not read *which* rule — it is not a policy verdict, only an unclassified one. It covers a card that could not be read at pre-check, a facilitator `simulation_failed` the re-run pre-check no longer explains (typically a race), and an on-chain failure whose diagnostics do not name the card. |

### `PaymentError` — everything that is not the card's verdict

```ts
class PaymentError extends Error {
  kind: "rejected" | "unconfirmed";
  transaction?: string;  // the settlement hash, when one exists
  detail?: string;       // the facilitator's reason, verbatim where it gave one
}
```

| `kind` | What happened | Was the card debited? | What to do |
|---|---|---|---|
| `rejected` | the facilitator (or the transport) refused the payment **before submitting** it: `invalid_exact_stellar_payload_malformed`, `…_fee_exceeds_maximum`, `…_signature_expiration_too_far`, a 5xx, a transport failure — or the client's own CAP-71 guard, before the agent key signed anything | no — nothing reached the ledger | fix the payload or the configuration; retrying the same payment unchanged will fail the same way |
| `unconfirmed` | the settlement state is unknown or contradictory: the server reported a failure for a transaction the ledger **accepted**, or the transaction was never observed within the reconciliation window, or the server answered a bare `402` with neither a `PAYMENT-REQUIRED` nor a `PAYMENT-RESPONSE` header | **possibly** — the resource was not delivered either way | reconcile `transaction` against the network (Horizon/RPC `getTransaction`) and check the card's `spent` before retrying; when there is no hash, the card's `info()` is the record that settles it |

Why `unconfirmed` exists: the facilitator answers `settle_exact_stellar_transaction_failed` both
for a transaction the ledger rejected **and** for one whose 60-second poll simply ran out, and
`@x402/express` answers a bare `402 {}` from its own settlement path, *after* the facilitator may
already have submitted. Neither is evidence that the payment did not happen, so neither is ever
reported as a policy denial. When a settle failure carries a hash the client asks the RPC directly
(~10 s, one read per second) and only then decides: a transaction the ledger accepted is
`unconfirmed`, never a denial of the card's.

Both errors are thrown by `createMooringFetch` and never swallowed; `onDenial` fires for
`CardPolicyDenied` and `onPaymentError` for `PaymentError`.

```ts
try {
  const res = await fetchWithPayment(url);
} catch (err) {
  if (err instanceof CardPolicyDenied) console.error(err.reason, "at", err.stage);
  else if (err instanceof PaymentError && err.kind === "unconfirmed") {
    console.error("reconcile", err.transaction ?? "(no hash)", err.detail);
  } else if (err instanceof PaymentError) console.error("refused:", err.detail);
  else throw err;
}
```

## Server setup

The example server (`examples/merchant-server`) is a stock `@x402/express` resource server; there
is nothing Mooring-specific in it. That is the point: a card pays ordinary x402 APIs.

```sh
cp examples/merchant-server/.env.example examples/merchant-server/.env
# fill in OZ_API_KEY and STELLAR_RECIPIENT, then:
npm start -w @mooring/example-merchant-server
```

| Env var | Meaning |
|---|---|
| `STELLAR_NETWORK` | `stellar:testnet` (default) or `stellar:pubnet` |
| `STELLAR_RECIPIENT` | the merchant `G…` account that receives USDC — **it needs a USDC trustline**, or settlement fails |
| `FACILITATOR_URL` | default `https://channels.openzeppelin.com/x402/testnet` |
| `OZ_API_KEY` | OpenZeppelin Channels key — generate one at <https://channels.openzeppelin.com/testnet/gen> |
| `PORT` | default `3001` |

Routes are declared as prices; `defaultRoutes` ships `GET /weather` at `$0.001` and
`GET /premium` at `$20` (deliberately above a typical card's per-tx cap, so the pre-check has
something to refuse).

For the merchant to be payable **by a given card**, its `payTo` address must also be on that
card's allowlist (`add_merchant`, one of the card's owner operations — alongside `remove_merchant`,
`freeze`, `unfreeze`, `cancel`, `withdraw`, `set_policy`, `set_signer`, and `set_label` for the
on-chain card label).

## Client setup

```ts
import { Keypair } from "@stellar/stellar-sdk";
import { CardPolicyDenied, createMooringFetch, getSettlement } from "@mooring/x402-client";

const fetchWithPayment = createMooringFetch({
  card: "CAJPWJBF…AHCJ",                              // the card contract address
  agent: Keypair.fromSecret(process.env.AGENT_SECRET!), // the card's registered signer
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

`createMooringClient(opts)` returns the underlying `x402Client` if you want to wire it into
something other than `fetch`. Two caveats. One instance is **single-flight** (see Known limits);
`createMooringFetch` builds a fresh one per call, so it is safe to share. And the returned
`x402Client` is stock x402: it throws x402's own generic errors and hands back bare `402`
responses. Used directly, the **hooks are the only place the typed reason appears** — pass
`onDenial` and `onPaymentError` and read them there. Turning those into thrown `CardPolicyDenied`
/ `PaymentError` is what `createMooringFetch` adds.

Options:

| Option | Default | Meaning |
|---|---|---|
| `card` | — | card contract address (`C…`), the payer |
| `agent` | — | `Keypair` of the card's registered signer |
| `network` | — | `"stellar:testnet"` or `"stellar:pubnet"` |
| `rpcUrl` | testnet default; **required** on pubnet | RPC endpoint |
| `precheck` | `true` | run the local policy mirror before signing |
| `onDenial` | — | called with the `CardPolicyDenied` at every stage |
| `onPaymentError` | — | called with the `PaymentError` for every non-policy failure |
| `fetch` | `globalThis.fetch` | transport (`createMooringFetch` only) |

x402's own USD-based spend controls are switched off (`spendControls: false`): the card enforces
the limits on-chain, and a second, unrelated cap in the client would only get in the way.

`readCardInfo` (also exported from `@mooring/x402-client`) returns the same `CardInfo` the
pre-check reads: `owner`, `signer`, `token`, `label` (the card's on-chain, owner-settable label),
`policy`, `state`, `period`, `remaining`, `balance`, `allow_count` — a plain read-only simulation,
no signing or fees. The label is opaque bytes (1..=32); consumers must treat it as untrusted text
(escape when rendering).

### From the CLI

The CLI is not published to npm yet; run it from the workspace.

```sh
npm ci && npm run build
alias mooring="node $PWD/packages/cli/dist/index.js"

mooring keygen --hex                       # new agent keypair (--hex prints the BytesN<32> signer)
mooring status --card C… --json            # label, on-chain policy, period, remaining budget, allowlist
AGENT_SECRET=S… mooring pay http://localhost:3001/weather --card C…
```

`mooring pay` prints the HTTP status, the settlement transaction hash and the body. A policy
denial prints `Denied (<reason>) at <stage>` and exits with code **2**, so a shell script can tell
a refused payment from a broken one. `--no-precheck` skips the local mirror (the card still
enforces); `--agent-secret-env <NAME>` reads the secret from a different env var; `--network` and
`--rpc` select the network.

## Facilitator constraints the card honors

`@x402/stellar`'s facilitator scheme accepts a payload only under these rules, all of which
shaped the card contract:

| Constraint | How the card satisfies it |
|---|---|
| Exactly one `invokeHostFunction` operation | the payment is a single SAC `transfer`; no batching |
| Invoked contract = the asset, function = `transfer`, 3 args | no `card.pay()` entrypoint exists; the policy lives in `__check_auth` |
| `from` may be any address (G or C) | the card's `C…` address is the payer, unchanged |
| Simulation must succeed | a policy denial *is* a simulation failure — which is why the client runs its own enforcing simulation first and reports the reason |
| Auth entries: address-credentialed, no **sub-invocations** | `__check_auth` makes no cross-contract call; it verifies ed25519 and touches only its own storage |
| Exactly one `transfer` event, on the asset | `__check_auth` emits **no events**; events are reserved for owner operations |
| Fee ceiling: `minResourceFee + BASE_FEE ≤ maxTransactionFeeStroops` | measured, see below |

**Fee measurements** (from `docs/testnet.md` and `docs/spike-w1-auth-mechanism.md`):

| Measurement | Value |
|---|---|
| `minResourceFee`, 1-merchant allowlist (2026-09-09) | 33 926 stroops |
| `minResourceFee`, full 32-merchant allowlist (2026-09-12) | 49 380 stroops |
| `@x402/stellar` library **default** ceiling | 50 000 stroops |
| `max_fee` OZ Channels actually accepted and submitted | 51 175 stroops |
| `fee_charged` on that settlement | 38 773 stroops |

The 50 000 figure is the library's default, not a limit anyone imposed: OZ Channels settled a card
payment at `max_fee` 51 175, so its configured ceiling is higher (at least that; the exact value
is not published). Custom-account auth therefore fits, with the worst allowlist the card
supports. Re-measure if a change adds per-payment storage, or if a facilitator ever answers
`invalid_exact_stellar_payload_fee_exceeds_maximum`; the reduction levers are kept on file in the
"Open measurement" section of `docs/spike-w1-auth-mechanism.md`.

**Auth credential format (CAP-71).** `CardExactStellarScheme` simulates with
`useUpgradedAuth: false`, i.e. it records **legacy v1** `ADDRESS` credentials rather than the
CAP-71 `ADDRESS_V2` ones stellar-sdk 17 asks for by default. Measured 2026-09-12 against OZ
Channels testnet: a v2 payload is rejected as `invalid_exact_stellar_payload_malformed`, while
the identical payment recorded as v1 verifies and settles. `@x402/stellar` itself decodes v2, so
the failing decoder is elsewhere in the deployed facilitator stack (most plausibly a Rust
`stellar-xdr` of the same vintage as CLI 26.1.0, which also fails on a v2 envelope). Both formats
are valid on-chain and carry the same agent signature; only the signed preimage differs (v2 binds
the address). **This flag is transitional** — it becomes a no-op from protocol 28, so OZ has to
accept `ADDRESS_V2` first; remove it then. The full evidence is in `docs/testnet.md`.

Because the workaround depends on what the RPC and the SDK actually record, it is guarded on both
sides:

- **A runtime assertion.** After building the transfer, the scheme inspects every auth entry
  addressed to the card and throws `PaymentError("rejected", "RPC returned CAP-71 ADDRESS_V2
  credentials…")` if the credentials came back as `ADDRESS_V2` — before the agent key signs
  anything. Without it, a payload recorded in the wrong format is signed, sent, and refused as
  `invalid_exact_stellar_payload_malformed`, a reason that says nothing about why.
- **An exact SDK pin.** `@stellar/stellar-sdk` is pinned to **`17.0.1`** (no `^`) in
  `packages/x402-client`, `packages/cli` and `scripts/agent` for as long as the workaround stands,
  since a minor SDK release could change how auth credentials are recorded. Drop the pin together
  with the flag and the guard.

## Known limits

- **The pre-check is advisory, not authoritative.** It is a local mirror of the policy, evaluated
  against the card state a moment before signing. The card contract is the only authority, and it
  runs again at settlement. The pre-check exists to refuse the obvious cases without spending an
  agent signature or a facilitator round-trip — never to replace `__check_auth`. Disabling it
  (`precheck: false`, `--no-precheck`) removes a convenience, not a control.
- **Concurrent payments can both pass verify, and one will fail at settle.** Two payments
  simulated against the same card state both look affordable; the second executes against the
  state the first already wrote and is rejected on-chain. The client reconciles the settlement hash
  with the RPC and, for a transaction the ledger really did reject whose diagnostics name the card,
  reports `CardPolicyDenied` at stage `settle` — a policy denial, not a transient error. This is
  visible on testnet in the D1 race evidence (`docs/testnet.md`): the second transaction failed
  with contract error #8 `OverBudget` and had no effect on the card's `spent`.
- **One `createMooringClient` instance is single-flight.** x402's hook contexts carry no request
  identity, so a denial recorded by one in-flight payment cannot be told apart from another's.
  Build one client per payment — or use `createMooringFetch`, which creates a fresh client and
  denial scope on every call, so concurrent requests through the same returned `fetch` cannot
  observe each other's denials.
- **Muxed (`M…`) destinations are not payable.** x402's own destination validation accepts `M`
  addresses, but a Soroban `Address` does not exist for them: building the transfer throws
  `Unsupported address type`. A card pays `G…` and `C…` destinations only — which is also all the
  card's allowlist can hold.
- **Testnet only.** Not audited, not on mainnet. Testnet resets quarterly; re-run
  `scripts/testnet/deploy.sh` afterwards.

## Evidence

`docs/testnet.md` records the D2 run end to end: a `$0.001` `GET /weather` paid from the card and
settled on-chain (tx `bc1b78eb2c0f4112d47f8faed70f608429a383d38a24f67ddda72f64453ccbba`), the
card's `spent` moving `0 → 10000` by exactly the price, and three denial scenarios — `precheck`
(`over_per_tx_cap`), `simulate` (`not_allowlisted`, contract error #6), and what OZ Channels
itself answers for the same payload (`invalid_exact_stellar_payload_simulation_failed`).

It was re-run unchanged after the D2 review fixes (shorter auth-entry expiry, CAP-71 runtime
guard, settle reconciliation) and passed end to end again — tx
`4b2fcd1f9dfad53819bab1a012c0a0c4294399f0dd6a5bd258206c054102c5ff`, `spent` `10000 → 20000`, no
`signature_expiration_too_far` and no credential-guard failure.

Reproduce with `npm run e2e` (needs an OZ API key, a funded card, and `deployed.testnet.json`;
`scripts/testnet/reset-policy.sh` first only if the card's `remaining` has run down). The e2e
spends real testnet USDC and is never run in CI.
