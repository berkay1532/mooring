# Indexer v1

The indexer gives the web app what the chain alone cannot: every card an owner created from any
client, a per-card activity feed with real transaction hashes, and merchant names that follow the
owner across devices. It is part of `apps/web` (Next.js route handlers + Neon Postgres); there is
no separate service. Design: `docs/superpowers/specs/2026-11-25-indexer-v1-design.md`.

## What it indexes

| Source | Events | Window |
|---|---|---|
| Factory `CBMSK4…AUSE` | `card_created` → `cards` | live (RPC) + history (stellar.expert) |
| Every known card | `merchant_added`, `merchant_removed`, `policy_changed`, `signer_changed`, `label_changed`, `state_changed`, `withdrawn` → `card_events` | same |
| USDC SAC `CBIELT…DAMA` | `transfer` where either side is a known card → `payments` (`out` = payment or withdrawal leg, `in` = funding) | same |

Policy refusals happen at simulation and never reach the chain, so they are not in the feed (the
empty state says so). Cards created by another factory are not seen by the scan; "Add existing
card" registers them through `POST /api/cards/:card/track`.

## How it runs (Hobby plan, no scheduler)

- **Read-time ticks.** Every read handler calls `ensureFresh()`: if the last tick is older than
  20 s it runs one bounded `tick()` (≤ 8 s, ≤ 5 RPC pages) before answering. A tick scans forward
  from `indexer_state.last_ledger + 1` in 2 000-ledger chunks with one `getEvents` call per chunk
  (four filters: factory `card_created`; topic-only card kinds; `signer_changed`/`withdrawn`;
  USDC `transfer`), shrinking the chunk when RPC answers "processing limit" or a page comes back
  full. Concurrent ticks are serialised by `indexer_state.tick_lock` (stale after 60 s).
- **Daily safety net.** `vercel.json` schedules `GET /api/indexer/tick` at 03:00 UTC with
  `Authorization: Bearer $CRON_SECRET` (budget 60 s / 60 pages), so the position never leaves the
  RPC's ~7-day window even with no visitors. If it ever does, the next tick logs a `gap` and
  resumes from the oldest ledger RPC still has; the missing range is recoverable with the backfill.
- **Reads never fail because ingestion failed.** A tick error is logged, the stale rows are served
  with `X-Mooring-Index-Stale: 1` and `stale: true` in the body.

## Backfill (one-time history import)

RPC keeps about seven days. History back to the v2 factory deployment (2026-09-13) comes from the
stellar.expert testnet API — `GET /explorer/testnet/contract/{id}/events` (full history; `topic=<card>`
on the USDC SAC yields a card's transfers) — with tx hashes resolved per ledger through Horizon
(`/ledgers/{seq}/transactions`, `paging_token` = TOID). It writes through the same idempotent upserts
as the live tick, so it is safe to re-run.

```bash
cd apps/web
set -a; source .env.local; set +a      # DATABASE_URL + the NEXT_PUBLIC_* values
npm run db:migrate                     # applies db/schema.sql (idempotent)
npm run indexer:backfill               # factory + every card not yet backfilled
npm run indexer:backfill -- --card C…  # one tracked card
```

## API

All routes: `runtime = "nodejs"`, 120 requests/min per IP, `Cache-Control: private, max-age=5`,
`503 { error: "no_database" }` when `DATABASE_URL` is unset (the app then uses the salt probe and
local storage exactly as before).

| Route | Response |
|---|---|
| `GET /api/cards?owner=G…` | `{ owner, cards: [{ card, label, createdAt, createdTx, trackedBy }], stale }` oldest first. `400 invalid_owner`. |
| `GET /api/cards/:card/activity?limit=50&cursor=` | `{ card, items: [{ id, kind, ledger, txHash, ts, amount, counterparty, merchantName, payload }], nextCursor, stale }` newest first. `kind` ∈ `payment, funded, created, merchant_added, merchant_removed, policy_changed, signer_changed, label_changed, state_changed, withdrawn`. Amounts are USDC base-unit strings. `404 unknown_card`. |
| `GET /api/cards/:card/merchants` | `{ card, merchants: [{ payTo, name, url, addedAt, addedTx, removedAt }] }` — the allowlist folded from events, joined with verified labels. |
| `POST /api/cards/:card/merchants/:payTo/label` `{ url }` | Resolves `url` with the merchant resolver (SSRF guard, live 402); stores `{ name: host, url }` only when the 402's `payTo` equals `:payTo` on the app's network. `422 payee_mismatch` / `422 unresolvable`. No wallet signature is needed because the server re-verifies a public fact. |
| `POST /api/cards/:card/track` | Reads the contract's WASM hash (must be the Mooring card) and `info().owner`, inserts the card as `manual`, backfills its history. `422 not_a_card`. |
| `GET /api/indexer/tick` | Cron only (`CRON_SECRET`). Returns `{ pages, events, written, lastLedger, gap?, caughtUp, durationMs }`. |

## Schema

`apps/web/db/schema.sql` — `cards`, `card_events`, `payments`, `merchant_labels`, `indexer_state`
(single row). Idempotent `CREATE … IF NOT EXISTS`; applied by `npm run db:migrate` and, in tests,
loaded into PGlite so the suite runs real Postgres SQL without a server.

## Configuration

| Variable | Where | Meaning |
|---|---|---|
| `DATABASE_URL` | Vercel (Neon Marketplace integration) + `apps/web/.env.local` | Neon connection string. Absent → indexer off, app degrades to the probe. |
| `CRON_SECRET` | Vercel | Bearer token Vercel sends to cron routes. |
| `MOORING_INDEXER_DISABLED=1` | optional | Kill switch without removing the database. |

## Limits and follow-ups

- stellar.expert is a third-party, unauthenticated API: used for the one-time backfill and for a
  manually tracked card's history only; the live path is first-party RPC.
- The USDC `transfer` filter sees every USDC transfer on the network (~19 k/day on testnet) and keeps
  only known cards; on pubnet a per-card filter set (`cardFilters`) is the switch to flip.
- Alerts (denial, low balance, threshold, 80 % of period) and CSV export (week 4) read these tables.
