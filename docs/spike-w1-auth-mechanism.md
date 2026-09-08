# W1 Spike — Card-as-payer authorization mechanism

**Status:** RESOLVED (2026-09-08). Decision: **Option A — `__check_auth` on a SAC `transfer`.**
**Method:** read the shipped source of `@x402/stellar@2.25.0` (client + facilitator schemes)
and `@stellar/stellar-sdk@17.0.1` (`authorizeEntry`, `AssembledTransaction.signAuthEntries`).

## Decision

The card is a Soroban custom account. An x402 payment is a standard
`USDC.transfer(from = card, to = merchant, amount)` whose auth entry is signed by the agent
key and verified by the card's `__check_auth`. No custom entrypoint is involved in the
payment path.

Option B (a guarded `card.pay()` entrypoint) is **not viable**: the facilitator's `verify`
rejects any transaction whose invoked contract is not the payment asset or whose function is
not `transfer` (`invalid_exact_stellar_payload_wrong_asset` / `wrong_function_name`).

## What the facilitator enforces (`@x402/stellar/exact/facilitator`)

`verify()` accepts a payload only if all of the following hold:

| Check | Requirement |
|---|---|
| Operations | exactly one `invokeHostFunction` |
| Contract / fn / args | `asset` (USDC SAC) · `transfer` · 3 args |
| `from` | any address (G or C); must not be a facilitator address |
| `to` / `amount` | equal `payTo` / `amount` from the 402 terms |
| Simulation | must succeed; policy denial = simulation failure = verify fails |
| Fee ceiling | `minResourceFee + BASE_FEE ≤ maxTransactionFeeStroops` (library default 50 000) |
| Events | exactly one `transfer` event on `asset`, matching from/to/amount |
| Auth entries | ≥1, all address-credentialed, expiry ≤ maxLedger+2, **no sub-invocations** |
| Signatures | `from` already signed; nothing pending |

`settle()` re-runs `verify`, rebuilds the tx with the facilitator account as source (fees
sponsored), signs, submits, polls up to `maxTimeoutSeconds`.

Consequences for the card:

- The payer is identified purely by the `from` argument. A C address works unchanged.
- Policy rejections surface to the client as `invalid_exact_stellar_payload_simulation_failed`
  at verify time (before any tx is submitted). Rejections therefore leave no on-chain trace via
  x402; on-chain evidence for the SOW is produced by submitting a rejected transfer directly
  (CLI/SDK) in the D1 test flow.
- Two payments simulated against the same card state can both pass verify; the second fails at
  settle (`settle_exact_stellar_transaction_failed`). The agent client must treat this as a
  policy denial, not a transient error.

## What the client produces (`@x402/stellar/exact/client`)

`ExactStellarScheme.createPaymentPayload` builds
`asset.transfer(signer.address, payTo, amount)`, simulates, requires
`needsNonInvokerSigningBy() == [signer.address]`, then calls `signAuthEntries` with
`expiration = latestLedger + ceil(maxTimeoutSeconds / ledgerSeconds)`.

`ClientStellarSigner` is documented as supporting both G and C accounts. For the card:

- `signer.address` = **card contract address (C...)**.
- `signAuthEntry(preimageXdr)` hashes the preimage, signs with the **agent ed25519 key**, and
  returns `{ signature, publicKey: agentG }`. The SDK then encodes the credential signature as
  `ScVal::Vec[ Map{ public_key: BytesN<32>, signature: BytesN<64> } ]` — the same shape the
  soroban-examples `account` contract consumes.
- Alternatively the signer may return `{ signatureScVal }` for a fully custom encoding. Not
  needed for v1; the standard shape is used.

**The stock client cannot sign for the card.** `AssembledTransaction.signAuthEntries` (stellar-sdk
17) coerces the SEP-43 `signAuthEntry` result to raw signature bytes and takes the public key
*from the auth entry address*; for a C address `Keypair.fromPublicKey("C...")` throws. The
`{ signature, publicKey }` / `{ signatureScVal }` return shapes are only reachable by calling
`authorizeEntry` directly or by passing a custom `authorizeEntry` to `signAuthEntries`, which
`ExactStellarScheme` does not expose. Therefore Mooring ships its own client scheme
(`CardExactStellarScheme implements SchemeNetworkClient`, ~50 lines, same payload shape) that
calls `authorizeEntry(entry, async (_preimage, payload) => ({ signature: agent.sign(payload),
publicKey: agent.publicKey() }), expiration, passphrase)`. The facilitator, server middleware and
`@x402/fetch` are used unmodified.

**No events in the payment path.** `validateSimulationEvents` rejects the payload if *any*
contract event in the simulation has fewer than 3 topics or a first topic other than `transfer`.
`__check_auth` must therefore emit nothing; events are reserved for owner operations.

## What `__check_auth` receives and must do

```
fn __check_auth(env, signature_payload: BytesN<32>, signatures: Vec<Sig>, auth_contexts: Vec<Context>)
```

1. **Signature:** exactly one `Sig`; `Sig.public_key == stored agent key`;
   `env.crypto().ed25519_verify(pk, payload, sig)`. The host has already bound the payload to
   this card address, the nonce, the network, and the expiration ledger — no custom replay
   protection is needed.
2. **Context allow-list (security-critical):** exactly one context, and it must be
   `Contract { contract == token, fn_name == "transfer", args[0] == current_contract_address }`.
   Anything else (`approve`, `burn`, another contract, extra contexts) is rejected. Without this,
   the agent could sign an `approve` and the merchant could drain via `transfer_from`.
3. **Policy on `(to = args[1], amount = args[2])`:** state is `Active`; `now < expiry`;
   `to ∈ allowlist`; `amount ≤ max_per_tx`; period reset if `now ≥ period_start + duration`
   (reset once, even if several periods elapsed); `spent + amount ≤ period_amount`.
4. **Mutation:** `spent += amount`, persist period fields, extend instance TTL. Writing storage
   inside `__check_auth` is a documented pattern (soroban-examples `account`).
5. **Errors:** distinct contract error codes (`BadSignature`, `WrongContext`, `Frozen`,
   `Cancelled`, `Expired`, `NotAllowlisted`, `OverPerTxCap`, `OverBudget`) so the simulation
   diagnostics tell the client and the UI *why*.

Owner operations (`freeze`, `unfreeze`, `cancel`, `withdraw`, `add_merchant`,
`remove_merchant`) are ordinary entrypoints guarded by `owner.require_auth()`. `withdraw`
calls `token.transfer(self, owner, amount)`; because the card is the direct invoker this is
invoker-authorized and does **not** pass through `__check_auth`. That is intended: the policy
bounds the agent, not the owner.

## Open measurement (first testnet task)

**Fee ceiling.** Custom-account auth adds an ed25519 verification plus 2–3 storage writes to
the resource fee. The library default ceiling is 50 000 stroops; OZ Channels' configured value
is not visible from the SDK. Task D1-last / D2-first: simulate a real card-paid transfer on
testnet, record `minResourceFee`, and compare. If it exceeds the ceiling, reduce writes
(pack period fields into one struct in instance storage, skip TTL extension when above
threshold) before D2 wiring.

## Design changes adopted from this spike

- Add `max_per_tx` to the policy (was client-only in the original design).
- Rename "rollover" → **reset**: unused budget does not carry over.
- Allowlist stored as persistent `Allowed(Address)` keys with a bounded count, not an instance
  `Vec`.
- Add a **factory** (`deploy_v2` + constructor, `card_created` event) so the UI can list cards.
- Card **code** is immutable; policy and signer are owner-mutable (`set_policy`, `set_signer`).
  New contract versions ship as a new factory.
- `cancel` = set `Cancelled` + sweep full balance to owner in one call.
- Expose `bump()` so anyone can extend a card's TTL; UI shows an "archived" state.
- `token` is a constructor argument (any SEP-41); USDC is the default in tooling.
- Agent client ships its own x402 client scheme for the card; `__check_auth` emits no events.
