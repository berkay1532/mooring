/**
 * Every SQL statement the indexer runs, in one place. All writes are idempotent
 * (`ON CONFLICT DO NOTHING` / upserts) so a page can be re-applied after a crash.
 * Amounts travel as decimal strings; the API never sees a bigint or a float.
 */
import type { SqlClient } from "./db";
import type { CardEventKind, IndexedEvent, Payload } from "./types";

export interface CardRow {
  card: string;
  owner: string;
  label: string | null;
  factory: string | null;
  created_ledger: number | null;
  created_tx: string | null;
  created_at: string | null;
  tracked_by: "factory" | "manual";
  backfilled_at: string | null;
}

export interface ActivityRow {
  id: string;
  kind: CardEventKind | "payment" | "funded";
  ledger: number;
  txHash: string | null;
  ts: string;
  amount: string | null;
  counterparty: string | null;
  payload: Payload;
}

export interface MerchantRow {
  payTo: string;
  addedAt: string;
  addedTx: string | null;
  removedAt: string | null;
  name: string | null;
  url: string | null;
}

export interface IndexerState {
  cursor: string | null;
  last_ledger: number | null;
  last_tick: string | null;
  tick_lock: string | null;
  backfill_done: boolean;
}

export async function insertCard(
  sql: SqlClient,
  c: {
    card: string;
    owner: string;
    factory?: string | null;
    createdLedger?: number | null;
    createdTx?: string | null;
    createdAt?: string | null;
    trackedBy?: "factory" | "manual";
    label?: string | null;
  },
): Promise<void> {
  await sql.query(
    `insert into cards (card, owner, factory, created_ledger, created_tx, created_at, tracked_by, label)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (card) do update set
       created_ledger = coalesce(cards.created_ledger, excluded.created_ledger),
       created_tx = coalesce(cards.created_tx, excluded.created_tx),
       created_at = coalesce(cards.created_at, excluded.created_at),
       factory = coalesce(cards.factory, excluded.factory)`,
    [
      c.card,
      c.owner,
      c.factory ?? null,
      c.createdLedger ?? null,
      c.createdTx ?? null,
      c.createdAt ?? null,
      c.trackedBy ?? "factory",
      c.label ?? null,
    ],
  );
}

export async function knownCards(sql: SqlClient): Promise<Set<string>> {
  const rows = await sql.query<{ card: string }>("select card from cards");
  return new Set(rows.map((r) => r.card));
}

export async function getCard(sql: SqlClient, card: string): Promise<CardRow | null> {
  const rows = await sql.query<CardRow>("select * from cards where card = $1", [card]);
  return rows[0] ?? null;
}

export async function listCards(sql: SqlClient, owner: string): Promise<CardRow[]> {
  return sql.query<CardRow>(
    "select * from cards where owner = $1 order by created_ledger asc nulls last, card asc",
    [owner],
  );
}

export async function markBackfilled(sql: SqlClient, card: string): Promise<void> {
  await sql.query("update cards set backfilled_at = now() where card = $1", [card]);
}

/**
 * Applies normalised events in order. `created` inserts the card (only for the
 * configured factory); card kinds and transfers are stored only for known cards —
 * `known` is updated in place as cards appear, so a card created and funded in the
 * same page is handled. Returns how many rows were written.
 */
export async function applyEvents(
  sql: SqlClient,
  events: IndexedEvent[],
  known: Set<string>,
  factory: string,
): Promise<number> {
  let written = 0;
  for (const e of events) {
    if (e.kind === "created") {
      if (e.contract !== factory) continue;
      const card = String(e.payload.card);
      await insertCard(sql, {
        card,
        owner: String(e.payload.owner),
        factory,
        createdLedger: e.ledger,
        createdTx: e.txHash,
        createdAt: e.ts,
      });
      known.add(card);
      await sql.query(
        `insert into card_events (event_id, card, kind, ledger, tx_hash, ts, payload)
         values ($1, $2, 'created', $3, $4, $5, $6) on conflict (event_id) do nothing`,
        [e.eventId, card, e.ledger, e.txHash, e.ts, JSON.stringify(e.payload)],
      );
      written++;
      continue;
    }
    if (e.kind === "transfer") {
      const from = String(e.payload.from);
      const to = String(e.payload.to);
      const legs: Array<["out" | "in", string, string]> = [];
      if (known.has(from)) legs.push(["out", from, to]);
      if (known.has(to)) legs.push(["in", to, from]);
      for (const [direction, card, counterparty] of legs) {
        await sql.query(
          `insert into payments (event_id, card, direction, counterparty, amount, ledger, tx_hash, ts)
           values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (event_id) do nothing`,
          [
            legs.length === 1 ? e.eventId : `${e.eventId}:${direction}`,
            card,
            direction,
            counterparty,
            String(e.payload.amount),
            e.ledger,
            e.txHash,
            e.ts,
          ],
        );
        written++;
      }
      continue;
    }
    if (!known.has(e.contract)) continue;
    await sql.query(
      `insert into card_events (event_id, card, kind, ledger, tx_hash, ts, payload)
       values ($1, $2, $3, $4, $5, $6, $7) on conflict (event_id) do nothing`,
      [e.eventId, e.contract, e.kind, e.ledger, e.txHash, e.ts, JSON.stringify(e.payload)],
    );
    if (e.kind === "label_changed") {
      await sql.query("update cards set label = $2 where card = $1", [e.contract, String(e.payload.label)]);
    }
    written++;
  }
  return written;
}

/** Fills in tx hashes for stellar.expert rows once Horizon resolved them. */
export async function setTxHashes(sql: SqlClient, hashes: Array<{ eventId: string; txHash: string }>): Promise<void> {
  for (const h of hashes) {
    await sql.query("update card_events set tx_hash = $2 where event_id = $1 and tx_hash is null", [h.eventId, h.txHash]);
    await sql.query("update payments set tx_hash = $2 where event_id like $1 and tx_hash is null", [`${h.eventId}%`, h.txHash]);
  }
}

export function encodeCursor(ledger: number, id: string): string {
  return `${ledger}:${id}`;
}

export function decodeCursor(cursor: string | null | undefined): { ledger: number; id: string } | null {
  if (!cursor) return null;
  const i = cursor.indexOf(":");
  if (i <= 0) return null;
  const ledger = Number(cursor.slice(0, i));
  if (!Number.isInteger(ledger)) return null;
  return { ledger, id: cursor.slice(i + 1) };
}

/**
 * Newest first, keyset-paged on `(ledger, id)`. A `withdrawn` event and its own
 * `out` transfer are both stored; the feed hides that transfer by matching tx hash.
 */
export async function listActivity(
  sql: SqlClient,
  card: string,
  opts: { limit?: number; cursor?: string | null } = {},
): Promise<{ items: ActivityRow[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const c = decodeCursor(opts.cursor);
  const rows = await sql.query<{
    id: string;
    kind: string;
    ledger: number;
    tx_hash: string | null;
    ts: string;
    amount: string | null;
    counterparty: string | null;
    payload: Payload | string;
  }>(
    `select * from (
       select event_id as id, kind, ledger, tx_hash, ts, null::text as amount, null::text as counterparty, payload
         from card_events where card = $1
       union all
       select p.event_id as id, case when p.direction = 'out' then 'payment' else 'funded' end as kind,
              p.ledger, p.tx_hash, p.ts, p.amount::text, p.counterparty, '{}'::jsonb as payload
         from payments p where p.card = $1
           and not (p.direction = 'out' and p.tx_hash is not null and exists (
             select 1 from card_events w where w.card = $1 and w.kind = 'withdrawn' and w.tx_hash = p.tx_hash))
     ) a
     where ($2::int is null or (a.ledger, a.id) < ($2::int, $3::text))
     order by a.ledger desc, a.id desc
     limit $4`,
    [card, c?.ledger ?? null, c?.id ?? "", limit + 1],
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      id: r.id,
      kind: r.kind as ActivityRow["kind"],
      ledger: r.ledger,
      txHash: r.tx_hash,
      ts: new Date(r.ts).toISOString(),
      amount: r.amount,
      counterparty: r.counterparty,
      payload: typeof r.payload === "string" ? (JSON.parse(r.payload) as Payload) : r.payload,
    })),
    nextCursor: rows.length > limit && last ? encodeCursor(last.ledger, last.id) : null,
  };
}

/** Folds `merchant_added` / `merchant_removed` in ledger order and joins the labels. */
export async function listMerchants(sql: SqlClient, card: string): Promise<MerchantRow[]> {
  const rows = await sql.query<{ kind: string; ts: string; tx_hash: string | null; payload: Payload | string }>(
    `select kind, ts, tx_hash, payload from card_events
     where card = $1 and kind in ('merchant_added', 'merchant_removed')
     order by ledger asc, event_id asc`,
    [card],
  );
  const labels = await sql.query<{ pay_to: string; name: string; url: string }>(
    "select pay_to, name, url from merchant_labels where card = $1",
    [card],
  );
  const labelOf = new Map(labels.map((l) => [l.pay_to, l]));
  const out = new Map<string, MerchantRow>();
  for (const r of rows) {
    const p = typeof r.payload === "string" ? (JSON.parse(r.payload) as Payload) : r.payload;
    const payTo = String(p.merchant);
    const ts = new Date(r.ts).toISOString();
    if (r.kind === "merchant_added") {
      out.set(payTo, {
        payTo,
        addedAt: ts,
        addedTx: r.tx_hash,
        removedAt: null,
        name: labelOf.get(payTo)?.name ?? null,
        url: labelOf.get(payTo)?.url ?? null,
      });
    } else {
      const m = out.get(payTo);
      if (m) m.removedAt = ts;
    }
  }
  return [...out.values()];
}

export async function upsertLabel(
  sql: SqlClient,
  l: { card: string; payTo: string; name: string; url: string },
): Promise<void> {
  await sql.query(
    `insert into merchant_labels (card, pay_to, name, url, verified_at) values ($1, $2, $3, $4, now())
     on conflict (card, pay_to) do update set name = excluded.name, url = excluded.url, verified_at = now()`,
    [l.card, l.payTo, l.name, l.url],
  );
}

export async function getState(sql: SqlClient): Promise<IndexerState> {
  const rows = await sql.query<IndexerState>("select cursor, last_ledger, last_tick, tick_lock, backfill_done from indexer_state where id = 1");
  return rows[0] ?? { cursor: null, last_ledger: null, last_tick: null, tick_lock: null, backfill_done: false };
}

export async function setCursor(sql: SqlClient, s: { cursor: string | null; lastLedger: number }): Promise<void> {
  await sql.query("update indexer_state set cursor = $1, last_ledger = $2 where id = 1", [s.cursor, s.lastLedger]);
}

export async function markTick(sql: SqlClient): Promise<void> {
  await sql.query("update indexer_state set last_tick = now() where id = 1");
}

/** Takes the tick lock unless another tick holds one younger than `staleAfterMs`. */
export async function tryLock(sql: SqlClient, staleAfterMs = 60_000): Promise<boolean> {
  const rows = await sql.query<{ id: number }>(
    `update indexer_state set tick_lock = now()
     where id = 1 and (tick_lock is null or tick_lock < now() - ($1::int * interval '1 millisecond'))
     returning id`,
    [staleAfterMs],
  );
  return rows.length === 1;
}

export async function unlock(sql: SqlClient): Promise<void> {
  await sql.query("update indexer_state set tick_lock = null where id = 1");
}
