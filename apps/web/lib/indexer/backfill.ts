/**
 * One-time history import from stellar.expert (full testnet history since the v2
 * factory went live) with tx hashes resolved through Horizon. Idempotent: every
 * write goes through the same `applyEvents` upserts the live tick uses.
 */
import type { SqlClient } from "./db";
import { fromExpertRecord, ledgerOf, txToidOf, type ExpertRecord } from "./normalize/stellarExpert";
import { applyEvents, getCard, insertCard, knownCards, markBackfilled, setTxHashes } from "./store";
import type { IndexedEvent } from "./types";

export interface BackfillDeps {
  sql: SqlClient;
  fetchJson(url: string): Promise<unknown>;
  factory: string;
  usdc: string;
  /** `stellar:testnet` → `testnet`, `stellar:pubnet` → `public`. */
  expertNetwork?: "testnet" | "public";
  expertBase?: string;
  horizonBase?: string;
  /** Pause between upstream requests; stellar.expert is a shared, unauthenticated API. */
  sleep?: (ms: number) => Promise<void>;
  pauseMs?: number;
  /** stellar.expert page size (max 200). */
  pageSize?: number;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

export interface BackfillResult {
  cards: number;
  events: number;
  written: number;
  hashesResolved: number;
  unresolved: number;
}

const defaults = {
  expertBase: "https://api.stellar.expert",
  horizonBase: "https://horizon-testnet.stellar.org",
  expertNetwork: "testnet" as const,
  pauseMs: 250,
  pageSize: 200,
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
};

type ExpertPage = { _links?: { next?: { href?: string } }; _embedded?: { records?: ExpertRecord[] } };

/** Walks `/contract/{id}/events` ascending until a page comes back short. */
export async function* expertEvents(contract: string, deps: BackfillDeps, query: Record<string, string> = {}): AsyncGenerator<ExpertRecord[]> {
  const d = { ...defaults, ...deps };
  const limit = d.pageSize;
  let cursor: string | undefined;
  for (;;) {
    const qs = new URLSearchParams({ order: "asc", limit: String(limit), ...query, ...(cursor ? { cursor } : {}) });
    const url = `${d.expertBase}/explorer/${d.expertNetwork}/contract/${contract}/events?${qs}`;
    const page = (await d.fetchJson(url)) as ExpertPage;
    const records = page?._embedded?.records ?? [];
    if (records.length) yield records;
    if (records.length < limit) return;
    cursor = records[records.length - 1].paging_token ?? records[records.length - 1].id;
    await d.sleep(d.pauseMs);
  }
}

type HorizonTxPage = { _embedded?: { records?: Array<{ paging_token: string; hash: string }> } };

/**
 * Maps `se:<id>` events to tx hashes: one Horizon call per distinct ledger, then a
 * lookup by the transaction's TOID (`paging_token`). Returns the pairs it could resolve.
 */
export async function resolveTxHashes(events: IndexedEvent[], deps: BackfillDeps): Promise<{ resolved: Array<{ eventId: string; txHash: string }>; unresolved: number }> {
  const d = { ...defaults, ...deps };
  const byLedger = new Map<number, IndexedEvent[]>();
  for (const e of events) {
    if (!e.eventId.startsWith("se:") || e.txHash) continue;
    const list = byLedger.get(e.ledger) ?? [];
    list.push(e);
    byLedger.set(e.ledger, list);
  }
  const resolved: Array<{ eventId: string; txHash: string }> = [];
  let unresolved = 0;
  for (const [ledger, list] of byLedger) {
    let hashes = new Map<string, string>();
    try {
      const page = (await d.fetchJson(`${d.horizonBase}/ledgers/${ledger}/transactions?limit=200`)) as HorizonTxPage;
      hashes = new Map((page?._embedded?.records ?? []).map((t) => [t.paging_token, t.hash]));
    } catch (err) {
      d.log?.("backfill: horizon ledger lookup failed", { ledger, error: err instanceof Error ? err.message : String(err) });
    }
    for (const e of list) {
      const h = hashes.get(txToidOf(e.eventId.slice(3)));
      if (h) resolved.push({ eventId: e.eventId, txHash: h });
      else unresolved++;
    }
    await d.sleep(d.pauseMs);
  }
  return { resolved, unresolved };
}

/** Imports one card's events and its USDC transfers (`topic=<card>`), then marks it backfilled. */
export async function backfillCard(card: string, deps: BackfillDeps): Promise<BackfillResult> {
  const d = { ...defaults, ...deps };
  const known = await knownCards(d.sql);
  if (!known.has(card)) throw new Error(`backfillCard: ${card} is not a tracked card`);
  const result: BackfillResult = { cards: 1, events: 0, written: 0, hashesResolved: 0, unresolved: 0 };
  const pages = [expertEvents(card, d), expertEvents(d.usdc, d, { topic: card })];
  for (const gen of pages) {
    for await (const records of gen) {
      const events = records.map(fromExpertRecord).filter((e): e is IndexedEvent => e !== null);
      const { resolved, unresolved } = await resolveTxHashes(events, d);
      const hashOf = new Map(resolved.map((r) => [r.eventId, r.txHash]));
      for (const e of events) e.txHash = hashOf.get(e.eventId) ?? null;
      result.events += events.length;
      result.written += await applyEvents(d.sql, events, known, d.factory);
      await setTxHashes(d.sql, resolved);
      result.hashesResolved += resolved.length;
      result.unresolved += unresolved;
    }
  }
  await markBackfilled(d.sql, card);
  return result;
}

/** Imports every `card_created` of the factory, then backfills each card not yet done. */
export async function backfillFactory(deps: BackfillDeps): Promise<BackfillResult> {
  const d = { ...defaults, ...deps };
  const total: BackfillResult = { cards: 0, events: 0, written: 0, hashesResolved: 0, unresolved: 0 };
  const created: IndexedEvent[] = [];
  for await (const records of expertEvents(d.factory, d)) {
    for (const r of records) {
      const e = fromExpertRecord(r);
      if (e?.kind === "created") created.push(e);
    }
  }
  const { resolved } = await resolveTxHashes(created, d);
  const hashOf = new Map(resolved.map((r) => [r.eventId, r.txHash]));
  for (const e of created) {
    e.txHash = hashOf.get(e.eventId) ?? null;
    const card = String(e.payload.card);
    await insertCard(d.sql, { card, owner: String(e.payload.owner), factory: d.factory, createdLedger: e.ledger, createdTx: e.txHash, createdAt: e.ts });
    await applyEvents(d.sql, [e], new Set(), d.factory);
  }
  for (const e of created) {
    const card = String(e.payload.card);
    const row = await getCard(d.sql, card);
    if (row?.backfilled_at) continue;
    const r = await backfillCard(card, d);
    total.cards += 1;
    total.events += r.events;
    total.written += r.written;
    total.hashesResolved += r.hashesResolved;
    total.unresolved += r.unresolved;
    d.log?.("backfill: card done", { card, ...r });
  }
  return total;
}

export function ledgerOfExpertId(id: string): number {
  return ledgerOf(id);
}
