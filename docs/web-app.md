# Mooring web app (D3)

The owner-facing application for Mooring cards: connect a Stellar wallet, create and fund
cards, watch each card's budget live, and run every owner operation on-chain. It lives in
`apps/web` (`@mooring/web`) and talks to the card contract and the factory directly over
Soroban RPC — there is no Mooring backend and no server-side key material.

Two keys, two roles:

- **Owner** — a Stellar account in Freighter. Creates cards, funds them, edits policy,
  freezes, rotates the signer, withdraws, cancels. Signs every write in the app.
- **Agent** — the agent's own ed25519 keypair. The card stores the **public** key; the secret
  lives where the agent runs. **The app never generates, stores or sees an agent secret** — the
  owner pastes the agent's public key (`G…`). An owner without one runs `mooring keygen`
  (`packages/cli`), which prints the keypair once, in the owner's own terminal.

## Screens

| Route | What it does |
|---|---|
| `/` | Connect. Detects Freighter, explains what the wallet is for when it is missing, and blocks with a single notice when Freighter is on the wrong network. Goes to `/cards` on success. |
| `/cards` | My cards. 3D carousel (selected card centred) or list view, plus the selected card's details: balance, remaining this period, per-tx cap, expiry, policy, merchants, agent signer, danger zone. Owner actions: fund, freeze/unfreeze, withdraw, cancel, rename (`set_label`), edit policy, add/remove merchant, rotate signer. "Add existing card" imports a card by address. |
| `/cards/new` | New card wizard: Policy → Agent & merchants → Confirm, with a live preview card. Creates the card through the factory, then adds each merchant. |
| `/dev/gallery` | Visual gallery of the design-system primitives and every card state. 404s in a production build unless `NEXT_PUBLIC_WALLET=mock`. |

Card discovery has no indexer behind it: the factory derives a card address from
`sha256(owner_xdr ‖ salt)`, so the app probes `salt = 0, 1, 2, …`, derives each address the way
the factory does, and checks existence with `getLedgerEntries`. Cards created **before** the app
existed used a random salt — the live v2 card `CBOOOQDW4YA7JHDW4ELMKRFUUBJFBOJZGB4IXZJTHSAGUE4TWKJXUH5W`
among them — so those are not auto-discovered. Import them once with **Add existing card**; the
app verifies on-chain that the address is a Mooring card owned by the connected account.

## Architecture

```
apps/web/
  app/            App Router routes (/, /cards, /cards/new, /dev/gallery), fonts, providers
  components/
    ui/           Button, Field, Modal, Sheet, Toggle, Pill, Stat, Toast, TxStatus
    card/         MooringCard (3 sizes x 4 states), CardCarousel, CardList
    cards/        details sections: policy, merchants, agent, danger zone, fund, modals
    wizard/       wizard steps and the live preview card
    layout/       HeaderBar, WalletBadge, NetworkGuard, GrainOverlay
  lib/
    wallet/       WalletAdapter interface + Freighter and mock implementations, React context
    chain/        RPC client, card/factory/SAC calls, salt derivation, discovery, error table
    query/        React Query client, keys, read hooks, the write action state machine
    format/       USDC, durations, addresses
  e2e/ test/      Playwright specs and vitest unit/component tests
packages/contracts-ts/   generated TypeScript bindings for the card and factory contracts
```

**Wallet adapter.** `lib/wallet/types.ts` defines the whole surface the app needs:
`connect()`, `disconnect()`, `address`, `network`, `signTransaction(xdr, …)`, plus a `ready`
state so nothing is clickable before the adapter has answered. `freighter.ts` implements it over
`@stellar/freighter-api` 6 and throws typed `{ code, message }` errors that keep Freighter's
numeric code. `mock.ts` implements the same interface for tests and is selected only by
`NEXT_PUBLIC_WALLET=mock`. A Stellar Wallets Kit adapter would implement this interface and
nothing else in the app would change.

**Chain layer.** `lib/chain` owns the RPC client, the read calls (`info()`, `merchants()`, the
USDC SAC balance), the transaction builders for every owner operation, the factory salt
derivation (verified against a Rust test vector in `contracts/factory`), and `errors.ts`, which
translates Freighter rejections, RPC failures and card contract errors 1–13 into a title, a
detail and a next step.

**Query hooks.** React Query. Card summaries refetch every 30 s; the selected card's details
every 10 s while the tab is visible. Every write invalidates the affected queries after
confirmation — never optimistically.

**Action state machine.** One hook, `useContractAction`, drives every write:
`idle → preparing → signing → submitted → confirmed | failed`. It simulates once, detects a
failed simulation before asking for a signature (so a policy violation never reaches the
wallet), fails fast on `TRY_AGAIN_LATER`, and cancels cleanly if the component unmounts. The
shared `TxStatus` component renders those states, the transaction hash, and the translated
error. Only one action per card can be in flight; the rest are disabled while it runs.

**Generated bindings.** `packages/contracts-ts` holds `stellar contract bindings typescript`
output for the card and factory, pinned to the workspace's exact `@stellar/stellar-sdk` 17.0.1.
CI regenerates them from the freshly built WASM and fails if the committed files drifted.

## Configuration

Copy `apps/web/.env.example` to `apps/web/.env.local`. Every value is read once in
`lib/config.ts`, which refuses to render the app if one is missing.

| Variable | Testnet value |
|---|---|
| `NEXT_PUBLIC_STELLAR_NETWORK` | `stellar:testnet` |
| `NEXT_PUBLIC_RPC_URL` | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` |
| `NEXT_PUBLIC_FACTORY_ADDRESS` | `CBMSK4OSNLBEXTJWNEWX422RPVDEUNFEWADTSPECGBI26ESDYW65AUSE` (deployment v2) |
| `NEXT_PUBLIC_USDC_SAC` | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| `NEXT_PUBLIC_DOCS_URL` | link shown in the header; defaults to `docs/x402-integration.md` on GitHub |
| `NEXT_PUBLIC_WALLET` | `freighter` (default). **`mock` is for tests only** — it replaces the wallet with an in-memory stub and unlocks `/dev/gallery`. Never set it on a deployment. |

These are `NEXT_PUBLIC_*` variables, inlined at build time. `lib/config.ts` spells each
`process.env.NEXT_PUBLIC_…` read out in full on purpose: a dynamic lookup is not inlined by
Next.js and the production bundle would throw on load while `next dev` kept working.

## Run locally

```sh
npm ci
npm run build -w @mooring/contracts-ts -w @mooring/x402-client   # workspace deps the app imports
cp apps/web/.env.example apps/web/.env.local
npm run dev -w @mooring/web                                      # http://localhost:3000
```

Connect Freighter, switch it to testnet, and the app is live against the deployment in
`docs/testnet.md`.

## Tests

```sh
npm run typecheck -w @mooring/web    # tsc --noEmit
npm test -w @mooring/web             # 244 unit + component tests (vitest, jsdom)
npm run build:web -w @mooring/web    # next build (needs the env vars; CI sources .env.example)
npm run e2e -w @mooring/web          # 19 Playwright flows (chromium)
```

Nothing above touches testnet. Playwright builds and serves the app itself with
`NEXT_PUBLIC_WALLET=mock` and intercepts every Soroban RPC call, so the flows — connect, empty
state, carousel and list, the wizard through to confirm, error notices, and an axe accessibility
pass — run offline. The `web` job in `.github/workflows/ci.yml` runs all four steps on every
pull request and uploads the Playwright report when it fails.

## Deploy (Vercel)

The app is a normal Next.js 15 project inside an npm-workspaces monorepo, so the build has to
run from the repo root (it builds `@mooring/contracts-ts` and `@mooring/x402-client` first).
`apps/web/vercel.json` carries exactly that install and build command; the rest is project
settings.

**Status: deployed.** Production is live at https://mooring-web.vercel.app (Vercel project `mooring-web`,
root directory `apps/web`, deployed 2026-09-14 with `vercel deploy --prod`). The steps below
reproduce the setup; the project's `NEXT_PUBLIC_*` values match `apps/web/.env.example`
(`NEXT_PUBLIC_WALLET` is deliberately unset in production, so the mock adapter is excluded from
the bundle and `/dev/gallery` returns 404).

```sh
npx vercel login                       # owner's account; opens a browser
npx vercel link                        # from the repo root; project name e.g. mooring-web
                                       # set Root Directory = apps/web when asked
                                       # (or later: Project Settings -> Build & Deployment)

# the six NEXT_PUBLIC_* values from apps/web/.env.example, for production and preview:
for v in NEXT_PUBLIC_STELLAR_NETWORK NEXT_PUBLIC_RPC_URL NEXT_PUBLIC_NETWORK_PASSPHRASE \
         NEXT_PUBLIC_FACTORY_ADDRESS NEXT_PUBLIC_USDC_SAC NEXT_PUBLIC_DOCS_URL; do
  npx vercel env add "$v" production
  npx vercel env add "$v" preview
done
# do NOT set NEXT_PUBLIC_WALLET — it must stay unset so the app uses Freighter.

npx vercel deploy --prod
```

Project settings that matter:

- **Root Directory** `apps/web`, with "Include files outside of the Root Directory" enabled —
  the build needs the workspace root's `package-lock.json` and `packages/*`.
- **Framework preset** Next.js; install and build commands come from `apps/web/vercel.json`.
- **Production branch** `main`; every pull request gets a preview deployment.
- `app.mooring.dev` can be attached once DNS is ready; until then the Vercel URL is canonical.

`.vercel/` (the local link and project id the CLI writes) is git-ignored and must never be
committed.

**Deployed URL:** https://mooring-web.vercel.app — verified after deploy: `/`, `/cards` and `/cards/new` return 200, the factory address is inlined in the client chunks, and `__mooringMock` is absent.

The same build runs locally and in CI, so a failure here would be a Vercel configuration
problem, not an application one:

```sh
set -a && source apps/web/.env.example && set +a
npm run build:web -w @mooring/web
```

## Manual testnet checklist

Playwright covers the flows against a mocked wallet and mocked RPC. This checklist covers what
it cannot: the real Freighter extension signing real transactions against the testnet
deployment. **It has not been run yet** — every hash and screenshot cell below says `pending`,
and the repository owner fills them in from their own machine. Nothing in this table is
simulated or estimated.

### How to run it

1. The owner account is `mooring-owner`
   (`GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD`), the owner of the v2 card in
   `docs/testnet.md`. Print its secret **on the owner's own machine** with
   `stellar keys show mooring-owner` and import it into Freighter with "Import secret key".
   Never paste that secret into this repository, a chat, an issue, or any web page other than
   the Freighter extension itself.
2. Switch Freighter to **Testnet**.
3. The owner already holds the USDC trustline added during the v2 migration
   (`4c2ba4228933140e5ddd70cbc11c404649398c842240d0d7eaaec2820332f002`), which `withdraw` and
   `cancel` need. If a different account is used, add the trustline first.
4. **The owner wallet must hold at least 1.5 USDC before the checklist's "Fund 1 USDC" step**
   — the Fund sheet transfers from the owner's wallet to the card, and correctly refuses with
   "Your wallet holds 0 USDC" otherwise. On 2026-09-13 the owner was topped up with 3 USDC from
   the merchant test account (`mooring-merchant`, which holds the D2 payments).
   Note: `mooring-funder` is drained, so `scripts/testnet/fund.sh` needs a Circle testnet faucet
   top-up before it is used again.
5. Run the app against the testnet config (locally with `npm run dev -w @mooring/web`, or the
   deployed URL once it exists).
6. Take a screenshot at each step into `docs/screenshots/` using the filenames in the last
   column, and copy each transaction hash from the app's transaction status panel (or from
   Stellar Expert).

### Checklist

| Step | Expected | Tx hash | Screenshot |
|---|---|---|---|
| Connect Freighter on `/` | Wallet badge shows `GCJJ…KKBD · testnet`; redirect to `/cards` | — | `pending` (`01-connect.png`) |
| Wizard step 1 — label `inference-agent-2`, budget 10 USDC / day, cap 5 USDC, expiry 30 days | Live preview card updates; label accepted (≤ 32 bytes) | — | `pending` (`02-wizard-policy.png`) |
| Wizard step 2 — paste the agent public key, add one merchant | Green tick on the key; merchant listed, max 32, deduplicated | — | `pending` (`03-wizard-agent.png`) |
| Wizard step 3 — "Create with Freighter" | `create_card` confirms; app returns to `/cards` with the new card selected — card `CCFZQBAFDJEC635N5DWJYX53GNIOOZPGO3AQXMZ7KRATMA2XVVLKIEYV` | [`ceaceb7b…c2039c`](https://stellar.expert/explorer/testnet/tx/ceaceb7bd83cebb42fa3178da035e084506d956d166ab24f0da446941fc2039c) | `pending` (`04-card-created.png`) |
| Merchant added after creation | One `add_merchant` transaction per merchant (see follow-ups) | [`f63c15d7…bffa8a`](https://stellar.expert/explorer/testnet/tx/f63c15d790289747251ba5b0d6c9a08ce97e7bed9e612facd9d0b9e20abffa8a) | `pending` (`05-merchant-added.png`) |
| Fund 1 USDC from the wallet (owner must hold ≥ 1.5 USDC — see prerequisite 4) | SAC `transfer` owner → card; card balance shows `1.00` | [`a920f9ea…adbe3c`](https://stellar.expert/explorer/testnet/tx/a920f9ea4620449709a3763f14a6e393619279d609991fc7f771b9eebbadbe3c) | `pending` (`06-funded.png`) |
| Edit policy (budget 20 USDC / day, cap 5 USDC) | `set_policy` confirms; current-period spend kept, period restarts now | [`a07e78ab…7e048a`](https://stellar.expert/explorer/testnet/tx/a07e78ab07434eaa072dab9476fd9a6628828957a8721b81207fe506067e048a) | `pending` (`07-policy-edited.png`) |
| Add a second merchant | `add_merchant`; allowlist count +1 | [`f9ee9f3b…01b184`](https://stellar.expert/explorer/testnet/tx/f9ee9f3b6c5a9b4b2fe0c941d031815cfb2c94dba17b6c1ad60856885201b184) | `pending` (`08-merchant-add.png`) |
| Remove that merchant | `remove_merchant`; allowlist count back down | [`05068bd1…fb42c9`](https://stellar.expert/explorer/testnet/tx/05068bd1d1ac68eda7f08961fa53f573a560d87390b398017b89e124bafb42c9) | `pending` (`09-merchant-remove.png`) |
| Rotate the signer to a second agent key (`GC3PG3W2…LNR5`) | `set_signer`; the old key stops working immediately | [`5cb87aed…58950d`](https://stellar.expert/explorer/testnet/tx/5cb87aed0a2dd75796d93ef66015520af7c096443819825329b9c991ef58950d) | `pending` (`10-signer-rotated.png`) |
| Freeze | `freeze`; card face turns frozen (❄, seaglass), payments rejected | [`d871f707…b74bf0`](https://stellar.expert/explorer/testnet/tx/d871f707fbcfda2a37fa70060cdddb1b388686bcbf94f3f9e579389245b74bf0) | `pending` (`11-frozen.png`) |
| Unfreeze | `unfreeze`; card active again | [`71cb4215…d4b1eb`](https://stellar.expert/explorer/testnet/tx/71cb421597e23b26a1abc21c3fd4333f0d3abbaea25b5bd53a4ebebed4d4b1eb) | `pending` (`12-unfrozen.png`) |
| `mooring pay` against this card (`/weather`, 0.001 USDC, signed with the rotated key) | HTTP 200; on-chain `spent` 0.001 USDC, balance 9.999 → 0.999 after the earlier withdraw ordering — see note | [`903567d2…1a0e9e`](https://stellar.expert/explorer/testnet/tx/903567d20e1e68491b75629b9969a87f82d719e9ba015da7355731c3d71a0e9e) | `pending` (`13-budget-moved.png`) |
| Withdraw 0.5 USDC | `withdraw`; balance drops by 0.50, owner's USDC balance rises | [`a4c244fc…4bdc15`](https://stellar.expert/explorer/testnet/tx/a4c244fc3053fb5f3f413632fb3cd28a857bb950d33162565d90d42cef4bdc15) | `pending` (`14-withdrawn.png`) |
| Cancel (typed confirmation) | `cancel`; state Cancelled (state = 2), balance 0 — remaining balance swept to the owner | [`2bd31d0b…245d81`](https://stellar.expert/explorer/testnet/tx/2bd31d0b8d0462a48c7c8ffb84e423cfabe653104086f25f5313e9164e245d81) | `pending` (`15-cancelled.png`) |
| `mooring pay` above the per-tx cap (`/premium`, 20 USDC) | Denied locally at precheck (`over_per_tx_cap`); nothing signed or submitted | — | `pending` (`16-denied-after-cancel.png`) |

**Run of 2026-09-25** (owner with Freighter on a local `next dev`, testnet): all eleven owner
transactions above succeeded in the order listed (Horizon history of `GCJJ…KKBD`, 17:33–17:43 UTC),
the payment settled through OZ Channels, and the over-cap payment was refused before signing. The
card's final on-chain state is `Cancelled` with a zero balance. Note on the pay row: the payment ran
before the withdraw, so the balance went 1.00 → 0.999 → 0.499 → 0 (cancel sweep). The screenshot
column is still `pending`: the owner drops the files into `docs/screenshots/` with the names shown.

`cancel` is deliberately the last on-chain step: it is permanent and sweeps the balance, so the
`mooring pay` run sits before it. The payment step uses the agent secret that matches the
rotated signer:

```sh
npm run build
alias mooring="node $PWD/packages/cli/dist/index.js"
mooring status --card <the new card address> --json
AGENT_SECRET=S… mooring pay http://localhost:3001/weather --card <the new card address>
```

`examples/merchant-server` is the x402 endpoint; its `payTo` address must be one of the card's
merchants. See `docs/x402-integration.md` for the full payment walkthrough.

## Known limitations and follow-ups

- **Merchants are added one transaction at a time.** The card constructor and the factory's
  `create_card` take no initial allowlist, so the wizard creates the card and then sends one
  `add_merchant` transaction — one Freighter prompt — per merchant. A v3 card constructor taking
  `Vec<Address>` (card code is immutable, so it needs a new factory) would make creation a single
  transaction. Scheduled before mainnet, with the audit.
- **Freighter only.** The wallet interface in `lib/wallet` is what a Stellar Wallets Kit adapter
  would implement; multi-wallet support is post-v1.
- **No activity history.** Payments and owner actions per card need an indexer — RPC keeps
  events for about 7 days, and policy rejections happen at simulation and leave no on-chain
  trace. Planned for v1.1.
- **Cards created before the app** used a random salt and are not auto-discovered; import them
  with "Add existing card".
- Open polish items tracked for the fix wave after this PR: the transaction XDR details
  disclosure before signing (spec §7), `/cards` first-load bundle size (~304 kB, mostly the
  x402 client barrel import), and a dedicated `danger-text` contrast token so the axe
  colour-contrast rule can be re-enabled.
- The client still records **legacy (v1) auth credentials** for x402 payments because the
  deployed OpenZeppelin Channels facilitator requires them; that workaround goes away when the
  facilitator accepts CAP-71 `ADDRESS_V2` credentials (`docs/x402-integration.md`).
- **Testnet only, not audited.** Mainnet follows a security audit.
