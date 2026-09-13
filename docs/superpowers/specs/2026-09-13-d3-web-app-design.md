# Mooring Web App (D3) — Design Spec

**Date:** 2026-09-13
**Status:** Approved by owner (brainstorming session, visual companion mockups in `.superpowers/brainstorm/58384-1789262953/content/`)
**Scope:** The owner-facing web application for Mooring cards: connect a wallet, create and fund cards, watch budgets live, and control every owner operation. Production product, not a demo.

## 1. Context

Mooring gives AI agents a spending card on Stellar: a Soroban custom account that holds USDC and enforces a policy (periodic budget, per-tx cap, merchant allowlist, expiry, freeze/cancel) in `__check_auth`. D1 delivered the contracts (`contracts/card`, `contracts/factory`), D2 the x402 client (`@mooring/x402-client`), CLI and example server. D3 is the surface the **card owner** uses. The agent never touches this app; it pays through the client library with its own key.

Two keys, two roles:
- **Owner** — a Stellar account in the user's Freighter wallet. Creates cards, funds them, edits policy, freezes, cancels, withdraws. Signs every write in the app.
- **Agent** — the AI agent's own ed25519 keypair. The card stores the **public** key; the secret lives where the agent runs. The app never generates, stores or sees agent secrets: the owner pastes the agent's public key.

## 2. Decisions (from the brainstorm)

| Question | Decision |
|---|---|
| Where does the app live? | Monorepo `apps/web` (Next.js 15, App Router, Tailwind 4), deployed to Vercel separately from the landing page (separate repo). |
| Wallet | Freighter only for v1 (`@stellar/freighter-api`). Stellar Wallets Kit can replace it later behind the same `lib/wallet` interface. |
| Agent key | Owner provides the agent's public key (G…). The app does not generate keypairs. Hint for users without one: `mooring keygen`. |
| Visual direction | Dark only, direct continuation of the landing page's night-harbor design system. |
| Main layout | **F2**: one "My cards" screen with a centered 3D card carousel (selected card front and center, neighbours receding in perspective) and the selected card's details below; a **list view** toggle for many cards. The "+ new card" slot is the last carousel item. |
| New card | 3-step wizard (Policy → Agent & merchants → Confirm) with a live preview card that updates as the form changes. |
| Writes | One shared transaction-status component for every write: Prepared → Signature → Submitted → Confirmed. |
| Funding | Sheet with two tabs: "From my wallet" (amount, quick picks, Freighter signs a USDC transfer to the card) and "Show address" (QR + copyable C… address). |
| Card name | **On-chain label.** The card contract gains a bounded `label` (≤ 32 chars) set at creation (constructor argument) and changeable by the owner via `set_label` (an owner transaction with a sub-cent network fee, stated in the UI). `info()` returns it; the CLI shows it. Requires a card contract update and a new factory deployment (the D1 model: immutable code, versioned factory). |

## 3. Screens and flows (v1 scope)

### 3.1 Connect (`/`)
- Detect Freighter. Not installed → install link and a short explanation of what the wallet is for. Installed but not allowed → "Connect" button triggers `setAllowed`/`requestAccess`.
- Network check: if Freighter's network passphrase is not the configured one (testnet in v1), show a blocking, single-line notice with the expected network. No other UI until it matches.
- On success go straight to `/cards`.

### 3.2 My cards (`/cards`)
- **Header bar**: MOORING wordmark, links "My cards", "Docs", wallet badge (`GCJJ…KKBD · testnet`, click → copy / disconnect).
- **Title row**: "My cards · N cards · total X USDC · spent today Y", and a "Cards / List" toggle.
- **Carousel** (cards view): selected card centered, larger, ringed in amber, raised (`translateZ`); neighbours smaller, rotated in perspective, dimmed; far ones fade. Arrows, dots, keyboard ← →, swipe on touch. Last slot: dashed "+ new card".
- **Card face** (all sizes): wordmark, status (● active / ❄ frozen / ○ expired / cancelled), balance (big serif), today's budget `spent / period_amount` with a seaglass bar, expiry countdown, allowlist count, short address, and the **card label** (on-chain, owner-chosen at creation, renamable via `set_label`).
- **Details** for the selected card: stat row (balance, remaining today, per tx, expires) + primary actions (Fund, Freeze/Unfreeze, Withdraw); two columns: Policy (period budget, per-tx cap, expiry, "period resets in 14 h 20 m", Edit) and Merchants (list, add, remove) + Agent (signer public key, Rotate signer); Danger zone: Cancel card (sweeps balance to the owner).
- **List view**: table with mini card thumbnail, name, short address, status pill, balance, today's bar, per tx, expiry, "Open ›". Search box (name/address), status filter, "+ New card". Rows open the same details (list view keeps the details panel below the table for the selected row).
- **Empty state**: one large, dimmed card illustration and "Create your first card".

### 3.3 New card (`/cards/new`)
- Step 1 **Policy**: card label (≤ 32 chars, on-chain), period budget with unit picker (hour / day / week / custom seconds), per-tx cap (must be ≤ budget), expiry (presets 7 / 30 / 90 days or a date). Live preview card on the left.
- Step 2 **Agent & merchants**: agent public key (validated as a G… ed25519 strkey; green tick), optional initial merchants (G… or C… addresses, max 32, deduplicated). Hint: `mooring keygen`.
- Step 3 **Confirm**: summary, plain-language note ("The card is a Soroban account tied to your wallet; funds stay under your control"), "Create with Freighter".
- After confirmation the app navigates to `/cards` with the new card selected and opens the Fund sheet.

### 3.4 Owner operations (on the details panel)
- `set_label` (Rename; explains that renaming is an on-chain transaction with a small network fee).
- `set_policy` (Edit policy modal, same validation as the wizard; explains that current-period spend is kept and the period restarts now).
- `add_merchant` / `remove_merchant`.
- `set_signer` (rotate agent key; second confirmation explaining the old key stops working immediately).
- `freeze` / `unfreeze`.
- `withdraw` (amount ≤ balance, "all" shortcut; requires the owner to hold a USDC trustline — the app checks and explains if missing).
- `cancel` (typed confirmation "cancel"; explains: permanent, sweeps the full balance to the owner, requires the trustline).
- Fund: "From my wallet" builds a USDC SAC `transfer(owner → card, amount)` for Freighter; "Show address" shows QR + address.

### 3.5 Out of scope (v1)
Activity history (needs an indexer), merchant side, light theme, multi-wallet kit, mainnet.

## 3.6 Contract change: on-chain label (prerequisite task)
- `contracts/card`: add `label: String` (≤ 32 bytes, validated, `InvalidLabel` error) to the constructor and to `CardInfo`; add owner entrypoint `set_label(label)` with event `LabelChanged { label }`; `__check_auth` untouched (no events, no extra reads beyond the instance entry it already loads).
- `contracts/factory`: `create_card` takes `label` and passes it to the constructor; a **new factory** is deployed (new card WASM hash); `deployed.testnet.json`, `docs/testnet.md`, the CLI (`status` shows the label) and `@mooring/x402-client` (`CardInfo.label`, `readCardInfo`) are updated. Existing testnet cards from the old factory are not migrated (testnet only).
- Fee check: re-run the 1-merchant and 32-merchant simulations after the change and record them; the label must keep the 32-merchant case under the observed OZ ceiling (≥ 51 175 stroops).

## 4. Architecture

```
apps/web/
  app/                         Next.js App Router
    layout.tsx                 fonts (Instrument Serif, Manrope, IBM Plex Mono), grain overlay, providers
    page.tsx                   Connect
    cards/page.tsx             My cards (carousel/list + details)
    cards/new/page.tsx         Wizard
    globals.css                @theme tokens copied from the landing page
  components/
    ui/                        Button, Sheet, Modal, Toggle, Field, Stat, Pill, TxStatus, Toast
    card/                      MooringCard (3 sizes × 4 states), CardCarousel, CardList, CardFace
    cards/                     Details panel sections: PolicySection, MerchantsSection, AgentSection, DangerZone, FundSheet
    wizard/                    Steps, PreviewCard
    layout/                    HeaderBar, WalletBadge, NetworkGuard
  lib/
    chain/                     rpc client, generated bindings wrappers (card, factory, USDC SAC),
                               discoverCards(owner), buildTransfer(), error translation
    wallet/                    Freighter: connect, network, sign; context + hook
    format/                    usdc(), duration(), countdown(), shortAddress()
    prefs/                     selected card + view mode in localStorage
    query/                     React Query client + hooks (useCard, useCards, useMerchants)
  test/                        vitest (lib/*), Playwright (flows with a mocked Freighter)
packages/contracts-ts/         generated TS bindings for card + factory (`stellar contract bindings typescript`),
                               regenerated from the built wasm in CI
```

### 4.1 Reads
- `readCardInfo` / `readMerchants` from `@mooring/x402-client` (already browser-safe) or the generated bindings; both are RPC simulations from a null account (no signing, no fees).
- React Query: per-card `info` + `merchants` queries, `refetchInterval` 10 s while the tab is visible, invalidated immediately after every write.
- **Card discovery without an indexer**: the factory derives a card's address from `sha256(owner ‖ salt)`. The app probes `salt = 0, 1, 2, …` (32-byte big-endian encoding of the counter), derives the address the same way the factory does, and checks existence with `getLedgerEntries` (contract instance key); it stops at the first gap. New cards use the first free salt. Probing is batched (8 at a time) and cached.

### 4.2 Writes
- Generated binding → `AssembledTransaction` → simulation → Freighter `signTransaction(xdr, { networkPassphrase })` → `rpc.sendTransaction` → poll `getTransaction` → invalidate queries.
- One hook `useContractAction(name, build)` returns `{ run, state }` with `state ∈ idle | preparing | signing | submitted | confirmed | failed`, the hash when known, and a translated error.
- Error translation: Freighter rejection ("You declined the signature"), wrong network, RPC/simulation failures, and card contract errors mapped through the same code table as `@mooring/x402-client` (`CARD_ERROR_CODES`: 3 Frozen … 12 InvalidState) to user sentences with the code in parentheses and a next step.

### 4.3 Wallet
- `lib/wallet` exposes `connect()`, `disconnect()`, `address`, `network`, `signTransaction(xdr)`. Freighter is the only implementation in v1; the interface is what a Wallets Kit adapter would implement later.
- Network guard wraps every route except `/`.

### 4.4 Configuration
- `NEXT_PUBLIC_STELLAR_NETWORK` (`stellar:testnet` in v1), `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_FACTORY_ADDRESS`, `NEXT_PUBLIC_USDC_SAC`, `NEXT_PUBLIC_DOCS_URL`. Read once in `lib/chain/config.ts`; the app refuses to render without them.

## 5. Design system

- **Tokens** (from the landing page, copied into `globals.css`): `bg-deep #050B14`, `bg-raised #0A1522`, `surface #0F1E30`, `amber #F2B44A`, `seaglass #7FB8A8`, `danger #E05548`, `text-hi #F2EEE4`, `text-lo #93A3B5`. Fonts: Instrument Serif (display, numbers on cards), Manrope (body), IBM Plex Mono (labels, addresses, chain facts). Film grain overlay ~3%, horizon-glow dividers, glass surfaces with 6–8% light borders.
- **MooringCard**: one component, sizes `carousel` (~420×250), `preview` (~380×226), `thumb` (44×28); states `active` (amber glow), `frozen` (desaturated, seaglass glow, ❄), `expired`/`cancelled` (dimmed, no glow). 3D treatment: layered shadows (2 / 12 / 40 px), inset top highlight, diagonal sheen, gold chip, amber ring when selected; pointer tilt up to 4°; all motion disabled under `prefers-reduced-motion`. No card-network logos, no 16-digit numbers.
- **Carousel**: CSS 3D transforms only (`perspective`, `rotateY`, `translateZ`), spring-like 200 ms transitions, keyboard and swipe, `aria-roledescription="carousel"`; the list view is the accessible fallback and is announced as the primary list to screen readers.
- **Numbers and text**: USDC shown with two decimals, full 7-decimal value in a tooltip; durations as "29 days", countdowns as "14 h 20 m"; addresses truncated `CAJP…AHCJ` with click-to-copy. Copy is English; a single constants module so a TR locale can be added later.
- **Status language**: active / frozen / expired / cancelled; never "demo".

## 6. Error handling and edge cases

- Freighter missing / declined / wrong network: dedicated screens or inline notices with the exact next action.
- RPC unreachable: the details panel shows the last known values greyed with "couldn't refresh · retry"; writes are disabled until a read succeeds.
- Contract errors: translated per §4.2; policy validation is mirrored client-side so `InvalidPolicy` is caught before signing.
- Owner without a USDC trustline: `withdraw`/`cancel` explain and link to how to add one (Freighter "Add asset").
- Card TTL expired/archived: `getLedgerEntries` reports no live entry → card shown as "archived" with a Bump/restore action (out of v1 code path but the state is rendered, not crashed).
- Concurrency: a write in flight disables other writes on the same card; queries refetch after confirmation, not optimistically.

## 7. Security and privacy

- No secrets in the browser: agent keys are public only; the owner's key never leaves Freighter. No server-side component holds keys.
- No analytics or third-party scripts in v1; fonts self-hosted through `next/font`.
- Only UI preferences (selected card, view mode) live in `localStorage`; card labels are on-chain.
- All transaction XDR shown in a "details" disclosure before signing (what contract, what function, what amount).

## 8. Testing and verification

- **Unit (vitest)**: `lib/format`, `lib/prefs`, salt/address derivation (must match the factory's test vectors from `contracts/factory/src/test.rs`), error translation, policy validation, `discoverCards` with a mocked RPC.
- **Component**: MooringCard states, TxStatus transitions, wizard validation (React Testing Library).
- **E2E (Playwright)**: connect with a mocked Freighter (window.freighterApi stub), empty state, wizard to the confirm step, list/carousel toggle, error notices. Runs in CI.
- **Manual testnet checklist** (documented in `docs/testnet.md`, with screenshots as evidence): create a card through the app, fund it from Freighter, edit policy, add/remove merchant, freeze/unfreeze, withdraw, cancel; then pay it with `mooring pay` to show the budget move live.
- **Quality bar**: `next build` and lint clean, Lighthouse 90+ on `/cards`, works at 400 px, reduced-motion verified.

## 9. Deployment

- Vercel project `mooring-web`, production branch `main`, preview per PR; env vars per §4.4; `app.mooring.dev` when DNS is ready (until then the Vercel URL).
- CI: build, typecheck, unit + component tests, Playwright, bindings freshness check.

## 10. Open items (not blocking)

- Wallets Kit adapter (post-v1).
- Activity history and the indexer (v1.1).
