# Indexer v1 — design (Instaward #2, D2(a), week 2)

**Status:** approved by the owner in chat on 2026-11-25 (Hobby Vercel plan; indexer lives inside
`apps/web`). **Scope:** SOW §D2(a) — event ingestion for the factory and the cards, a Postgres
schema, a read API, backfill from the v2 factory's first ledger, and app integration (discovery via
the indexer with the probe as fallback, a per-card activity feed, merchant-name sync). Alerts and
CSV export are D2(c), week 4, and only need the tables this design creates.

## 1. Why

Card discovery today is a 32-slot salt probe plus `localStorage`; payment history does not exist
because RPC keeps events for about a week (`ledgerRetentionWindow` 120 960 ledgers ≈ 7 days on
`soroban-testnet.stellar.org`, measured 2026-11-25) and policy rejections happen at simulation.
An indexer is the only way to answer "what did my agent pay for" and the base the week-4 alerts
stand on.

## 2. Sources

| Need | Source | Notes |
|---|---|---|
| Live events | Stellar RPC `getEvents` | Cursor-paged, `limit` ≤ 10 000, ≤ 5 filters per call. One call per tick with: (1) factory `card_created` (`contractIds: [factory]`); (2) card events by topic only — `merchant_added`, `merchant_removed`, `policy_changed`, `state_changed`, `label_changed` — filtered to known cards client-side; (3) `signer_changed`, `withdrawn` (same); (4) USDC SAC `transfer` (`contractIds: [usdc]`, topics `["transfer","*","*","*"]`, ~19 k events/day on testnet, filtered to known cards client-side). Filters (2) and (3) carry no `contractIds` because the card set is unbounded. |
| History before the RPC window | stellar.expert testnet API, `GET /explorer/testnet/contract/{contract}/events?order=asc&limit=200&cursor=` | Full history since the v2 factory deployment (2026-09-13 verified). `topic=<address>` matches any topic position, so `/contract/{usdc}/events?topic=<card>` yields every USDC transfer in or out of a card. Record `id` is a TOID: `ledger = id >> 32`, `txOrder = (id >> 12) & 0xFFFFF`; the tx hash comes from Horizon `/ledgers/{seq}/transactions` (`paging_token` = TOID of the tx). Third-party, unauthenticated, used only for the one-time backfill and for a newly tracked card's history. |
| Tx hashes for backfilled rows | Horizon testnet `/ledgers/{seq}/transactions` | Full history. |

Not indexed: policy denials (simulation-level, never on chain — the activity feed says so in its
empty/legend copy), the agent's own guard refusals (W3).

## 3. Storage

Neon Postgres provisioned through the Vercel Marketplace (free tier; `DATABASE_URL` injected into
the project; the owner pulls it into `apps/web/.env.local`). Access through
`@neondatabase/serverless` (`neon(url).query(text, params)`), plain SQL, no ORM. Tests run the same
SQL on PGlite (`@electric-sql/pglite`, Postgres in WASM) behind a four-line `SqlClient` interface
(`query<T>(text, params): Promise<T[]>`), so the unit suite needs no network and no Neon.

Schema (`apps/web/db/schema.sql`, idempotent `CREATE TABLE IF NOT EXISTS`, applied by
`npm run db:migrate -w @mooring/web` with `DATABASE_URL`; the same file is loaded into PGlite by
the tests):

```sql
cards            (card text pk, owner text not null, label text, factory text,
                  created_ledger int, created_tx text, created_at timestamptz,
                  tracked_by text not null default 'factory',   -- 'factory' | 'manual'
                  backfilled_at timestamptz)                     -- null until its history is in
card_events      (event_id text pk,                              -- rpc event id or 'se:'||toid
                  card text not null references cards, kind text not null,
                  ledger int not null, tx_hash text, ts timestamptz not null,
                  payload jsonb not null default '{}')           -- decoded, bigints as strings
payments         (event_id text pk, card text not null references cards,
                  direction text not null,                       -- 'out' | 'in'
                  counterparty text not null, amount numeric(30,0) not null,
                  ledger int not null, tx_hash text, ts timestamptz not null)
merchant_labels  (card text not null, pay_to text not null, name text not null, url text not null,
                  verified_at timestamptz not null, primary key (card, pay_to))
indexer_state    (id int pk default 1 check (id = 1), cursor text, last_ledger int,
                  last_tick timestamptz, tick_lock timestamptz, backfill_done boolean default false)
```

Indexes: `card_events (card, ledger desc)`, `payments (card, ledger desc)`, `cards (owner)`.
`kind` ∈ `created | merchant_added | merchant_removed | policy_changed | signer_changed |
label_changed | state_changed | withdrawn` (payments are their own table; a `withdrawn` event and
its outgoing transfer both exist — the feed shows the event and hides the matching `out` row to
the owner).

## 4. Ingestion

`apps/web/lib/indexer/`:

- `normalize/rpc.ts` — `fromRpcEvent(e)` → `IndexedEvent | null` (decodes topics/value with
  `scValToNative`; SAC `transfer` value is `i128` amount, or a map `{amount, to_muxed_id}` under
  protocol ≥ 23 — both handled; `state_changed` payload `{state: 0|1|2}` with the name).
- `normalize/stellarExpert.ts` — `fromExpertRecord(r)` → the same `IndexedEvent` (from
  `topicsXdr` + `bodyXdr`), `ledgerOf(id)`, `txOrderOf(id)`.
- `tick.ts` — `tick(deps, { budgetMs = 8000, maxPages = 5 })`: acquire the lock
  (`UPDATE indexer_state SET tick_lock = now() WHERE tick_lock IS NULL OR tick_lock < now() - 60 s`
  → 1 row or return `{skipped: "locked"}`), read `cursor`, loop `getEvents` from the cursor (or
  from `oldestLedger` when the cursor is null or older than the window — recorded as a `gap` in
  the result and logged), apply events in ledger order inside one transaction per page
  (`cards` insert on `card_created`; `card_events`/`payments` upserts with `ON CONFLICT DO NOTHING`
  for known cards; cards created by other factories are ignored until tracked), write the new
  cursor, release the lock. Returns `{pages, events, ledger, durationMs}`.
- `backfill.ts` — `backfillCard(card, deps)`: stellar.expert card events + USDC transfers with
  `topic=card`, Horizon hash resolution, same upserts; `backfillFactory(deps)`: all
  `card_created` events, then `backfillCard` for each. Idempotent; sets `cards.backfilled_at`.
  Run once by `npm run indexer:backfill -w @mooring/web` (owner's `DATABASE_URL`), and by
  `POST /api/cards/:id/track` for a manually added card. Rate: ≤ 4 requests/s to stellar.expert.
- `freshness.ts` — `ensureFresh(deps, maxAgeMs = 20_000)`: if `last_tick` is older than
  `maxAgeMs`, run `tick` (bounded), else no-op. Every read handler calls it first; read handlers
  never fail because a tick failed (the tick error is logged and the stale data served with
  `X-Mooring-Index-Stale: 1`).

Triggers (Hobby plan: Vercel Cron ≥ once a day, 300 s max duration):
- Read-time: `ensureFresh` on every read API call (the app polls `useCards` every 30 s already).
- Safety net: `vercel.json` cron `0 3 * * *` → `GET /api/indexer/tick` with
  `Authorization: Bearer $CRON_SECRET` (Vercel sets the header), budget 60 s / 50 pages, so the
  cursor never ages past the RPC window even with no visitors.
- Week 4 adds a 5-minute GitHub Actions schedule hitting the same endpoint for alert latency.

## 5. Read API (`apps/web/app/api/...`, `runtime = "nodejs"`)

| Route | Returns |
|---|---|
| `GET /api/cards?owner=G…` | `{ owner, cards: [{ card, label, createdAt, createdTx, trackedBy }], indexedLedger, stale }` — ordered by `created_ledger`. 400 on a non-G owner. |
| `GET /api/cards/:card/activity?limit=50&cursor=` | `{ card, items: ActivityItem[], nextCursor }` — union of `card_events` and `payments` ordered by `(ledger desc, event_id desc)`; `ActivityItem = { id, kind, ts, ledger, txHash, amount?, counterparty?, merchantName?, payload }`; `kind` adds `payment` and `funded`. 404 for an unknown card. |
| `GET /api/cards/:card/merchants` | `{ card, merchants: [{ payTo, name?, url?, addedAt, addedTx, removedAt? }] }` — from `merchant_added/removed` events joined with `merchant_labels`. |
| `POST /api/cards/:card/merchants/:payTo/label` `{ url }` | Resolves `url` with the existing resolver (`lib/merchants/resolve.ts`, SSRF guard, 10 s); 200 `{ name, url, verifiedAt }` when the 402's `payTo` equals `:payTo` and the network matches; 422 `{ error: "payee_mismatch" }` otherwise; 404 for an unknown card. Idempotent upsert. No wallet signature — the only thing the write asserts is a public fact the server re-verified. |
| `POST /api/cards/:card/track` | Reads the contract's WASM hash (must equal `config.cardWasmHash`) and `info().owner`; inserts the card with `tracked_by = 'manual'`, then `backfillCard` (bounded to 30 s; the rest completes on later ticks via `backfilled_at IS NULL`). 422 `{ error: "not_a_card" }`. |
| `GET /api/indexer/tick` | Cron/admin only (`CRON_SECRET`), returns the `tick` result. 401 otherwise. |

All read routes: `ensureFresh` first, rate limit 120/min per IP (reuse `createRateLimiter`),
`Cache-Control: private, max-age=5`. All addresses validated with `StrKey`. Handlers are
`create…Handler(deps)` factories like `lib/directory/handler.ts`, so tests inject the `SqlClient`
and fake RPC.

## 6. App integration

- `useCards(owner)` (`lib/query/hooks.ts`): fetch `/api/cards?owner=` first; on success the list
  is `indexed ∪ added` (localStorage); on failure fall back to today's `discoverCards` probe
  (`lib/chain/discover.ts` stays). Manual "Add existing card" also calls `POST /api/cards/:id/track`
  (fire-and-forget; the local list still works if it fails).
- New `components/cards/ActivitySection.tsx` under the merchants/agent column of `CardDetails`:
  rows "Paid 0.001 USDC to demo.rail402.dev · 2 h ago · tx ↗", "Funded 1.00 USDC", "Frozen",
  "Merchant added demo.rail402.dev", "Policy changed", "Signer rotated", "Renamed to …",
  "Created"; "Load more" paginates; empty state "No activity yet. Policy refusals happen before a
  transaction exists, so they never appear here." Error state with Retry. Stellar Expert links.
- `MerchantsSection`: names come from `/api/cards/:id/merchants` (labels) first, localStorage
  second; after a successful add with a URL it posts the label. `prefs.ts` label helpers stay as
  the offline fallback.
- `EmptyState` copy updated: CLI cards and cards created on other devices now appear by themselves.

## 7. Configuration

`DATABASE_URL` (server only; absent → every indexer route answers 503 `{ error: "no_database" }`
and the app silently uses the probe, so a fork without Neon still works), `CRON_SECRET`,
optional `MOORING_INDEXER_DISABLED=1`. Documented in `.env.example`, `docs/web-app.md`
("Indexer") and a new `docs/indexer.md` (schema, backfill runbook, API, limits).

## 8. Testing

- Unit (vitest, node env): both normalisers on trimmed real fixtures (`test/fixtures/indexer/*`),
  `tick` (cursor advance, lock contention, gap handling, budget stop) with a fake `getEvents`,
  `backfill` with fake stellar.expert/Horizon fetchers, every handler on PGlite (schema applied
  from `db/schema.sql`), label verification (match / mismatch / unreachable).
- Components (jsdom): `ActivitySection` rows, load-more, empty/error; `useCards` fallback order;
  `MerchantsSection` label source precedence.
- Playwright: `e2e/activity.spec.ts` with `page.route` stubs for `/api/cards*` (the shared fixture
  stubs them by default, like `/api/directory`).
- CI unchanged (`web` job); PGlite runs in-process.

## 9. Evidence (SOW §6.1, D2)

Deployed indexer URL; `GET /api/cards?owner=GCJJ…KKBD` listing the owner's cards; `GET
/api/cards/CBOO…UH5W/activity` showing the first sprint's payments (hashes already in
`docs/testnet.md`) and the 2026-11-24 directory payment; a screenshot of the activity feed; the
CLI cards (`CBI3…`, `CAXB…`) listed for the throwaway owner without import.

## 10. Out of scope (later weeks or v2)

Alerts, CSV export (D2(c), W4). Pubnet ingestion (the code is network-agnostic; the deployment is
testnet). Denial logging from the client guard (W3 D3(b) may post refusals to the indexer — the
`card_events.kind` column leaves room). Multi-factory discovery beyond `config.factory`.
