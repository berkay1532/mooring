# Testnet deployment (D1)

Network: Stellar testnet (`Test SDF Network ; September 2015`). Testnet resets quarterly; re-run `scripts/testnet/deploy.sh` after a reset.

> **The live deployment is "Deployment v2 (on-chain label, 2026-09-13)" at the end of this
> file.** The addresses in this section are the D1/D2 deployment, kept as the record of the
> evidence collected against it; its card was cancelled and drained during the v2 migration.

| Item | Value |
|---|---|
| Card WASM hash | `ab48afbc45a013257c7c4510ea74083a673c4108a7ed52ce6a8f1d77210f7f78` |
| Factory | `CCPVVXXD3CZG4HK7KRWKJG2RUZD6X6EZ5TB4P4ZB6CABETMS5OSBF4RL` |
| Card | `CAJPWJBFBM6WMYZBRURA7VW3GKSLMHTHIIZIRFVFKUSAPWX4526YAHCJ` |
| Token (USDC SAC) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| Owner | `GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD` |
| Agent (signer) | `GDHDJL3RT6S3OABSHLOEOCBH4BMMAKLVOR5FPEHXG5ZW2DDJDRRJJSM7` |
| Agent signer pubkey (hex, `BytesN<32>`) | `ce34af719fa5b700323adc470827e058c02975747a5790f737736d0c691c6294` |
| Merchant | `GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG` |
| Funder | `GDJ33V6NOUCXMS2Q24FHSTXSTZDUANPCJXSCQHPZFUM7KWMJ5D2DMKBR` |

Policy: 50 USDC / day, max 10 USDC per payment, expiry +30 days.

The funder account needs testnet USDC before `scripts/testnet/fund.sh` can run
(from the Circle faucet at https://faucet.circle.com — Stellar testnet, manual
step, requires a captcha). Once funded, `scripts/testnet/fund.sh` transfers
USDC from the funder into the card and prints its balance.

## Notes on this deployment

- `contracts/factory/Cargo.toml` enables the soroban-sdk
  `experimental_spec_shaking_v2` feature. Without it, the factory's own
  contract spec doesn't carry a definition for the `card::Policy` type it
  imports via `contractimport!` (a "wasm import"), and the `stellar` CLI
  cannot build its implicit CLI for *any* function on the factory —
  including `__constructor`, which doesn't touch `Policy` at all — failing
  with `error: Missing Entry Policy`. The feature requires building via
  `stellar contract build` rather than plain `cargo build` for the factory
  package; `scripts/testnet/deploy.sh` does this.
- `stellar contract invoke` on CLI 26.1.0 requires `--source-account` even
  for read-only calls (no anonymous/view-only invocation).
- The factory binds the deploy salt to the owner: it derives the Soroban salt as
  `sha256(owner ‖ salt)`, so the card address above cannot be recomputed from the
  raw salt alone — the owner address is part of the derivation, and two owners
  passing the same salt get different card addresses.
- `deploy.sh` checks each identity's on-chain account (via Horizon) and its
  USDC trustline before funding/creating a trustline, rather than only
  checking the local keystore. This is what makes "re-run after a reset"
  above actually safe: a local key can survive a testnet reset while its
  on-chain account and trustlines do not, and the script now detects and
  repairs that instead of silently skipping funding.

## Evidence

Collected 2026-09-09 against the deployment above.

| Scenario | Tx hash | Status |
|---|---|---|
| Card-paid transfer within policy (`pay.ts`, 6 USDC) | `0f19bfc88b0b28d3454980a35c60627a8a22fae73745bf770a06060bac53e532` | SUCCESS |
| Race: first of two overlapping payments (`race.ts`, 3 USDC) | `6366b7d0a70002b0c3e69f8612887c9b46389a506e356f814b459a7cb616b8df` | SUCCESS |
| Race: second payment, over budget, rejected by `__check_auth` | `324aa5402e4a4f2e513025ee99ca4791cd3ec961b589febb8ab2446a5c793ece` | FAILED (contract error #8 OverBudget) |

**Fee measurements** (`minResourceFee` for a card-paid transfer, facilitator library default
ceiling: 50 000 stroops):

| Allowlist size | minResourceFee | vs. 50 000 library default |
|---|---|---|
| 1 merchant | 33 926 stroops | within |
| 32 merchants (full) | 49 380 stroops | within |

Measured 2026-09-12 with a 32-merchant allowlist: minResourceFee = 49380 stroops. The allowlist
is a bounded `Vec` scanned (and rewritten) linearly, so a full list makes `__check_auth` touch a
larger instance entry than the 1-merchant case — that is the whole spread between the two rows.
The 50 000 column is the **library default**, not a limit anyone enforced on us: the D2 evidence
below shows OZ Channels accepting a card payment at `max_fee` 51 175, so its real ceiling is
higher and the 32-merchant case is not close to it. The reduction options are kept on file in the
"Open measurement" section of `docs/spike-w1-auth-mechanism.md` in case a future change adds
per-payment storage.

Both race payments simulate against the same state and so both pass simulation; the second
executes against the state the first already updated and is rejected on-chain. The rejection
is visible in the second transaction's diagnostic events, which name the card contract and
the error directly:

```
{"contractId":"CAJPWJBF…AHCJ","type":"diagnostic","topics":["error",{"type":"contract","code":8}],
 "data":"escalating Ok(ScErrorType::Contract) frame-exit to Err"}
{"contractId":"CBIELTK6…DAMA","type":"diagnostic","topics":["error",{"type":"system","code":6,"value":"scecInvalidAction"}],
 "data":["failed account authentication with error","CAJPWJBF…AHCJ",{"type":"contract","code":8}]}
```

The rejected payment had no effect: after the race the card's `spent` is `90000000`
(6 + 3 USDC, the second payment not counted), its balance is `110000000`, and the merchant's
classic USDC balance is `9.0000000` — exactly the two payments that settled.

**Note on the policy during this run.** The card is deployed with the 50 USDC/day policy in the
table above, which leaves `remaining` far higher than a 20 USDC card balance can ever spend down.
To reach the `AMOUNT ≤ remaining < 2 × AMOUNT` state the race needs, `set_policy` was called as
the owner after the first payment, lowering `period_amount` and `max_per_tx` to `100000000`
(10 USDC) with `period_duration` and `expiry` unchanged
(tx `cf033300ea3f24a4acf6fd47109493ff64abb8e20e00a5f4580f2c645b0e8ab8`). The already-spent
`60000000` was carried over rather than reset, leaving `remaining = 40000000` — which is itself
evidence that `set_policy`'s carry-over works on-chain. **The card's live policy is therefore
10 USDC/day, not the 50 USDC/day it was deployed with.**
`scripts/testnet/reset-policy.sh` puts the deployed policy back (50 USDC / day, 10 USDC max per
payment, expiry +30 days) as the owner; it was run before the D2 evidence below
(tx `508ff4eafc6144ed9cc20622c6e5a85cd33bf7a428c51e5391a24efffd5022e2`).

## D2 evidence — paying an x402 API from the card

Collected 2026-09-12 by `npm run e2e` (`packages/x402-client/e2e/testnet.e2e.ts`), which starts
the example merchant server (`@x402/express` + `@x402/stellar`) in-process against the
OpenZeppelin Channels testnet facilitator (`https://channels.openzeppelin.com/x402/testnet`) and
pays it with `createMooringFetch`. Reproduce with `scripts/testnet/reset-policy.sh && npm run e2e`.
The flow, the denial stages and the client/server setup are documented in
`docs/x402-integration.md`; the client package itself in `packages/x402-client/README.md`.

| Scenario | Outcome |
|---|---|
| `GET /weather` ($0.001) paid from the card | HTTP 200 `{"city":"Istanbul","temp":24,"conditions":"Clear"}`; settlement `{success: true, transaction: bc1b78eb…cbba, network: stellar:testnet, payer: CAJPWJBF…AHCJ}` |
| Card budget after the payment | `spent` 0 → `10000` (exactly the $0.001 price), `remaining` `499990000`, balance `109990000` |
| `GET /premium` ($20, above `max_per_tx`) | `CardPolicyDenied` reason `over_per_tx_cap`, stage `precheck` — refused locally, nothing signed, no network traffic |
| Unlisted merchant, pre-check disabled | `CardPolicyDenied` reason `not_allowlisted`, stage `simulate`, contract error #6 — the card's `__check_auth` rejects the signed payment in the enforcing simulation, so it never reaches the facilitator |
| The same unlisted-merchant payload, presented to the facilitator | OZ Channels `/verify` → `{"isValid": false, "invalidReason": "invalid_exact_stellar_payload_simulation_failed", "payer": "CAJPWJBF…AHCJ"}` |

Settlement transaction
`bc1b78eb2c0f4112d47f8faed70f608429a383d38a24f67ddda72f64453ccbba`, on Horizon:

```json
{ "successful": true, "ledger": 4644824, "max_fee": "51175", "fee_charged": "38773",
  "source_account": "GAMPXGQBZLS5O77TDOGDMMVH7AAYREEE5D5J3O6EITHCB2A7H2VIQDIS" }
```

The source account is the facilitator's — fees are sponsored, the card only pays USDC — and the
payer recorded in the settlement is the card contract itself.

**OZ Channels' fee ceiling.** The facilitator accepted and submitted this payment with
`max_fee = 51175` stroops (its own simulation-derived fee), i.e. **above** the 50 000-stroop
default in `@x402/stellar`. OZ's configured ceiling is therefore higher than the library default
— at least 51 175 stroops; the exact value is not published — and the D1 worst case (49 380
stroops at a full 32-merchant allowlist) sits below everything OZ has been seen to accept.
`fee_charged` came in at 38 773 stroops.

**Auth credential format (CAP-71).** stellar-sdk 17 asks the RPC to record `ADDRESS_V2`
address credentials by default; stellar-sdk 16 omits the flag and so still gets the legacy v1
format. What was observed on 2026-09-12:

- a card payload carrying **v2** credentials → OZ Channels `/verify` answers
  `invalid_exact_stellar_payload_malformed`, with no payer, on every attempt;
- the **identical** payment recorded as **v1** (`useUpgradedAuth: false`) → `isValid: true`,
  `payer` = the card, and it settles;
- a control payload from the stock `@x402/stellar` client (a `G` payer, sdk 16, hence v1) →
  accepted at the same moment, which rules out the endpoint, the API key and the request shape
  (the v1/v2 pair above is what isolates the credential format itself);
- `stellar xdr decode --type TransactionEnvelope` (CLI 26.1.0 / stellar-xdr 26.0.1) also fails on
  a v2 envelope, while both JS SDKs parse it.

The rejection is therefore a property of the **deployed facilitator stack**, not of the x402 JS
library: `@x402/stellar` decodes `ADDRESS_V2` explicitly (its `getAddressCredentials` handles the
arm, and sdk 16.3.0's XDR has it), so the decoder that fails is elsewhere in OZ's service — most
plausibly a Rust `stellar-xdr` of the same vintage as the CLI. Note this also means the stock
client will hit it the day it moves to sdk 17.

`CardExactStellarScheme` therefore simulates with `useUpgradedAuth: false`. Both formats are valid
on-chain and carry the same agent signature; only the signed preimage differs (v2 binds the
address). Remove the flag when OZ Channels accepts `ADDRESS_V2` — and note that the SDK flag is
transitional, a no-op from protocol 28, so the facilitator side has to move first.

### Re-run after the final fix wave (2026-09-12)

`npm run e2e` again, unchanged scenarios, after the D2 review fixes: the shorter auth-entry
expiry (`latestLedger + max(2, ceil(maxTimeoutSeconds / 6) - 2)` — 8 ledgers here, down from 12),
the runtime CAP-71 credential guard, and the settle-failure reconciliation. `reset-policy.sh` was
**not** needed (`remaining` was 499 990 000, far above the $0.001 price). All four scenarios
behaved exactly as in the run above, with no failed checks.

| Scenario | Outcome |
|---|---|
| `GET /weather` ($0.001) paid from the card | HTTP 200 `{"city":"Istanbul","temp":24,"conditions":"Clear"}`; settlement `{success: true, transaction: 4b2fcd1f…c5ff, network: stellar:testnet, payer: CAJPWJBF…AHCJ}` |
| Card budget after the payment | `spent` `10000` → `20000` (exactly the $0.001 price), `remaining` `499980000`, balance `109980000` |
| `GET /premium` ($20, above `max_per_tx`) | `CardPolicyDenied` reason `over_per_tx_cap`, stage `precheck` |
| Unlisted merchant, pre-check disabled | `CardPolicyDenied` reason `not_allowlisted`, stage `simulate`, contract error #6 |
| The same unlisted-merchant payload, presented to the facilitator | OZ Channels `/verify` → `{"isValid": false, "invalidReason": "invalid_exact_stellar_payload_simulation_failed", "payer": "CAJPWJBF…AHCJ"}` |

Settlement transaction
`4b2fcd1f9dfad53819bab1a012c0a0c4294399f0dd6a5bd258206c054102c5ff`, on Horizon:

```json
{ "successful": true, "ledger": 4645459, "max_fee": "34127", "fee_charged": "23947",
  "source_account": "GBFLMQ5HZ35XDWSZRHE4SDIX5VALTCC54MAUCHJUMCSLRWFFOURZLZB4" }
```

The shorter expiry was accepted — no `invalid_exact_stellar_signature_expiration_too_far` — and
the v1 credential guard did not fire, i.e. the RPC still records legacy `ADDRESS` credentials
under `useUpgradedAuth: false`. `max_fee` came in at 34 127 stroops against 51 175 in the run
above, and the source account is a different facilitator signer: OZ Channels rebuilds and prices
the transaction itself (round-robin over its signer pool), so neither figure is a property of the
card — the card's own cost is the `minResourceFee` measured further up (33 926 stroops at a
1-merchant allowlist, 49 380 at the full 32), and both of these settlements sit comfortably above
it.

## Deployment v2 (on-chain label, 2026-09-13)

The card contract now stores an owner-settable **label** (`String`, ≤ 32 bytes (UTF-8)), set by the
constructor and therefore part of the card's WASM ABI. Existing cards cannot gain the field, so
D3-A redeployed the WASM, the factory and the card, and migrated the previous card's funds. The
deployment in the table at the top of this file is superseded by the one below; everything
recorded above it stays as the D1/D2 record of the previous deployment.

| Item | Value |
|---|---|
| Card WASM hash | `158b6acf3cde928e2c9c18c9e0f79fd29f7b847b7c73908c3972ef923c85d20f` |
| Factory | `CBMSK4OSNLBEXTJWNEWX422RPVDEUNFEWADTSPECGBI26ESDYW65AUSE` |
| Card | `CBOOOQDW4YA7JHDW4ELMKRFUUBJFBOJZGB4IXZJTHSAGUE4TWKJXUH5W` |
| Card label | `inference-agent` |
| Token (USDC SAC) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| Owner | `GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD` |
| Agent (signer) | `GDHDJL3RT6S3OABSHLOEOCBH4BMMAKLVOR5FPEHXG5ZW2DDJDRRJJSM7` (unchanged) |
| Merchant | `GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG` (unchanged) |
| Funder | `GDJ33V6NOUCXMS2Q24FHSTXSTZDUANPCJXSCQHPZFUM7KWMJ5D2DMKBR` (unchanged) |

Policy as deployed: 50 USDC / day, max 10 USDC per payment, expiry +30 days
(`expiry` 1791858099). `scripts/testnet/deploy.sh` passes the label as
`--label "$LABEL"` (`CARD_LABEL` overrides it; default `inference-agent`) — the `stellar` CLI
takes a Soroban `String` argument as plain text, not JSON.

| Deployment transaction | Hash |
|---|---|
| Card WASM upload | `0a8945c63a6e20185aceae312763ebd2fc8d7b8e52d3171c644f3aeba268cc53` |
| Factory WASM upload | `83c5ea61aedf50f9736dc30b0aed29e3b8696ac782fb98824535ca3627b4bb82` |
| Factory deploy (`__constructor`) | `6ebc37773d99c094cf8489d23b6a128ec59852895f10f5d66409e7bb91d63194` |
| `create_card` (emits `card_created`) | `39cc9e2743f9a2866e7ce280774ec9c816d3220b281a7bb6f974e42b0cecca8e` |
| `add_merchant` (the merchant above) | `25188135be3c04aedda53433d890cd3d9180bb4966aa389f252139c1a18a6918` |

`node packages/cli/dist/index.js status --card CBOOOQDW…UH5W --json` on the new card reports
`"label": "inference-agent"`, `state` 0 (Active), `remaining` `500000000`, `allow_count` 1.

### Migration of the previous card

`scripts/testnet/migrate-card.sh CAJPWJBF…AHCJ` moved the old card's whole balance into the new
one. The owner had never held a USDC trustline (the card held the USDC, not the owner), and
`cancel` sweeps the balance to the owner as a classic payment, so the script adds the trustline
first when it is missing.

| Step | Hash | Effect |
|---|---|---|
| Owner `change_trust` `USDC:GBBD47IF…FLA5` | `4c2ba4228933140e5ddd70cbc11c404649398c842240d0d7eaaec2820332f002` | owner can receive the sweep |
| `cancel` on the old card `CAJPWJBF…AHCJ` | `05e2208f2bf5ddcc48bd1d6b30243f5fca67240c8624fe4ec7555a0f9c3916ac` | `state_changed` → 2 (Cancelled); `withdrawn` `109980000` to the owner |
| SAC `transfer` owner → new card | `99314c4d4a7be2441cd9d733ebef4b5c4f564ab4824587dcb8f73f1f7e9aa2b8` | `109980000` (10.998 USDC) into `CBOOOQDW…UH5W` |

After the migration the old card's USDC balance is `0` and it is permanently Cancelled; the new
card's balance is `109980000`. The owner's USDC balance is back to `0.0000000` — the funds only
passed through it.

### Fee re-measurement with the label field

`scripts/agent/src/fee32.ts` now prints a **baseline** (the card's untouched 1-merchant
allowlist) before it grows the allowlist to 32, so both numbers come from the same run, the same
card and the same ledger state. Measured 2026-09-13 on the v2 card (60 USDC transfer, built,
signed and re-simulated, never submitted):

| Allowlist size | minResourceFee, 2026-09-13 (v2, with label) | minResourceFee, 2026-09-09/12 (v1) |
|---|---|---|
| 1 merchant (baseline) | 33 996 stroops | 33 926 stroops |
| 32 merchants (full) | 35 233 stroops | 49 380 stroops |

The baseline moved by **+70 stroops**, which is the cost the label adds to the instance entry the
payment path reads and rewrites — negligible, and the point of measuring it.

The 32-merchant figure came out **14 147 stroops lower than the v1 measurement**, i.e. the
allowlist spread is 1 237 stroops here against 15 454 on the v1 card. That drop is not explained
by the label change and was not chased down in this task: both runs maxed the instance TTL via
`add_merchant` immediately beforehand, so it is not TTL rent. The v1 card itself is now cancelled,
but the old factory (`CCPVVXXD…F4RL`, still live) can still mint a fresh v1 card to re-measure
against — that re-measurement is tracked as a follow-up, not done here. **The conservative number
to quote is therefore still the v1 worst case, 49 380 stroops**, which remains below every fee OZ
Channels has been observed to accept (see the D2 section above). Re-measure when the allowlist or
the payment-path storage changes; if the 32-merchant figure stays near 35 000 on a card that has
been live for some days, the v1 number was an artifact of that card's state rather than of
allowlist size.

### D3-A e2e re-run against the new card

`npm run e2e` (`packages/x402-client/e2e/testnet.e2e.ts`) once, unchanged scenarios, against the
v2 card. `reset-policy.sh` was not needed (`remaining` was the full `500000000`). The run reported
`"failures": []`.

| Scenario | Outcome |
|---|---|
| `GET /weather` ($0.001) paid from the card | HTTP 200 `{"city":"Istanbul","temp":24,"conditions":"Clear"}`; settlement `{success: true, transaction: 5695eb07…5315, network: stellar:testnet, payer: CBOOOQDW…UH5W}` |
| Card budget after the payment | `spent` 0 → `10000`, `remaining` `499990000`, balance `109970000` |
| `GET /premium` ($20, above `max_per_tx`) | `CardPolicyDenied` reason `over_per_tx_cap`, stage `precheck` |
| Unlisted merchant, pre-check disabled | `CardPolicyDenied` reason `not_allowlisted`, stage `simulate`, contract error #6 |
| The same unlisted-merchant payload, presented to the facilitator | OZ Channels `/verify` → `{"isValid": false, "invalidReason": "invalid_exact_stellar_payload_simulation_failed", "payer": "CBOOOQDW…UH5W"}` |

Settlement transaction
`5695eb0755e4f9eb44d5c23fc139f69a826d657b2c34df5cc259d4a9fe0c5315`, on Horizon:

```json
{ "successful": true, "ledger": 4648605, "max_fee": "34198", "fee_charged": "24018",
  "source_account": "GBHOPQWSCUNFVDYZIYK7VWPWGBH5SRGDSGRUEZDMQKM44TGMDS5I6R6I" }
```

Fees are still sponsored by the facilitator (a third distinct OZ signer account), and the payer
recorded in the settlement is the card contract.

## D3 — web app (2026-09-13)

The owner-facing web app (`apps/web`, `@mooring/web`) drives the same deployment v2 factory and
card contracts as the sections above: `NEXT_PUBLIC_FACTORY_ADDRESS` is
`CBMSK4OSNLBEXTJWNEWX422RPVDEUNFEWADTSPECGBI26ESDYW65AUSE` and `NEXT_PUBLIC_USDC_SAC` is
`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`. Cards created from the app use the
factory's sequential owner-bound salts, so they are discovered automatically; the card above
(`CBOOOQDW…UH5W`) was created from the CLI with a random salt and is imported with "Add existing
card".

| Item | Value |
|---|---|
| Deployed URL | https://app.mooring.live (Vercel project `mooring-web`, deployed 2026-09-14; steps in `docs/web-app.md`) |
| Automated coverage | 244 vitest unit/component tests + 19 Playwright flows, both in the `web` CI job; neither touches testnet |
| Manual testnet checklist | `docs/web-app.md` → "Manual testnet checklist" |

**On-chain evidence for D3 (run 2026-09-25).** The owner ran the checklist in `docs/web-app.md`
with the real Freighter extension against a local `next dev` on testnet. Card
`CCFZQBAFDJEC635N5DWJYX53GNIOOZPGO3AQXMZ7KRATMA2XVVLKIEYV` (`inference-agent-2`) was created from
the wizard and driven through every owner operation; the hashes below are the owner's Horizon
history in order:

| Operation | Tx |
|---|---|
| `create_card` (factory v2) | [`ceaceb7b…c2039c`](https://stellar.expert/explorer/testnet/tx/ceaceb7bd83cebb42fa3178da035e084506d956d166ab24f0da446941fc2039c) |
| `add_merchant` (from the wizard) | [`f63c15d7…bffa8a`](https://stellar.expert/explorer/testnet/tx/f63c15d790289747251ba5b0d6c9a08ce97e7bed9e612facd9d0b9e20abffa8a) |
| fund: SAC `transfer` owner → card, 1 USDC | [`a920f9ea…adbe3c`](https://stellar.expert/explorer/testnet/tx/a920f9ea4620449709a3763f14a6e393619279d609991fc7f771b9eebbadbe3c) |
| `set_policy` (20 USDC / day, cap 5) | [`a07e78ab…7e048a`](https://stellar.expert/explorer/testnet/tx/a07e78ab07434eaa072dab9476fd9a6628828957a8721b81207fe506067e048a) |
| `add_merchant` | [`f9ee9f3b…01b184`](https://stellar.expert/explorer/testnet/tx/f9ee9f3b6c5a9b4b2fe0c941d031815cfb2c94dba17b6c1ad60856885201b184) |
| `remove_merchant` | [`05068bd1…fb42c9`](https://stellar.expert/explorer/testnet/tx/05068bd1d1ac68eda7f08961fa53f573a560d87390b398017b89e124bafb42c9) |
| `set_signer` → `GC3PG3W2…LNR5` | [`5cb87aed…58950d`](https://stellar.expert/explorer/testnet/tx/5cb87aed0a2dd75796d93ef66015520af7c096443819825329b9c991ef58950d) |
| `freeze` | [`d871f707…b74bf0`](https://stellar.expert/explorer/testnet/tx/d871f707fbcfda2a37fa70060cdddb1b388686bcbf94f3f9e579389245b74bf0) |
| `unfreeze` | [`71cb4215…d4b1eb`](https://stellar.expert/explorer/testnet/tx/71cb421597e23b26a1abc21c3fd4333f0d3abbaea25b5bd53a4ebebed4d4b1eb) |
| `mooring pay` `/weather` (0.001 USDC, x402 via OZ Channels, signed with the rotated key) | [`903567d2…1a0e9e`](https://stellar.expert/explorer/testnet/tx/903567d20e1e68491b75629b9969a87f82d719e9ba015da7355731c3d71a0e9e) |
| `withdraw` 0.5 USDC | [`a4c244fc…4bdc15`](https://stellar.expert/explorer/testnet/tx/a4c244fc3053fb5f3f413632fb3cd28a857bb950d33162565d90d42cef4bdc15) |
| `cancel` (balance swept to the owner; final state `Cancelled`) | [`2bd31d0b…245d81`](https://stellar.expert/explorer/testnet/tx/2bd31d0b8d0462a48c7c8ffb84e423cfabe653104086f25f5313e9164e245d81) |

`mooring pay` against `/premium` (20 USDC, above the 5 USDC per-tx cap) was refused by the
client's local precheck (`over_per_tx_cap`) before anything was signed. Screenshots are linked from the checklist table in `docs/web-app.md` (`docs/screenshots/`).

**Rejected payment while frozen (2026-10-07).** To pair the D3 flow with an on-chain policy
rejection, the legacy card `CBOOOQDW…UH5W` (`inference-agent`, 11.30 USDC, merchant allowlisted)
was frozen from the owner key, paid against, and unfrozen:

| Step | Result | Tx |
|---|---|---|
| `freeze` | state → Frozen (`StateChanged`, state 1) | [`4cea427d…6ce5d9`](https://stellar.expert/explorer/testnet/tx/4cea427db6f5acf3b78f07ebd5c64c75a17d60c30933424396f3d902556ce5d9) |
| `mooring pay /weather` with the local precheck | `Denied (frozen) at precheck` — nothing signed | — |
| `mooring pay /weather --no-precheck` | `Denied (frozen) at simulate` — `__check_auth` refused the transfer in simulation, nothing submitted | — (no transaction exists; the refusal is the evidence) |
| `unfreeze` | state → Active (`StateChanged`, state 0) | [`ab5d94de…4ff047`](https://stellar.expert/explorer/testnet/tx/ab5d94de677dba80e92f210a56be23a1fa85b876765320824ea4d44f584ff047) |

The same run against the cancelled `inference-agent-2` card gives `Denied (cancelled) at precheck`;
with the precheck disabled the SAC refuses first (`Error(Contract, #10)`, zero balance after the
cancel sweep), so the frozen card is the cleaner evidence.

## Paying a third-party x402 merchant (2026-10-31)

Every payment above went to Mooring's own example server. This run pays a merchant Mooring
has no relationship with — Rail402's public demo seller — to show that a card settles against
a stock x402 resource server behind a **different facilitator** (Rail402's hosted testnet
facilitator, not OZ Channels), with no change on the merchant side.

Merchant terms, read from the 402 at `https://demo.rail402.dev/weather`: `scheme: exact`,
`network: stellar:testnet`, asset `CBIELTK6…DAMA` (the same USDC SAC the card holds),
0.001 USDC to `GBSVTVRQ4AEFRNGH2MIOOWZSAVLZKOKNKI4UAGSMBZSNRP4I3FL3ELYP`, fees sponsored. Card:
the legacy `CBOOOQDW…UH5W` (`inference-agent`), signed with its registered agent key.

| Step | Result | Tx |
|---|---|---|
| `set_policy` (the card's policy had expired on 2026-10-13; expiry +30 days, budget and cap unchanged) | `PolicyChanged` | [`02d3e7fe…a0c410`](https://stellar.expert/explorer/testnet/tx/02d3e7fe7397f3635b824bb2eaef8e717779c452893c46c15e9eb776c6a0c410) |
| `add_merchant` `GBSVTVRQ…ELYP` | `MerchantAdded`, allowlist 1 → 2 | [`6d6d72cb…45cb82`](https://stellar.expert/explorer/testnet/tx/6d6d72cb53527a2ce436e8f773ad4c8c99e7eac6f0cb7a6b2649c3739c45cb82) |
| `mooring pay https://demo.rail402.dev/weather` | HTTP 200, body `{"city":"Istanbul","temperature":21,"conditions":"sunny"}`; on-chain `spent` 0 → 0.001 USDC, balance 11.297 → 11.296 | [`ef32cfdb…adbeaf`](https://stellar.expert/explorer/testnet/tx/ef32cfdb19bf51637fbff79b176e963486dd325de5be0c344233287a73adbeaf) |
| `mooring pay https://try-cli-jukj.onrender.com/fortune` (another Rail402-listed seller, **not** on the allowlist) | `Denied (not_allowlisted) at precheck`, exit 2 — nothing signed | — |

The settlement was submitted by Rail402's facilitator account (`GBI2AUZW…Y5OO`, fee-bumped by
`GDKMZDQW…GH62`, 12 144 stroops charged), and the ledger shows `contract_debited` 0.001 USDC from
the card and `account_credited` to the merchant. So a Mooring card is not tied to one
facilitator: any facilitator built on `@x402/stellar` that re-simulates the payload accepts the
card's custom-account authorization as-is.

Third-party sellers on Stellar testnet were found through Rail402's discovery endpoint
(`https://testnet.rail402.dev/discovery/resources`); the same shape (`accepts[].payTo`,
`network`, `asset`) is what a merchant directory in the web app would read instead of asking
the owner to type an address.

## npm release 0.1.0 (2026-10-31)

`@mooring-live/x402-client@0.1.0` and `@mooring-live/cli@0.1.0` are published to npm under the
`mooring-live` organization (the `mooring` scope was taken). Verified from a clean directory
outside the workspace, against the registry only:

| Check | Result |
|---|---|
| `npm i @mooring-live/x402-client@0.1.0`, import `.` and `./errors` | 15 + 6 exports; `readCardInfo` / `readMerchants` read the legacy card from testnet |
| `npm i -g @mooring-live/cli@0.1.0` into a temp prefix | `mooring --version` → 0.1.0; `mooring status` prints the card |
| `mooring pay https://demo.rail402.dev/weather` with the installed CLI | HTTP 200, 0.001 USDC settled by Rail402's facilitator — [`68d68866…79fad8`](https://stellar.expert/explorer/testnet/tx/68d68866615567867f532f4f4d5ccee2f9819af23e014dc101da21d7f479fad8) |

Right after publishing, npm served a `0.0.0-stage` placeholder for a few minutes and a cached
metadata read made `npm i …@0.1.0` fail with `ETARGET`; `--prefer-online` (or waiting) resolves it.

## Merchant resolution — allow by URL and the denial link (2026-11-01)

Owner-run verification of PR #15 on the branch's preview deployment (real Freighter, testnet), legacy
card `CBOOOQDW…UH5W` imported with "Add existing card" (which now also checks the contract runs the
v2 card WASM `158b6acf…` before trusting `info()`):

| Step | Result | Tx |
|---|---|---|
| Card screen → "+ Add" → `https://playground.rail402.dev/lab/sell/forecast/istanbul` → Look up → "Allow playground.rail402.dev" | preview showed price, network, `payTo` and the responsibility notice; `add_merchant` signed in Freighter, allowlist 2 → 3 | [`b4b423ad…ab34cd`](https://stellar.expert/explorer/testnet/tx/b4b423adc882c3dc314957885eaf9f4dab44d9798a9d15eb70a2cb63daab34cd) |
| Same URL resolved again | "Already allowed", no transaction | — |
| `mooring pay https://playground.rail402.dev/lab/sell/forecast/istanbul` | HTTP 200 (7-day forecast), 0.01 USDC settled by Rail402's facilitator | [`cf51d876…689460`](https://stellar.expert/explorer/testnet/tx/cf51d876d5fbeaafb9e02ced1624705f79b0a86bca407cd7d1d2dd463c689460) |
| `/allow?card=CBOO…UH5W&url=https%3A%2F%2Ftry-cli-jukj.onrender.com%2Ffortune` (the link the client prints on `not_allowlisted`) | "This request came from a link…" + notice; "Allow try-cli-jukj.onrender.com" signed; allowlist 3 → 4 | [`739d6edd…e5efb3`](https://stellar.expert/explorer/testnet/tx/739d6edd40626d975f2fa18959c2e6a1066d5f2e63d7a75e63036233c5e5efb3) |
| `mooring pay https://try-cli-jukj.onrender.com/fortune` | HTTP 200, 0.01 USDC settled | [`99d91c28…1d2e21`](https://stellar.expert/explorer/testnet/tx/99d91c2817270cac97b50410e48a6890464f9f75137460eed6bafc6ab61d2e21) |

Before the second allow, the same CLI run against the fortune seller printed
`Denied (not_allowlisted) at precheck` followed by `Allow it: https://app.mooring.live/allow?card=…&url=…`
and exited 2 with nothing signed — the link above is that output with the preview host swapped in.
The resolver was also probed directly against the real sellers (Rail402 demo, playground, the Render-hosted
fortune seller) and refused `127.0.0.1`, `localhost` (without `MOORING_RESOLVER_ALLOW_LOCAL`) and a non-x402
page with the expected codes; the WASM check accepted both Mooring cards and refused the USDC SAC and the
factory.

## `mooring create` — CLI cards at the app's salt (2026-11-23, Instaward #2 D2(b))

`@mooring-live/cli@0.3.0` adds `mooring create`: an owner-signed `create_card` through the v2
factory at the **next unused index-based salt**, the same derivation the web app probes
(`deriveCardAddress`, `discoverCards`, now exported from `@mooring-live/x402-client`). Cards made
this way appear on every device without "Add existing card". Run with a throwaway, friendbot-funded
owner (`stellar keys generate … --fund`; the secret only ever lived in `OWNER_SECRET` of a subshell):

| | Card | Salt | Tx |
|---|---|---|---|
| `--label "cli card" --budget 1 --period 1d --max-per-tx 0.25` | `CBI3L3KLF63F2I72ZGHVC766JZCDPBCTLQVLP7X36G5MB3DVD62CV7RY` | 0 | `ca2a7f2d27c256027258cecd46cea644c75da890c6847435365202be04a7ba95` |
| `--label "cli card 2" --budget 2 --period 12h --expiry +7d` | `CAXB2N4XYXXIUJNOCJVRAHVZJD262GSBIEJRHVW6BD3GY5LGPVDVD2D5` | 1 | `dc318b7e1f498b16fc0f42740bbbfce702ef4486ba86a0b76af5041f02b90d4b` |

Owner `GBXKAJETATENTZ2TAYVBYGOCNUWRRJHSIKUC2NPWKYN7ZULYHKJHTGIR`, agent signer
`GASYAIZQLKZKVLD233MDOTKKBHCB2NGP46RL7TYP6DNPOYAERYWSKRRR`. `mooring status --card … --json` read
the first card back (`label "cli card"`, `period_amount 10000000`, `max_per_tx 2500000`,
`period_duration 86400`); `discoverCards(owner)` against `soroban-testnet.stellar.org` returned
exactly these two addresses in salt order, so the app lists both for that owner with no import.

## Merchant directory → `mooring pay` (2026-11-24, Instaward #2 D1(a) + D2(b) evidence)

Week-1 evidence run on app.mooring.live (PRs #24–#26 deployed) with the `mooring create` cards
above. The owner imported the throwaway owner key into a fresh browser profile's Freighter; the app
listed both CLI cards without "Add existing card" ([screenshot](screenshots/20-cli-cards-discovered.jpg)).
`cli card` was funded with 1 USDC from the merchant test account
([`6b0248fd…29b9`](https://stellar.expert/explorer/testnet/tx/6b0248fdee3fcd27ae9ce59e6561833a1f749e381696fa9f55503dbb0e8c29b9)),
then `demo.rail402.dev/weather` was picked from **Browse services** (Rail402 source, 0.001 USDC),
re-confirmed through the live 402 lookup and the confirmation modal, and signed in Freighter —
Merchants `1 / 32` ([screenshot](screenshots/21-directory-merchant-added.jpg)). The agent then paid it:

| Step | Result |
|---|---|
| `mooring pay https://demo.rail402.dev/weather --card CBI3…V7RY` (agent key `GASY…KRRR`) | HTTP 200 `{"city":"Istanbul","temperature":21,"conditions":"sunny"}`; settlement [`e343161a…3be0`](https://stellar.expert/explorer/testnet/tx/e343161a4264c407bf1556d32080b54195fe4eb978c55478f9ca18b5da0f3be0) (`stellar:testnet`, fees sponsored, ledger 5904134) |
| `mooring status --card CBI3…V7RY --json` afterwards | `period.spent 10000`, `remaining 9990000`, `balance 9990000`, merchants `[GBSV…ELYP]` |

`GET /api/directory?network=stellar:testnet` on the same day returned 19 payable testnet rows
(Rail402, StellarSight, MPP Router) and 379 read-only mainnet rows (367 flagged `proxy`).

### Testnet protocol 30 and the SDK bump

The first `mooring pay` attempt with the published `0.3.0` packages failed before signing with
`LedgerHeader.scpValue.ext.v: unknown enum value 3`: testnet had upgraded to **protocol 30**, and
`@stellar/stellar-sdk` 17.0.1 (and the 16.x copy nested under `@x402/stellar` 2.25.0) decode the
ledger header in `getLatestLedger()` with an XDR that predates it. The workspace now pins
`@stellar/stellar-sdk` **17.4.0** and `@x402/{core,fetch,stellar,express}` **2.32.0** (a single
hoisted SDK copy), the runtime guard still sees legacy (v1) credentials, and the payment above
was made with the rebuilt client. Published as `@mooring-live/x402-client@0.3.1` and
`@mooring-live/cli@0.3.1`; `0.3.0` cannot pay on protocol-30 networks.

## Indexer v1 live on app.mooring.live (2026-11-26, Instaward #2 D2(a) evidence)

PR #28 (indexer inside `apps/web`, Neon Postgres through the Vercel Marketplace, read-time ticks +
daily cron — see `docs/indexer.md`) went live on 2026-11-26. Before the database was connected the
read API degraded as designed: `GET /api/cards?owner=…` answered `503 {"error":"no_database"}` and the
app kept using the salt probe. The owner then connected Neon (Frankfurt, Free plan, `DATABASE_URL`
on Production + Preview) and the history was imported in one run:

| Step | Result |
|---|---|
| `npm run db:migrate` | `applied 9 statements` (idempotent schema) |
| `npm run indexer:backfill` (stellar.expert history since the v2 factory, Horizon for hashes) | `{"cards":8,"events":128,"written":128,"hashesResolved":128,"unresolved":0}` — 8 cards, 114 card events, 22 USDC transfer legs, first event 2026-09-13 02:21:42 Z (factory v2's first `card_created`), every event with a tx hash |
| Card labels | a label is a constructor argument, so no event carries it; the tick/backfill/`track` now read `info().label` on-chain (this PR). All 8 rows labelled: `inference-agent`, `inference-agent-2`, `Test`, `dry-agent`, `research-agent` ×2, `cli card`, `cli card 2 renamed` |
| Live tick | the first reads after the import walked the RPC window in 10 000-ledger chunks (`x-mooring-index-stale: 1` while catching up): 13 read-time ticks of 4–11 s between 13:48 and 13:52 Z took the cursor from ledger 5 834 421 to 5 935 504 (head 5 935 509), after which `/api/cards` answered in ~0.5 s with `stale: false` |

Live read API, same day (owner `GCJJ…KKBD`, the app's own two cards):

```
GET https://app.mooring.live/api/cards?owner=GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD   → 200
{"owner":"GCJJ…KKBD","cards":[
  {"card":"CBOOOQDW…UH5W","label":"inference-agent","createdAt":"2026-09-13T02:21:42.000Z",
   "createdTx":"39cc9e2743f9a2866e7ce280774ec9c816d3220b281a7bb6f974e42b0cecca8e","trackedBy":"factory"},
  {"card":"CCFZQBAF…IEYV","label":"inference-agent-2","createdAt":"2026-09-25T17:33:32.000Z",
   "createdTx":"ceaceb7bd83cebb42fa3178da035e084506d956d166ab24f0da446941fc2039c","trackedBy":"factory"}],
 "stale":false}
```

The week-1 CLI card's feed is the week-1 evidence seen from the index — the same funding, allowlist
and settlement hashes recorded above, newest first:

```
GET https://app.mooring.live/api/cards/CBI3L3KLF63F2I72ZGHVC766JZCDPBCTLQVLP7X36G5MB3DVD62CV7RY/activity → 200
payment        ledger 5904134  2026-11-24T18:18:32Z  10000 (0.001 USDC) → GBSV…ELYP  tx e343161a…3be0  merchantName "demo.rail402.dev"
merchant_added ledger 5903743  2026-11-24T17:45:57Z  GBSV…ELYP                        tx 4e246e69…9293
funded         ledger 5903661  2026-11-24T17:39:07Z  10000000 (1 USDC) ← GAW3…LOIG     tx 6b0248fd…29b9
created        ledger 5883567  2026-11-23T13:44:37Z                                   tx ca2a7f2d…ba95
```

Merchant-name sync without a wallet signature: `POST …/merchants/GBSV…ELYP/label {"url":"https://demo.rail402.dev/weather"}`
re-resolved the live 402, found `payTo` equal to the allowlisted key on `stellar:testnet`, and stored
`{"name":"demo.rail402.dev","url":"https://demo.rail402.dev/weather"}` (200); the activity row above and
`GET …/merchants` now carry that name on every device. `inference-agent` (`CBOO…UH5W`, the oldest card)
lists 74 events and 8 transfer legs back to 2026-09-13, with the full 32-merchant allowlist history
folded into `GET …/merchants` (added/removed timestamps and tx hashes). The card screen renders the same
feed with tx links ([screenshot](screenshots/22-activity-feed.jpg)).

## Week 3 — MPP charge, guard rails, kit (2026-11-28, Instaward #2 D3(a)/D3(b)/D1(b) evidence)

Real testnet payments from the week-1 CLI card (`cli card`,
`CBI3L3KLF63F2I72ZGHVC766JZCDPBCTLQVLP7X36G5MB3DVD62CV7RY`, agent key
`GASYAIZQLKZKVLD233MDOTKKBHCB2NGP46RL7TYP6DNPOYAERYWSKRRR`) to Mooring's own seller
(`apps/seller`), with the workspace builds of `@mooring-live/x402-client` 0.4.0, `@mooring-live/cli`
0.4.0 and `create-mooring-agent` 0.1.0.

**Setup.** The seller ran **locally** (`node apps/seller/dist/src/dev.js` on `127.0.0.1:3002`) with
the production configuration: the production MPP card-charge verifier, the real OZ Channels testnet
facilitator for x402, `STELLAR_NETWORK=stellar:testnet`, a fresh random `MPP_SECRET_KEY`, and
`SELLER_PAY_TO=GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG`. The hosted
`api.mooring.live` is not deployed yet; the same run against the hosted URL follows once it is live.

| Step | Tx | Ledger | Result |
|---|---|---|---|
| Friendbot funds the agent account (it pays the MPP fee itself) | [`ddfe18d9…bfa8`](https://stellar.expert/explorer/testnet/tx/ddfe18d9fbac22631923a15a7f05f8a924f9770f06105554db4a25f39f83bfa8) | 5 962 580 | `GASY…KRRR` created with 10 000 XLM |
| Owner `add_merchant GAW3…LOIG` (stellar CLI, owner key) | [`98c3fea6…7b1d`](https://stellar.expert/explorer/testnet/tx/98c3fea6657ceb339dd8aea87a46d3274148241a1cfff0bfcacdcce659cf7b1d) | 5 962 581 | `MerchantAdded`; `mooring status --json` → `allow_count: 2` |

Card before the run: balance 0.999 USDC, `period.spent` 0, remaining 1 USDC this period,
`max_per_tx` 0.25 USDC. `~/.mooring` did not exist; the first payment created it
(`receipts.jsonl`, `spend.json`).

Seller probes (headers only):

```
GET /health     → HTTP/1.1 200 OK
GET /quote      → HTTP/1.1 402 Payment Required   payment-required: eyJ4NDAyVmVyc2lvbiI6Miwi…   (x402 v2, exact, stellar:testnet)
GET /quote/mpp  → HTTP/1.1 402 Payment Required   WWW-Authenticate: Payment id="…", realm="127.0.0.1", method="stellar", intent="charge", request="…"
```

### Settlements

Each one is a single `invoke_host_function` (USDC SAC `transfer`) moving 0.001 USDC from the card to
`GAW3…LOIG`, authorized by the card's `__check_auth` (budget, allowlist, expiry). All successful on
Horizon.

| # | Route | Protocol | Tx | Ledger | Fee payer | Fee (stroops) | Amount |
|---|---|---|---|---|---|---|---|
| 1 | `mooring pay …/quote/mpp --json` | MPP charge (pull) | [`164401337afbf1d85558fef5230a2729f95e74be26675369861e9457ba8bcae4`](https://stellar.expert/explorer/testnet/tx/164401337afbf1d85558fef5230a2729f95e74be26675369861e9457ba8bcae4) | 5 962 588 | agent `GASY…KRRR` (tx source) | 31 649 | 0.001 USDC |
| 2 | `mooring pay …/quote/mpp` | MPP charge (pull) | [`da1a217e3dc25a2ad172903723206cb832a75e0577ce186d42ecedd79402162a`](https://stellar.expert/explorer/testnet/tx/da1a217e3dc25a2ad172903723206cb832a75e0577ce186d42ecedd79402162a) | 5 962 591 | agent `GASY…KRRR` (tx source) | 12 055 | 0.001 USDC |
| 3 | `mooring pay …/quote` | x402 (OZ Channels) | [`e6738ff55d80eefc51d7c09a2cb477788f317de3c2d4a67296f5f3bee1eaeac7`](https://stellar.expert/explorer/testnet/tx/e6738ff55d80eefc51d7c09a2cb477788f317de3c2d4a67296f5f3bee1eaeac7) | 5 962 592 | facilitator fee-bump `GA6T…H7TL` (inner source channel `GANM…OMWN`) | 12 155 | 0.001 USDC |
| 4 | kit `npm run pay` → `/quote` | x402 (OZ Channels) | [`46f5fdc724a66f386b95812bb31b57698f4a456d62588e7633c0de40cbab7df8`](https://stellar.expert/explorer/testnet/tx/46f5fdc724a66f386b95812bb31b57698f4a456d62588e7633c0de40cbab7df8) | 5 962 604 | facilitator fee-bump `GA6T…H7TL` (inner source channel `GCUK…O7QS`) | 12 155 | 0.001 USDC |

The first MPP charge cost more (31 649 stroops) than the second (12 055). It was the card's first
spend in the current budget period (started 2026-11-27 13:44 Z); the fee difference was not
broken down further.

`mooring pay http://127.0.0.1:3002/quote/mpp --card CBI3… --json` (payment 1):

```json
{
  "protocol": "mpp",
  "settlement": {
    "txHash": "164401337afbf1d85558fef5230a2729f95e74be26675369861e9457ba8bcae4",
    "amount": "10000",
    "payTo": "GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG",
    "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    "network": "stellar:testnet"
  },
  "receipt": { "v": 1, "id": "681e479e6fe9d6ee64211224a61692ff", "protocol": "mpp", "status": "settled", "…": "…" }
}
```

Payments 2 and 3 (text output):

```
$ mooring pay http://127.0.0.1:3002/quote/mpp --card CBI3…V7RY
HTTP 200
Protocol: mpp
Settlement: da1a217e3dc25a2ad172903723206cb832a75e0577ce186d42ecedd79402162a (stellar:testnet)
Receipt: 2bef45b8b606d8f7ff7ede49ea28fa23
{"quote":"Hope is the thing with feathers that perches in the soul.","author":"Emily Dickinson","paidWith":"mpp","ts":"2026-11-28T03:30:00.395Z"}

$ mooring pay http://127.0.0.1:3002/quote --card CBI3…V7RY
HTTP 200
Protocol: x402
Settlement: e6738ff55d80eefc51d7c09a2cb477788f317de3c2d4a67296f5f3bee1eaeac7 (stellar:testnet)
Receipt: 57a325257ab99f3ef5785e337a57ab1f
{"quote":"Hope is the thing with feathers that perches in the soul.","author":"Emily Dickinson","paidWith":"x402","ts":"2026-11-28T03:30:02.615Z"}
```

### Guard rails — refusals, stop/resume

```
$ mooring pay http://127.0.0.1:3002/quote/mpp --card CBI3…V7RY --daily-cap 0.0005
refused before signing: daily_cap (0.001 USDC attempted, limit 0.0005)
exit 2
$ mooring stop --reason "week-3 evidence"
stopped (/Users/beko/.mooring/stop)
$ mooring pay http://127.0.0.1:3002/quote/mpp --card CBI3…V7RY
refused before signing: stopped (0.001 USDC attempted)
exit 2
$ mooring resume
resumed
$ mooring guard --card CBI3…V7RY
Card:         CBI3L3KLF63F2I72ZGHVC766JZCDPBCTLQVLP7X36G5MB3DVD62CV7RY
Day:          2026-11-28
Spent today:  0.003 USDC
Spent total:  0.003 USDC
Reserved:     0 USDC
Daily cap:    none
Total cap:    none
Max per tx:   none
Stopped:      no
```

Neither refusal reached the network: no transaction, no signature over a payment. Both are written
to the ledger as signed `denied` receipts (`reason` `daily_cap` — the fourth CSV row below — and
`stopped`, receipt `27b5af907b8503a68f6fdd835d9ff897`, the fifth entry).

### Receipt ledger

`mooring receipts export --csv | head -5`:

```
id,ts,protocol,card,agent,payTo,amount,asset,network,url,status,txHash,reason,sig
681e479e6fe9d6ee64211224a61692ff,2026-11-28T03:29:45.283Z,mpp,CBI3L3KLF63F2I72ZGHVC766JZCDPBCTLQVLP7X36G5MB3DVD62CV7RY,GASYAIZQLKZKVLD233MDOTKKBHCB2NGP46RL7TYP6DNPOYAERYWSKRRR,GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG,10000,CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA,stellar:testnet,http://127.0.0.1:3002/quote/mpp,settled,164401337afbf1d85558fef5230a2729f95e74be26675369861e9457ba8bcae4,,115396a48cf9400337ce32223e5e1ccd377133dc01e04cc4ac5ddd719996ebe708329377efd2cf2bb20be7a2943b319d3729285e09c258fc4a66a9240b1e5204
2bef45b8b606d8f7ff7ede49ea28fa23,2026-11-28T03:30:00.404Z,mpp,CBI3L3KLF63F2I72ZGHVC766JZCDPBCTLQVLP7X36G5MB3DVD62CV7RY,GASYAIZQLKZKVLD233MDOTKKBHCB2NGP46RL7TYP6DNPOYAERYWSKRRR,GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG,10000,CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA,stellar:testnet,http://127.0.0.1:3002/quote/mpp,settled,da1a217e3dc25a2ad172903723206cb832a75e0577ce186d42ecedd79402162a,,9aacea38b4ca3c862b8c5b96c37c9e57f9573b0c9aa37a0e4595831079ef849c570616ca0fd80b68dbe36ab2d4f4639fefa504a627eed931660dbbbdaf40410c
57a325257ab99f3ef5785e337a57ab1f,2026-11-28T03:30:09.117Z,x402,CBI3L3KLF63F2I72ZGHVC766JZCDPBCTLQVLP7X36G5MB3DVD62CV7RY,GASYAIZQLKZKVLD233MDOTKKBHCB2NGP46RL7TYP6DNPOYAERYWSKRRR,GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG,10000,CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA,stellar:testnet,http://127.0.0.1:3002/quote,settled,e6738ff55d80eefc51d7c09a2cb477788f317de3c2d4a67296f5f3bee1eaeac7,,5e80d1c00b9d5d7ffdb7aa985a90666987dcfa5794cb9ab5d80d2df1324a97fc7ecbb8239eec456016075b41a62b78f5dc38bf7eb2d65f894a43ba6e7de7c00d
22016689818096d5ee0781b94fc68c5a,2026-11-28T03:30:36.914Z,mpp,CBI3L3KLF63F2I72ZGHVC766JZCDPBCTLQVLP7X36G5MB3DVD62CV7RY,GASYAIZQLKZKVLD233MDOTKKBHCB2NGP46RL7TYP6DNPOYAERYWSKRRR,GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG,10000,CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA,stellar:testnet,http://127.0.0.1:3002/quote/mpp,denied,,daily_cap,a453c8aa23053c22cfb65f330dec3cc55e3d58afa6dc044710b93d2de0aea07ed6e44a2cd1496f56a4860afffa3c8c066886d92d446f5312fa616efb7a75c207
```

`mooring receipts verify` → `verified 5 receipts` (after the kit payment below: `verified 6
receipts`). `sig` is the agent key's public Ed25519 signature over the receipt; it carries no secret.

### Kit — `create-mooring-agent`

```
$ node packages/create-mooring-agent/dist/index.js <scratch>/mooring-kit-evidence --service http://127.0.0.1:3002/quote
Created mooring-kit-evidence in <scratch>/mooring-kit-evidence
It pays http://127.0.0.1:3002/quote on stellar:testnet from a Mooring card.

Next steps (in <scratch>/mooring-kit-evidence):
1. Create and fund a card at https://app.mooring.live and generate an agent key there (or `mooring keygen`); register the key as the card's signer.
2. Copy `.env.example` to `.env` and fill `MOORING_CARD` and `AGENT_SECRET`; fund the agent account with a little XLM on testnet (friendbot) for MPP fees.
3. `npm install && npm run pay`
```

`@mooring-live/x402-client` 0.4.0 is not on npm yet, so `npm install` was replaced by linking the
workspace packages (`@mooring-live/x402-client`, `@stellar/stellar-sdk`, `dotenv`, `tsx`,
`typescript`) into the kit's `node_modules`. `.env` was filled with the same card and agent key
(`MOORING_SERVICE=http://127.0.0.1:3002/quote`, `MOORING_NETWORK=stellar:testnet`) and deleted after
the run.

```
$ npm run pay
> mooring-kit-evidence@0.1.0 pay
> tsx src/agent.ts

Paid 0.001 USDC to GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG via x402
tx 46f5fdc724a66f386b95812bb31b57698f4a456d62588e7633c0de40cbab7df8 — https://stellar.expert/explorer/testnet/tx/46f5fdc724a66f386b95812bb31b57698f4a456d62588e7633c0de40cbab7df8
Remaining this period: 0.996 USDC
Receipt aa31fcbe07cf836eb45333dd759f3601 → /Users/beko/.mooring/receipts.jsonl
{"quote":"Hope is the thing with feathers that perches in the soul.","author":"Emily Dickinson","paidWith":"x402","ts":"2026-11-28T03:31:02.205Z"}
```

The kit shares `~/.mooring` with the CLI: after it, `mooring guard` shows `Spent today: 0.004 USDC`.

### Card after the run

`mooring status --card CBI3…V7RY --json`: `period.spent` 40000 (0.004 USDC), `remaining` 9960000
(0.996 USDC), `balance` 9950000 (0.995 USDC), `state` 0 (active), `allow_count` 2
(`GBSV…ELYP`, `GAW3…LOIG`). Four settled payments, two refused before signing, 0.004 USDC spent.
