# Upstream PR: contract payers in `stellar/stellar-mpp-sdk` pull mode

## Not for the upstream PR

Mooring cards are Soroban custom accounts (`__check_auth`). The `@stellar/mpp` charge server refuses
them as payers, even in pull mode, where the server's enforce-mode simulation already validates
their authorization. Mooring's hosted seller carries this fix locally. This branch offers the same
change upstream. Everything in this section is Mooring-internal context; only the fenced PR title
and body below go into the upstream pull request.

- **Fork:** https://github.com/berkay1532/stellar-mpp-sdk
- **Branch:** https://github.com/berkay1532/stellar-mpp-sdk/tree/contract-payers-pull-mode
- **Base:** `stellar/stellar-mpp-sdk` `main` at `95815ac` ("fix: bump stellar-sdk to 17.4.0 for Protocol 30 (#102)")
- **Commits:**
  - `f267db692e777b1d111be5f0d5c3b99f83e0f071`: charge/server: accept contract (custom account) payers in pull mode
  - `39444d9445bc98c5c803435d01a96da9fb5a904b` (HEAD): charge/server: skip the off-chain signature check only for the payer's own contract entry
- **Open the pull request (owner):**
  https://github.com/stellar/stellar-mpp-sdk/compare/main...berkay1532:stellar-mpp-sdk:contract-payers-pull-mode?expand=1

Status: the branch is pushed. The pull request is not open yet. The owner opens it from the compare
URL above with the title and body below.

Before opening:

- Fill in the "Testnet evidence" line of the PR body.
- Once the PR number exists, add a commit to the branch that appends the
  `[#NNN](https://github.com/stellar/stellar-mpp-sdk/pull/NNN)` link to the CHANGELOG entry's lead
  line, as upstream does for other entries.

## PR title

```
charge/server: accept contract (custom account) payers in pull mode
```

## PR body

```markdown
## What

The charge server now accepts a contract (Soroban custom account, `C…`) payer for pull-mode
(`type="transaction"`) credentials.

- New `payerFromDID` for pull mode. It accepts `did:pkh:stellar:{network}:{G… | C…}`, using
  `StrKey.isValidEd25519PublicKey || StrKey.isValidContract`. The invalid-DID error messages are
  unchanged.
- `validateAuthEntries` (sponsored path) skips `verifyAuthEntrySignature` only for the **payer's
  own** contract entry: the authorizer is `scAddressTypeContract` and equals the transfer's `from`.
  - Any other contract authorizer is still verified off-chain, and so rejected with
    `Auth entry signature is invalid.`
  - Every other check still applies: address credentials only, the server address excluded, the
    expiration window, no sub-invocations, and coverage of exactly the settled transfer by the
    payer's entry.
- Push mode (`signedHash` / `hash`) is unchanged. It still uses `publicKeyFromDID` /
  `Keypair.fromPublicKey`, so a `C…` source is still rejected with
  `Credential source contains an invalid Stellar public key.`
- Unsponsored pull (no `feePayer`) is unchanged: the client-built tx is simulated and broadcast
  as-is, the client pays its own fee, and the network enforces `__check_auth` at apply.
- The `from === payer` check and all other transfer and simulation-event checks are unchanged.
- The `verifyAuthEntrySignature` docstring notes that a caller may skip it for the payer's own
  contract authorizer and rely on an enforce-mode simulation.

## Why

Soroban custom accounts, such as spending-limit smart wallets, authorize a token transfer through
their own `__check_auth`. The signature field of their auth entry is whatever that contract
expects, and it cannot be verified off-chain. Today such payers are refused at two points:

1. `publicKeyFromDID` calls `Keypair.fromPublicKey`, so a `C…` DID fails.
2. `verifyAuthEntrySignature` rejects contract authorizers by design.

On the sponsored pull path, the server already simulates the rebuilt transaction in **enforce**
mode before it broadcasts. That simulation runs the contract's `__check_auth` against ledger state,
and it is the authority for a custom account's authorization. It rejects, before broadcast, an
authorization that `__check_auth` refuses against current ledger state. As with a `G…` payer whose
balance changes after simulation, a state change between simulation and apply can still fail the
transfer at apply time. The sponsor's exposure is bounded by `maxFeeBumpStroops`, and no receipt is
issued unless the transaction succeeds on-chain. For `G…` payers, and for any contract entry that
is not the payer's, the off-chain signature check stays in place as defense in depth.

Push mode stays account-only. In push mode the credential holder must sign
`{challenge.id}:{hash}` with the payer's ed25519 key, and a contract cannot do that.

## How tested

New unit tests in `sdk/src/charge/server/Charge.test.ts`, written in the existing fixture style:

- `charge validateAuthEntries (sponsored path) › contract (custom account) payer`
  - accepts a contract payer whose authorization is validated by the enforce-mode simulation (the
    mock refuses any simulation that is not in `enforce` mode, and the auth entry carries an opaque
    custom-account signature that cannot be verified off-chain)
  - rejects a contract payer before broadcast when the simulation refuses its authorization
  - rejects a contract payer whose auth entry authorizes a different transfer
  - rejects an extra contract-address auth entry alongside a `G…` payer
  - rejects a contract payer tx that also carries another contract authorizer
  - still rejects a contract payer auth entry that contains sub-invocations
- `charge push-mode sender verification`
  - rejects a contract (`C…`) source DID in push mode (`hash` and `signedHash`)

The new pull-mode tests fail without the change. The push-mode tests pass both before and after,
which shows push mode is unchanged.

Local run on Node 25.1 / pnpm 10.33.0:

- `pnpm run format:check`: all files use Prettier code style
- `pnpm run lint`: clean
- `pnpm run check:types`: clean
- `pnpm test -- --run`: 32 files, 590 tests passed
- `pnpm run build`: clean

The existing `G…` pull-mode and sponsored-path tests all still pass (160 tests in the charge
server suite).

Not run: `pnpm audit` (no dependency changes), `/e2e-check` and `test:integration`, which need live
testnet access and secrets.

Testnet evidence: <tx hash of a custom-account payer settled through a server carrying this patch — added before opening the PR>

A `CHANGELOG.md` entry is added under `[Unreleased] › Added`.
```

## Verification run

```
pnpm install --frozen-lockfile
npx vitest run sdk/src/charge/server/Charge.test.ts   # Test Files 1 passed (1) · Tests 160 passed (160)
pnpm run format:check && pnpm run lint && pnpm run check:types
pnpm test -- --run                                     # Test Files 32 passed (32) · Tests 590 passed (590)
pnpm run build
```
