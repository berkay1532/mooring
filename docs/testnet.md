# Testnet deployment (D1)

Network: Stellar testnet (`Test SDF Network ; September 2015`). Testnet resets quarterly; re-run `scripts/testnet/deploy.sh` after a reset.

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

| Allowlist size | minResourceFee | vs. 50 000 ceiling |
|---|---|---|
| 1 merchant | 33 926 stroops | within, ~32 % headroom |
| 32 merchants (full) | 49 380 stroops | within, ~1.2 % headroom |

Measured 2026-09-12 with a 32-merchant allowlist: minResourceFee = 49380 stroops → within the
50 000 default ceiling. The allowlist is a bounded `Vec` scanned (and rewritten) linearly, so a
full list makes `__check_auth` touch a larger instance entry than the 1-merchant case; the margin
above the ceiling shrinks from ~32 % to ~1.2 % accordingly. See the "Open measurement" section of
`docs/spike-w1-auth-mechanism.md` for the reduction options considered (not implemented, since
the measurement stayed within the ceiling) if this margin ever needs to grow.

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
