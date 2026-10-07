# SCF Instaward #2 — evidence index

One entry per Statement-of-Work row. Every link below is public; the hashes resolve on
[Stellar Expert (testnet)](https://stellar.expert/explorer/testnet). Full context lives in
`docs/testnet.md` (contracts, payments, fees), `docs/x402-integration.md` (payment flow and
denial semantics) and `docs/web-app.md` (web app, checklist, screenshots).

| | |
|---|---|
| Repository | https://github.com/berkay1532/mooring (Apache-2.0, `LICENSE`) |
| CI | GitHub Actions on every PR — jobs `contracts` (Rust tests, fmt), `scripts` (TypeScript packages, unit tests), `web` (unit + Playwright + build); see the checks on PRs #1–#6 |
| Web app (live) | https://mooring-web.vercel.app |
| Landing page (live) | https://mooring-landing.vercel.app |
| Network | Stellar testnet; USDC SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |

## Deliverable 1 — card contract: repo + testnet tx hashes + CI

Public repo with the card contract (`contracts/card`, 78 tests) and factory (`contracts/factory`,
7 tests), CI green on PR #1. Testnet deployment v1 (2026-09-09): factory
`CCPVVXXD3CZG4HK7KRWKJG2RUZD6X6EZ5TB4P4ZB6CABETMS5OSBF4RL`, card
`CAJPWJBFBM6WMYZBRURA7VW3GKSLMHTHIIZIRFVFKUSAPWX4526YAHCJ`. Deployment v2 with the on-chain
label (2026-09-13, PR #3): factory `CBMSK4OSNLBEXTJWNEWX422RPVDEUNFEWADTSPECGBI26ESDYW65AUSE`,
card `CBOOOQDW4YA7JHDW4ELMKRFUUBJFBOJZGB4IXZJTHSAGUE4TWKJXUH5W`.

| Evidence | Tx |
|---|---|
| Successful policy check — card-paid transfer within policy (6 USDC) | [`0f19bfc8…3e532`](https://stellar.expert/explorer/testnet/tx/0f19bfc88b0b28d3454980a35c60627a8a22fae73745bf770a06060bac53e532) SUCCESS |
| Rejection — second overlapping payment over budget, refused on-chain by `__check_auth` | [`324aa540…93ece`](https://stellar.expert/explorer/testnet/tx/324aa5402e4a4f2e513025ee99ca4791cd3ec961b589febb8ab2446a5c793ece) FAILED, contract error #8 `OverBudget` |
| Rejection — payment from a frozen card (2026-10-07) | freeze [`4cea427d…ce5d9`](https://stellar.expert/explorer/testnet/tx/4cea427db6f5acf3b78f07ebd5c64c75a17d60c30933424396f3d902556ce5d9) → `Denied (frozen) at simulate` → unfreeze [`ab5d94de…4f047`](https://stellar.expert/explorer/testnet/tx/ab5d94de677dba80e92f210a56be23a1fa85b876765320824ea4d44f584ff047) |

Details, fee measurements and the migration to v2: `docs/testnet.md` ("Evidence", "Deployment v2").

## Deliverable 2 — x402 integration: CLI walkthrough + tx hashes + repo

`@mooring/x402-client` (`packages/x402-client`, 73 tests), the `mooring` CLI (`packages/cli`:
`keygen`, `status`, `pay`) and the example merchant server (`examples/merchant-server`, `@x402/express`
+ `@x402/stellar`, OpenZeppelin Channels testnet facilitator). Merged in PR #2. Walkthrough:
`README.md` → "Pay an API from a card" and `docs/x402-integration.md` → "From the CLI".

| Evidence | Result |
|---|---|
| Settled payment, budget decrement | `GET /weather` ($0.001) paid from the card → HTTP 200; settlement [`bc1b78eb…ccbba`](https://stellar.expert/explorer/testnet/tx/bc1b78eb2c0f4112d47f8faed70f608429a383d38a24f67ddda72f64453ccbba) (fee-sponsored by the facilitator, payer = the card contract); card `spent` 0 → 10 000 stroops |
| Settled payment from the app-created card (2026-09-25) | [`903567d2…a0e9e`](https://stellar.expert/explorer/testnet/tx/903567d20e1e68491b75629b9969a87f82d719e9ba015da7355731c3d71a0e9e), signed with the rotated agent key |
| Over-budget rejection | `GET /premium` ($20 > `max_per_tx`) → `CardPolicyDenied` `over_per_tx_cap` at `precheck`, nothing signed |
| Allowlist rejection | unlisted merchant, precheck disabled → `CardPolicyDenied` `not_allowlisted` at `simulate`, contract error #6; the same payload presented to OZ Channels `/verify` → `isValid: false` |

Details: `docs/testnet.md` ("D2 evidence", "D3-A e2e re-run"), `docs/x402-integration.md` ("Evidence").

## Deliverable 3 — web app: live link + docs + repo

Live: https://mooring-web.vercel.app (Freighter, testnet). Flow covered: create and fund a card →
agent payment → live budget/balance → freeze/unfreeze, withdraw, cancel → rejected payment.
Merged in PR #4 (257 unit tests, 20 Playwright flows in CI). Docs: quickstart `README.md` and
`docs/web-app.md` ("Run locally"), architecture `docs/design.md` and `docs/web-app.md`
("Architecture"), integration guide `docs/x402-integration.md`. License Apache-2.0.

Manual testnet run with the real Freighter extension (2026-09-25), card
`CCFZQBAFDJEC635N5DWJYX53GNIOOZPGO3AQXMZ7KRATMA2XVVLKIEYV` created from the app — all twelve
transactions in `docs/web-app.md` ("Checklist") and `docs/testnet.md` ("D3 — web app"):
`create_card` [`ceaceb7b…2039c`](https://stellar.expert/explorer/testnet/tx/ceaceb7bd83cebb42fa3178da035e084506d956d166ab24f0da446941fc2039c),
fund [`a920f9ea…dbe3c`](https://stellar.expert/explorer/testnet/tx/a920f9ea4620449709a3763f14a6e393619279d609991fc7f771b9eebbadbe3c),
`set_policy` [`a07e78ab…e048a`](https://stellar.expert/explorer/testnet/tx/a07e78ab07434eaa072dab9476fd9a6628828957a8721b81207fe506067e048a),
`set_signer` [`5cb87aed…8950d`](https://stellar.expert/explorer/testnet/tx/5cb87aed0a2dd75796d93ef66015520af7c096443819825329b9c991ef58950d),
`freeze` [`d871f707…74bf0`](https://stellar.expert/explorer/testnet/tx/d871f707fbcfda2a37fa70060cdddb1b388686bcbf94f3f9e579389245b74bf0),
`unfreeze` [`71cb4215…d4b1eb`](https://stellar.expert/explorer/testnet/tx/71cb421597e23b26a1abc21c3fd4333f0d3abbaea25b5bd53a4ebebed4d4b1eb),
`withdraw` [`a4c244fc…bdc15`](https://stellar.expert/explorer/testnet/tx/a4c244fc3053fb5f3f413632fb3cd28a857bb950d33162565d90d42cef4bdc15),
`cancel` [`2bd31d0b…45d81`](https://stellar.expert/explorer/testnet/tx/2bd31d0b8d0462a48c7c8ffb84e423cfabe653104086f25f5313e9164e245d81),
plus the merchant add/remove pair. Screenshots: `docs/screenshots/`. Rejected payments: the
over-cap denial above and the frozen-card refusal listed under Deliverable 1.
