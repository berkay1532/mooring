import { Address, xdr } from "@stellar/stellar-sdk";

import type { SqlClient } from "./db";
import { fromRpcEvent } from "./normalize/rpc";
import type { EventFilter, EventsRpc } from "./rpc";
import { RpcError } from "./rpc";
import { applyEvents, getState, knownCards, markTick, setCursor, tryLock, unlock } from "./store";
import type { IndexedEvent } from "./types";

export interface TickDeps {
  sql: SqlClient;
  rpc: EventsRpc;
  factory: string;
  usdc: string;
  now?: () => number;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

export interface TickOptions {
  /** Wall-clock budget; the loop stops starting new pages past it. */
  budgetMs?: number;
  /** Hard cap on RPC pages per tick. */
  maxPages?: number;
  /** Ledgers per `getEvents` request; halves when a page comes back full. */
  chunkLedgers?: number;
  /** `getEvents` page size. */
  limit?: number;
}

export interface TickResult {
  skipped?: "locked";
  pages: number;
  events: number;
  written: number;
  /** Last ledger fully applied. */
  lastLedger: number | null;
  /** Ledgers the indexer could not read because they left the RPC window. */
  gap?: { from: number; to: number };
  caughtUp: boolean;
  durationMs: number;
}

const sym = (s: string) => xdr.ScVal.scvSymbol(s).toXDR("base64");

/** The four filters of spec §2, as base64 topic patterns. */
export function buildFilters(factory: string, usdc: string): EventFilter[] {
  return [
    { type: "contract", contractIds: [factory], topics: [[sym("card_created"), "*"]] },
    {
      type: "contract",
      topics: [
        [sym("merchant_added"), "*"],
        [sym("merchant_removed"), "*"],
        [sym("policy_changed")],
        [sym("state_changed")],
        [sym("label_changed")],
      ],
    },
    { type: "contract", topics: [[sym("signer_changed")], [sym("withdrawn")]] },
    { type: "contract", contractIds: [usdc], topics: [[sym("transfer"), "*", "*", "*"]] },
  ];
}

/** Per-card filter for a narrow catch-up (track / backfill tail). */
export function cardFilters(card: string, usdc: string): EventFilter[] {
  const a = Address.fromString(card).toScVal().toXDR("base64");
  return [
    { type: "contract", contractIds: [card] },
    { type: "contract", contractIds: [usdc], topics: [[sym("transfer"), a, "*", "*"], [sym("transfer"), "*", a, "*"]] },
  ];
}

function isProcessingLimit(e: unknown): boolean {
  return e instanceof RpcError && (e.code === -32001 || /processing limit/i.test(e.message));
}

/**
 * One bounded ingestion pass. Scans forward from `last_ledger + 1` (or the oldest
 * ledger RPC still has) in `chunkLedgers`-sized ranges, applying each page inside
 * the tick lock. Safe to call from any request: a concurrent tick is skipped.
 */
export async function tick(deps: TickDeps, opts: TickOptions = {}): Promise<TickResult> {
  const now = deps.now ?? Date.now;
  const started = now();
  const budgetMs = opts.budgetMs ?? 8_000;
  const maxPages = opts.maxPages ?? 5;
  const limit = opts.limit ?? 10_000;
  let chunk = opts.chunkLedgers ?? 2_000;
  const log = deps.log ?? (() => {});

  if (!(await tryLock(deps.sql))) {
    return { skipped: "locked", pages: 0, events: 0, written: 0, lastLedger: null, caughtUp: false, durationMs: now() - started };
  }
  const result: TickResult = { pages: 0, events: 0, written: 0, lastLedger: null, caughtUp: false, durationMs: 0 };
  try {
    const state = await getState(deps.sql);
    const bounds = await deps.rpc.getLedgerBounds();
    let pos = state.last_ledger == null ? bounds.oldest : state.last_ledger + 1;
    if (pos < bounds.oldest) {
      result.gap = { from: pos, to: bounds.oldest - 1 };
      log("indexer: gap — ledgers left the RPC window", result.gap);
      pos = bounds.oldest;
    }
    result.lastLedger = state.last_ledger;
    const filters = buildFilters(deps.factory, deps.usdc);
    const known = await knownCards(deps.sql);

    while (pos <= bounds.latest && result.pages < maxPages && now() - started < budgetMs) {
      // `endLedger` is exclusive in practice (a [start, start] range returns nothing).
      const end = Math.min(pos + chunk, bounds.latest + 1);
      let page;
      try {
        page = await deps.rpc.getEvents({ startLedger: pos, endLedger: end, filters, pagination: { limit } });
      } catch (e) {
        if (isProcessingLimit(e) && chunk > 1) {
          chunk = Math.max(1, Math.floor(chunk / 4));
          log("indexer: RPC processing limit, shrinking chunk", { chunk });
          continue;
        }
        throw e;
      }
      result.pages++;
      if (page.events.length >= limit && chunk > 1) {
        chunk = Math.max(1, Math.floor(chunk / 2));
        log("indexer: full page, shrinking chunk", { chunk });
        continue;
      }
      const events = page.events.map(fromRpcEvent).filter((e): e is IndexedEvent => e !== null);
      events.sort((a, b) => a.ledger - b.ledger || a.eventId.localeCompare(b.eventId));
      result.events += events.length;
      result.written += await applyEvents(deps.sql, events, known, deps.factory);
      result.lastLedger = end - 1;
      await setCursor(deps.sql, { cursor: page.cursor ?? null, lastLedger: end - 1 });
      pos = end;
    }
    result.caughtUp = pos > bounds.latest;
    await markTick(deps.sql);
  } finally {
    await unlock(deps.sql);
    result.durationMs = now() - started;
  }
  return result;
}
