# Week 3 — MPP charge, guard parity, `create-mooring-agent` (design)

Instaward #2, second month, deliverables **D3(a)**, **D3(b)** and **D1(b)** of the SOW
(`instawards/2026-11-instaward-2nd-month-sow.md`, §5 and §6.1). Written 2026-11-26 after the owner
answered the four design questions in chat (all four: option A).

## Intent

A Mooring card can pay only x402 sellers today. Stellar has two official agent-payment protocols,
and MPP "charge" mode is a plain SEP-41 `transfer` — exactly the one call the card's `__check_auth`
already authorizes — so the same card should pay MPP charge sellers through the same `pay()` call.
At the same time, developers comparing payment clients expect agent-side guard rails on top of the
on-chain policy (a local cap below the on-chain one, an emergency stop, reservations for concurrent
payments, a signed receipt ledger), and newcomers need a way to go from zero to a settled payment
without reading the integration guide first.

Success for the week (SOW §5 week 3): a card pays an MPP charge seller on testnet (tx hash); CLI
output shows the local cap and `stop()` refusing a payment **before anything is signed**; the signed
receipt ledger exports; `npx create-mooring-agent` runs end to end against a hosted seller on
`api.mooring.live`.

## Finding that shapes the design: the official MPP server verifies G-address payers only

Read from `stellar/stellar-mpp-sdk` 0.7.1 (`sdk/src/charge/server/Charge.ts`, `shared/verify-auth.ts`)
and `wevm/mppx` 0.22.1 on 2026-11-26:

- The credential's `source` is a DID `did:pkh:stellar:<network>:<address>`; the server derives the
  expected `from` of the transfer with `Keypair.fromPublicKey(address)`, which only accepts `G…`.
- In the sponsored (fee-payer) path the server verifies every auth entry's ed25519 signature
  off-chain and **rejects contract authorizers** ("contract authorizers cannot be verified
  off-chain"), even though it also runs an enforce-mode simulation that would validate a custom
  account's `__check_auth`.
- Push mode (`signedHash`) binds the tx hash with a signature by the payer's key; a card has no key.

On-chain nothing stands in the way (the transfer is `transfer(card, recipient, amount)` with the
card's auth entry signed by the agent key, exactly as x402). The limitation is server-side SDK
verification. Consequences:

1. The **client** side (card paying an MPP charge challenge) is built in `@mooring-live/x402-client`
   with no dependency on `@stellar/mpp`'s client (which hard-codes `from = keypair.publicKey()`).
2. The **hosted seller** on `api.mooring.live` runs a card-aware MPP charge verifier (below), so
   the week's evidence is a card paying a real MPP charge seller with the standard wire format.
3. An **upstream pull request** to `stellar-mpp-sdk` makes the stock server accept contract payers
   in pull mode (accept `C…` in the DID; for contract authorizers skip the off-chain ed25519
   check and rely on the enforce-mode simulation the server already runs). The PR is part of the
   week's work but its merge is not; until it lands, only sellers running our verifier (or the
   patched SDK) accept card payments, and the docs say so plainly.

No MPP charge seller exists on testnet in the directory today (0 of 19 rows), so the hosted seller
is also the only MPP target the kit and the evidence can use.

## Goals

- One `pay(url)` in `@mooring-live/x402-client` that reads the seller's 402 and pays through x402
  (existing path) or MPP charge (new path), from the same card, with the same denial semantics.
- `mooring pay` in the CLI uses it and reports which protocol settled.
- Guard parity in the client and CLI: local daily/total caps and per-payment cap below the on-chain
  policy, `stop()` / `mooring stop`, reservations so concurrent payments cannot overshoot a cap, a
  receipt per payment attempt signed by the agent key, with CSV/JSON export.
- `npx create-mooring-agent <dir>` scaffolds a TypeScript agent that pays the hosted seller and
  prints the settlement hash; the quickstart in the README is rewritten around it.
- `apps/seller` deployed as `api.mooring.live`: sells one resource through x402 and through MPP
  charge, listed in the merchant directory as a first-party source.

## Non-goals

- MPP channel/session mode, MPP push mode for cards, cross-chain anything.
- A merchant-side product (registration, dashboards). The seller is an example, not a product.
- Waiting for the upstream PR to merge.
- Changing the card contract.

## Anti-goals (what would make this a failure even if it works)

- A guard that refuses *after* the agent key has signed, or a cap that a second concurrent payment
  can slip past.
- A receipt that cannot be verified without Mooring's servers (receipts are self-contained and
  verifiable with the agent's public key alone).
- A kit that only works if the developer also runs a server, or that stores an owner key.
- Describing any of this as a demo.

## Constraints

- Repo language English; branch → PR → CI green → merge; packages published by the owner (OTP);
  owner performs Vercel project creation, DNS and env changes.
- Testnet only (`stellar:testnet`); pubnet wiring is week 4 (D3(c)).
- `@stellar/stellar-sdk` stays pinned at 17.4.0 and `useUpgradedAuth: false` (legacy V1 auth
  credentials) for the x402 path; the MPP path uses the same signer and the same credential arm.
- `@stellar/mpp` 0.7.1 declares `peerDependencies: @stellar/stellar-sdk ^15.1.0`, which excludes
  17.x. The client therefore depends on `mppx` only (for `Method`, `Challenge`, `Credential`) and
  carries its own copy of the small `stellar`/`charge` Zod schema; the seller may use `@stellar/mpp`
  server types with a peer override if the builder finds that cleaner, but must not rely on its
  verifier.
- Vercel Hobby plan (one project per app; 300 s function limit is irrelevant here).

## Design

### 1. `@mooring-live/x402-client` → 0.4.0

New modules (names are the contract between tasks):

- `src/mpp/schema.ts` — `chargeMethod = Method.from({ name: "stellar", intent: "charge", schema })`,
  a verbatim copy of the upstream `Methods.ts` schema (credential payload union
  `signedHash | hash | transaction`, request `{ amount, currency, recipient, description?, externalId?, methodDetails? }`).
- `src/mpp/charge.ts` — `cardChargeMethod(opts: CardSchemeOptions)` built with
  `Method.toClient(chargeMethod, { createCredential })`:
  - Runs the same local `precheck()` as the x402 path (recipient, amount, asset = `currency`).
    `currency` must equal the network's USDC SAC; anything else is `PaymentError("unsupported_asset")`.
  - Builds `transfer(card, recipient, amount)` on `currency`.
  - If `methodDetails.feePayer === true` (sponsored): placeholder all-zeros source, simulate with
    `useUpgradedAuth: false`, assert the auth tree is exactly that transfer (same check as
    upstream), sign the card's auth entries with `signCardAuthEntries` and an expiration ledger
    derived from `challenge.expires` (same conservative rule as `authExpirationLedgers`), return
    `{ type: "transaction", transaction: <envelope XDR> }`.
  - Otherwise (unsponsored, the SOW's "the agent's account sponsors the fee"): the agent's `G…`
    account is the transaction source, same assertion, card auth entries signed by the agent, the
    envelope signed by the agent, same credential payload. The agent account needs XLM; the CLI and
    kit say so on `op_insufficient_balance`-shaped failures and point to friendbot on testnet.
  - `source` is `did:pkh:stellar:<network>:<card>`.
  - Push mode is refused with a clear `PaymentError("mpp_push_unsupported")`.
  - Enforce-mode simulation failures are classified with the existing `classifyContractError` →
    `CardPolicyDenied` (stage `"simulation"`), exactly like x402.
- `src/pay.ts` — `pay(url, init?, opts: PayOptions): Promise<PayResult>` and
  `createMooringFetch` extended to the same detection:
  - Send the request once. On `402`: if the response carries `WWW-Authenticate: Payment …`
    (mppx `Challenge.fromResponse`) → MPP charge via `mppx` client `Mppx.create({ methods: [cardChargeMethod] }).fetch`;
    else if it is an x402 402 (JSON `accepts[]` / `PAYMENT-REQUIRED` header) → existing x402 flow.
    Anything else → `PaymentError("not_payable")`.
  - `PayResult = { response, protocol: "x402" | "mpp", settlement: { txHash, amount, payTo, asset, network }, receipt }`.
  - The guard (next section) wraps both paths at one point: before any signing, after the terms
    are known.
- `src/guard/` — guard parity:
  - **Package layout (writer's call):** the main entry stays free of `node:fs` (the signer is
    written to run in a browser and must keep doing so). The main entry ships the `Guard`
    interface, `MemoryGuard`, `GuardDenied`, receipt signing/verification and an `onReceipt`
    callback; the file-backed guard (`fileGuard()`), the stop file and `exportReceipts` live in the
    subpath export `@mooring-live/x402-client/node`. With no `guard` option the client uses a
    `MemoryGuard` with no caps and performs **no file I/O** — existing behaviour is unchanged. The
    CLI and the kit wire `fileGuard()` explicitly, so `mooring stop` is honoured by every CLI and
    kit payment, and by any library consumer who opts in.
  - **Scope (writer's call):** caps and counters are **per card** (`spend.json` is keyed by card
    address: `{ cards: { "C…": { day, daily, total, reservations } } }`), because a local cap is
    "below the card's on-chain cap" and one machine may run one agent per card. The stop switch is
    **global** per `MOORING_HOME` — an emergency halt stops everything — with `mooring stop --card C…`
    as an optional narrower switch stored in the same file.
  - `Guard` interface: `check(terms) → GuardDecision`, `reserve(terms) → Reservation`,
    `commit(reservation, outcome)`, `release(reservation)`, `stop(reason)`, `resume()`, `isStopped()`.
  - `GuardConfig = { dailyCap?, totalCap?, maxPerTx?, stateDir? }` (USDC strings with up to 7
    decimals, converted to base units once). Resolution order: explicit options →
    `mooring.guard.json` in the working directory → env `MOORING_DAILY_CAP`, `MOORING_TOTAL_CAP`,
    `MOORING_MAX_PER_TX`, `MOORING_HOME`. No config → no local caps (on-chain policy only), stop
    still honoured.
  - State dir `MOORING_HOME` (default `~/.mooring`): `stop` (JSON `{ at, reason }`),
    `spend.json` (`{ day: "YYYY-MM-DD", daily: "<base units>", total: "<base units>", reservations: { id: { amount, at } } }`),
    `receipts.jsonl`. Every read-modify-write of `spend.json` happens under an exclusive lock file
    (`spend.lock` created with `wx`, retried with backoff up to 2 s, stale after 30 s); reservations
    live in that file so two processes on the same machine share one cap. "Daily" is the UTC day.
  - Decision order per payment: stopped → `max_per_tx` → `daily_cap` / `total_cap` including
    outstanding reservations → reserve → on-chain precheck → sign → settle → commit (settled adds to
    the counters; denied/failed releases). A refusal is `GuardDenied` (reasons `stopped`,
    `daily_cap`, `total_cap`, `max_per_tx`) — a new class beside `CardPolicyDenied`, never confused
    with it, and raised before the agent key signs.
  - A `MemoryGuard` with the same interface backs tests, browsers and the no-config default.
  - **Concurrent MPP payments (writer's call):** in the unsponsored path the agent's `G…` account
    is the transaction source, so two in-flight MPP payments would race on its sequence number.
    MPP payments are serialized per agent key within a process (a mutex beside the guard; x402
    payments are unaffected, the facilitator is their source). Across processes a `txBAD_SEQ`
    result is classified `PaymentError("sequence_conflict")`, retried once with a fresh sequence
    (the guard reservation is kept across the retry), then recorded as a failed receipt. The docs
    state the one-process-per-agent-key recommendation for MPP.
- `src/receipts.ts` — one receipt per attempt:
  `{ v: 1, id, ts, protocol, card, agent, payTo, amount, asset, network, url, status: "settled" | "denied" | "failed", txHash?, reason?, sig }`,
  `sig` = ed25519 signature by the agent key over the canonical JSON (keys sorted, no `sig`).
  `signReceipt`, `verifyReceipt(receipt, agentPublicKey)`, `appendReceipt(stateDir, r)`,
  `exportReceipts(stateDir, { format: "csv" | "json", since?, card? })`. Receipts are written for
  every outcome, including guard denials.

Existing behaviour is unchanged for callers of `createMooringClient`; `createMooringFetch` gains
MPP and the guard with defaults that change nothing unless configured.

### 2. CLI `@mooring-live/cli` → 0.4.0

- `mooring pay <url>` goes through `pay()`; output gains `Protocol: x402 | mpp` and the receipt id.
  New flags `--daily-cap`, `--total-cap`, `--max-per-tx` (override config), `--no-guard`.
- `mooring stop [--reason …]` / `mooring resume` — write/remove the stop file and print the state.
- `mooring guard` — prints caps, today's spend, outstanding reservations, stop state.
- `mooring receipts export --csv | --json [--since <date>] [--card C…]` and
  `mooring receipts verify <file>` (checks every signature against the `agent` field).
- Exit codes follow the existing convention (2 missing env, 1 refused/failed); a guard refusal
  prints `refused before signing: <reason>` so the evidence line is unambiguous.

### 3. `apps/seller` → `api.mooring.live`

- Hono app on Vercel Functions (`@x402/hono` and `mppx/hono` both exist; one framework for both
  protocols). Own Vercel project `mooring-seller`, root `apps/seller`, custom domain
  `api.mooring.live` (owner creates the project and the DNS record; runbook in `docs/seller.md`).
- Routes:
  - `GET /` — JSON describing the seller: resources, prices, protocols, docs link.
  - `GET /health`.
  - `GET /quote` — x402 (exact, 0.001 USDC, `payTo` = `SELLER_PAY_TO`), returns
    `{ quote, author, paidWith: "x402", ts }`.
  - `GET /quote/mpp` — MPP charge (0.001 USDC, same `payTo`), returns the same shape with
    `paidWith: "mpp"`.
  - `GET /.well-known/x402` discovery document (as the existing example server does) so the
    directory sources can pick it up later.
- `lib/mpp-card-charge.ts` — the card-aware MPP charge server method
  (`Method.toServer(chargeMethod, { request, verify })`):
  - Accepts `source` DIDs with `G…` **or** `C…` addresses.
  - Accepts `payload.type === "transaction"` only (pull); `signedHash`/`hash` → 402 with a reason.
  - Decodes the envelope, requires exactly one `invokeHostFunction` calling
    `currency.transfer(from, recipient, amount)` with `from` = the DID address, no sub-invocations,
    address-credential auth entries only, none naming the seller's key, expiration within the
    challenge lifetime.
  - For a `G…` authorizer verifies the ed25519 signature off-chain (upstream rule); for a `C…`
    authorizer skips the off-chain check and relies on the enforce-mode simulation.
  - Unsponsored only in v1 (the client's envelope is submitted as-is after an enforce-mode
    simulation succeeds); `feePayer` is not advertised. Polls to inclusion, returns an mppx
    `Receipt` with the tx hash. (Sponsored rebuild is left for the upstream PR / a later version.)
  - Replay protection: mppx's challenge store keyed by challenge id (memory store is acceptable
    for a stateless example seller only because each challenge expires in minutes and a replayed
    tx hash cannot settle twice on-chain; the builder documents this).
- Env: `STELLAR_NETWORK`, `SELLER_PAY_TO` (the existing `mooring-merchant` testnet key, which has
  a USDC trustline), `OZ_API_KEY`, `FACILITATOR_URL`, `MPP_SECRET_KEY`, `SOROBAN_RPC_URL`.
- Tests: Hono app in-process with a fake facilitator (x402) and a fake RPC (MPP), plus unit tests
  of the verifier against envelopes produced by the client module (both a `G…` payer and a card).

### 4. Directory: first-party source and MPP awareness (`apps/web`)

- New directory source `mooring` (highest priority) with the two hosted resources, filled from the
  seller's `/` document at refresh time (not hard-coded prices).
- `DirectoryEntry` gains `protocol: "x402" | "mpp"`; Browse services shows an `MPP` pill; the
  merchant resolver (`/api/resolve-merchant`) learns to read an MPP `WWW-Authenticate: Payment`
  challenge (`recipient`, `amount`, `currency`, `methodDetails.network`) so "Add" and the
  confirmation modal work for MPP sellers exactly as for x402 ones.

### 5. `create-mooring-agent` (`packages/create-mooring-agent`, published as `create-mooring-agent`)

- `npx create-mooring-agent <dir> [--service <url>] [--network stellar:testnet]`; no prompts
  (works in CI); refuses a non-empty directory.
- Template (copied, with the name substituted):
  - `package.json` — `@mooring-live/x402-client` ^0.4.0, `dotenv`, `tsx`, scripts `pay`, `status`.
  - `.env.example` — `MOORING_CARD=`, `AGENT_SECRET=`, `MOORING_NETWORK=stellar:testnet`,
    `MOORING_DAILY_CAP=1`, `MOORING_SERVICE=https://api.mooring.live/quote`.
  - `src/agent.ts` — loads env, `pay(MOORING_SERVICE)`, prints protocol, amount, payee, tx hash
    (stellar.expert link), remaining period budget, receipt id; on `GuardDenied` /
    `CardPolicyDenied` prints the reason and the allow link; on an unfunded card prints the card
    address and "fund it in the app".
  - `src/status.ts` — card info table.
  - `README.md` — three steps: (1) open app.mooring.live, create a card, generate the agent key
    (the app shows the public key; the secret goes into `.env`), fund it with testnet USDC; (2)
    `cp .env.example .env` and fill in; (3) `npm run pay`. Then "pay something else": pick a
    service from Browse services, set `MOORING_SERVICE`.
- The package's own test scaffolds into a temp dir, typechecks the result, and runs `agent.ts`
  against an in-process seller with a fake RPC.

### 6. Docs and evidence

- README quickstart rewritten around the kit; `docs/x402-integration.md` gains "MPP charge
  sellers" (wire format, the server-side limitation, the upstream PR link) and "Guard rails";
  `docs/seller.md` runbook; `docs/testnet.md` week-3 evidence: MPP settlement hash, `mooring pay`
  output refused by the local cap and by `stop` before signing, `receipts export` sample, kit run
  transcript; `CLAUDE.md` progress line.
- Upstream: PR to `stellar/stellar-mpp-sdk` (contract payers in pull mode), **against `main`**
  (which already moved to stellar-sdk ^17.4 / mppx ^0.13; the published 0.7.1 is not the base and
  the docs must not claim the change applies to it). The branch, commit and PR text are prepared
  in the owner's fork; see "What the owner does".

## What the owner does (not the builder)

- Vercel: create project `mooring-seller` (root `apps/seller`), add the env above, add the
  `api.mooring.live` CNAME; later `npm publish` of `@mooring-live/x402-client@0.4.0`,
  `@mooring-live/cli@0.4.0`, `create-mooring-agent@0.1.0`; the upstream PR is opened from the
  owner's GitHub account: the fork of `stellar/stellar-mpp-sdk` and the branch are created and
  pushed from this environment with the owner's `gh` login (owner's decision, 2026-11-26); the owner
  presses "Create pull request" with the prepared text.

## Left to the builder

- Hono vs. plain `fetch`-handler on Vercel for `apps/seller` if `mppx/hono` or `@x402/hono` turn
  out not to fit; the route shapes and env names above are the contract.
- Exact CSV columns (must include every receipt field except `sig`, plus `sig` last).
- Lock-file implementation details (no new runtime dependency unless unavoidable).
- Whether `pay()` lives in `createMooringFetch` or beside it, as long as both exports exist.
- Test fixtures: real 402 responses captured from the deployed seller once it exists, before that
  from the in-process app.
