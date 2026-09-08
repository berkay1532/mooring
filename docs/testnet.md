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
- `deploy.sh` checks each identity's on-chain account (via Horizon) and its
  USDC trustline before funding/creating a trustline, rather than only
  checking the local keystore. This is what makes "re-run after a reset"
  above actually safe: a local key can survive a testnet reset while its
  on-chain account and trustlines do not, and the script now detects and
  repairs that instead of silently skipping funding.

## Evidence

Filled in by Task 10.
