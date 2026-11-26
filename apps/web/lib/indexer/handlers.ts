/**
 * Request handlers for the indexer's read API (spec §5). Every handler is built
 * from injected deps so tests run them against PGlite and fakes; the `app/api`
 * route files only wire the defaults.
 */
import { StrKey } from "@stellar/stellar-sdk";

import type { ResolveResult } from "../merchants/resolve";
import { backfillCard, type BackfillDeps } from "./backfill";
import { hasDatabase, type SqlClient } from "./db";
import { ensureFresh } from "./freshness";
import { getCard, insertCard, listActivity, listCards, listMerchants, upsertLabel } from "./store";
import { tick, type TickDeps, type TickOptions } from "./tick";

export interface IndexerHandlerDeps {
  /** Resolved lazily so a missing DATABASE_URL yields 503, not a crash at import. */
  sql: () => SqlClient;
  tick: Omit<TickDeps, "sql">;
  limiter: { take(key: string): boolean };
  /** Live 402 lookup used to verify a merchant label (defaults to the resolver route's deps). */
  resolve: (url: string) => Promise<ResolveResult>;
  /** Reads a contract's WASM hash and, when it is a card, its owner. */
  readCard: (card: string) => Promise<{ wasmHash: string; owner: string | null; label?: string | null }>;
  cardWasmHash: string;
  network: string;
  /** Backfill fetcher for `track`; defaults to global fetch. */
  backfill: Omit<BackfillDeps, "sql" | "factory" | "usdc">;
  cronSecret?: string;
  enabled?: () => boolean;
  freshnessMs?: number;
  readTick?: TickOptions;
  cronTick?: TickOptions;
}

type Ctx = { params: Promise<Record<string, string>> | Record<string, string> };

const NO_STORE = { "cache-control": "no-store" };

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

async function param(ctx: Ctx, name: string): Promise<string> {
  const p = await ctx.params;
  return p[name] ?? "";
}

export function createIndexerHandlers(deps: IndexerHandlerDeps) {
  const enabled = deps.enabled ?? hasDatabase;
  const freshnessMs = deps.freshnessMs ?? 20_000;

  function gate(req: Request): Response | null {
    if (!enabled()) return json({ error: "no_database" }, 503, NO_STORE);
    if (!deps.limiter.take(clientKey(req))) return json({ error: "rate_limited" }, 429, { ...NO_STORE, "retry-after": "60" });
    return null;
  }

  async function fresh(sql: SqlClient): Promise<Record<string, string>> {
    const f = await ensureFresh({ ...deps.tick, sql }, freshnessMs, deps.readTick ?? { budgetMs: 8_000, maxPages: 5 });
    return { "cache-control": "private, max-age=5", ...(f.stale ? { "x-mooring-index-stale": "1" } : {}) };
  }

  async function knownCard(sql: SqlClient, card: string): Promise<Response | null> {
    if (!StrKey.isValidContract(card)) return json({ error: "invalid_card" }, 400, NO_STORE);
    if (!(await getCard(sql, card))) return json({ error: "unknown_card" }, 404, NO_STORE);
    return null;
  }

  return {
    /** GET /api/cards?owner=G… */
    async cards(req: Request): Promise<Response> {
      const bad = gate(req);
      if (bad) return bad;
      const owner = new URL(req.url).searchParams.get("owner") ?? "";
      if (!StrKey.isValidEd25519PublicKey(owner)) return json({ error: "invalid_owner" }, 400, NO_STORE);
      const sql = deps.sql();
      const headers = await fresh(sql);
      const rows = await listCards(sql, owner);
      return json(
        {
          owner,
          cards: rows.map((c) => ({
            card: c.card,
            label: c.label,
            createdAt: c.created_at ? new Date(c.created_at).toISOString() : null,
            createdTx: c.created_tx,
            trackedBy: c.tracked_by,
          })),
          stale: headers["x-mooring-index-stale"] === "1",
        },
        200,
        headers,
      );
    },

    /** GET /api/cards/:card/activity?limit=&cursor= */
    async activity(req: Request, ctx: Ctx): Promise<Response> {
      const bad = gate(req);
      if (bad) return bad;
      const card = await param(ctx, "card");
      const sql = deps.sql();
      const miss = await knownCard(sql, card);
      if (miss) return miss;
      const headers = await fresh(sql);
      const q = new URL(req.url).searchParams;
      const limitRaw = Number(q.get("limit") ?? 50);
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const page = await listActivity(sql, card, { limit, cursor: q.get("cursor") });
      const labels = new Map((await listMerchants(sql, card)).map((m) => [m.payTo, m.name]));
      return json(
        {
          card,
          items: page.items.map((i) => ({ ...i, merchantName: i.counterparty ? (labels.get(i.counterparty) ?? null) : null })),
          nextCursor: page.nextCursor,
          stale: headers["x-mooring-index-stale"] === "1",
        },
        200,
        headers,
      );
    },

    /** GET /api/cards/:card/merchants */
    async merchants(req: Request, ctx: Ctx): Promise<Response> {
      const bad = gate(req);
      if (bad) return bad;
      const card = await param(ctx, "card");
      const sql = deps.sql();
      const miss = await knownCard(sql, card);
      if (miss) return miss;
      const headers = await fresh(sql);
      return json({ card, merchants: await listMerchants(sql, card) }, 200, headers);
    },

    /** POST /api/cards/:card/merchants/:payTo/label { url } — verified against the live 402. */
    async label(req: Request, ctx: Ctx): Promise<Response> {
      const bad = gate(req);
      if (bad) return bad;
      const card = await param(ctx, "card");
      const payTo = await param(ctx, "payTo");
      if (!StrKey.isValidEd25519PublicKey(payTo) && !StrKey.isValidContract(payTo)) return json({ error: "invalid_pay_to" }, 400, NO_STORE);
      const sql = deps.sql();
      const miss = await knownCard(sql, card);
      if (miss) return miss;
      let url = "";
      try {
        url = String(((await req.json()) as { url?: unknown })?.url ?? "");
      } catch {
        return json({ error: "invalid_body" }, 400, NO_STORE);
      }
      if (!url) return json({ error: "invalid_body" }, 400, NO_STORE);
      const r = await deps.resolve(url);
      if (!r.ok) return json({ error: "unresolvable", code: r.code }, 422, NO_STORE);
      if (r.payTo !== payTo || r.network !== deps.network) return json({ error: "payee_mismatch" }, 422, NO_STORE);
      const name = new URL(r.url).host;
      await upsertLabel(sql, { card, payTo, name, url: r.url });
      return json({ card, payTo, name, url: r.url }, 200, NO_STORE);
    },

    /** POST /api/cards/:card/track — register a card the factory scan did not see. */
    async track(req: Request, ctx: Ctx): Promise<Response> {
      const bad = gate(req);
      if (bad) return bad;
      const card = await param(ctx, "card");
      if (!StrKey.isValidContract(card)) return json({ error: "invalid_card" }, 400, NO_STORE);
      const sql = deps.sql();
      const existing = await getCard(sql, card);
      if (existing?.backfilled_at) return json({ card, tracked: true, backfilled: true }, 200, NO_STORE);
      let read: { wasmHash: string; owner: string | null; label?: string | null };
      try {
        read = await deps.readCard(card);
      } catch {
        return json({ error: "not_a_card" }, 422, NO_STORE);
      }
      if (read.wasmHash !== deps.cardWasmHash || !read.owner) return json({ error: "not_a_card" }, 422, NO_STORE);
      await insertCard(sql, { card, owner: read.owner, trackedBy: "manual", label: read.label || null });
      let backfilled = false;
      try {
        await backfillCard(card, { ...deps.backfill, sql, factory: deps.tick.factory, usdc: deps.tick.usdc });
        backfilled = true;
      } catch (e) {
        deps.tick.log?.("indexer: track backfill failed", { card, error: e instanceof Error ? e.message : String(e) });
      }
      return json({ card, tracked: true, backfilled }, 200, NO_STORE);
    },

    /** GET /api/indexer/tick — cron / admin. */
    async tick(req: Request): Promise<Response> {
      if (!enabled()) return json({ error: "no_database" }, 503, NO_STORE);
      const auth = req.headers.get("authorization") ?? "";
      if (!deps.cronSecret || auth !== `Bearer ${deps.cronSecret}`) return json({ error: "unauthorized" }, 401, NO_STORE);
      const r = await tick({ ...deps.tick, sql: deps.sql() }, deps.cronTick ?? { budgetMs: 60_000, maxPages: 60 });
      return json(r, 200, NO_STORE);
    },
  };
}

export type IndexerHandlers = ReturnType<typeof createIndexerHandlers>;
