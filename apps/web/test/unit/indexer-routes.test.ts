// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createIndexerHandlers, type IndexerHandlerDeps } from "../../lib/indexer/handlers";
import { fromRpcEvent, type RpcEventLike } from "../../lib/indexer/normalize/rpc";
import type { EventsRpc } from "../../lib/indexer/rpc";
import { applyEvents, knownCards, markTick, setCursor } from "../../lib/indexer/store";
import type { IndexedEvent } from "../../lib/indexer/types";
import rpcEvents from "../fixtures/indexer/rpc-events.json";
import { testDb } from "../helpers/pglite";

const FACTORY = "CBMSK4OSNLBEXTJWNEWX422RPVDEUNFEWADTSPECGBI26ESDYW65AUSE";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const CBI3 = "CBI3L3KLF63F2I72ZGHVC766JZCDPBCTLQVLP7X36G5MB3DVD62CV7RY";
const CAXB = "CAXB2N4XYXXIUJNOCJVRAHVZJD262GSBIEJRHVW6BD3GY5LGPVDVD2D5";
const OWNER = "GBXKAJETATENTZ2TAYVBYGOCNUWRRJHSIKUC2NPWKYN7ZULYHKJHTGIR";
const RAIL = "GBSVTVRQ4AEFRNGH2MIOOWZSAVLZKOKNKI4UAGSMBZSNRP4I3FL3ELYP";
const WASM = "158b6acf3cde928e2c9c18c9e0f79fd29f7b847b7c73908c3972ef923c85d20f";
const OTHER_CARD = "CBOOOQDW4YA7JHDW4ELMKRFUUBJFBOJZGB4IXZJTHSAGUE4TWKJXUH5W";

const idleRpc: EventsRpc = {
  getLedgerBounds: async () => ({ latest: 100, oldest: 1 }),
  getEvents: async () => ({ events: [], cursor: "x", latestLedger: 100, oldestLedger: 1 }),
};

function get(url: string, headers: Record<string, string> = {}) {
  return new Request(`http://app.local${url}`, { headers });
}
function post(url: string, body: unknown) {
  return new Request(`http://app.local${url}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) });

describe("indexer/handlers", () => {
  let db: Awaited<ReturnType<typeof testDb>>;
  let deps: IndexerHandlerDeps;
  let enabled = true;
  let allow = true;
  const resolved: Record<string, { payTo: string; network: string }> = {
    "https://demo.rail402.dev/weather": { payTo: RAIL, network: "stellar:testnet" },
    "https://other.example/x": { payTo: "GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG", network: "stellar:testnet" },
  };

  beforeAll(async () => {
    db = await testDb();
    const events = (rpcEvents as RpcEventLike[]).map(fromRpcEvent).filter((e): e is IndexedEvent => e !== null);
    await applyEvents(db, events, await knownCards(db), FACTORY);
    await markTick(db);
    await setCursor(db, { cursor: null, lastLedger: 100 });
    deps = {
      sql: () => db,
      tick: { rpc: idleRpc, factory: FACTORY, usdc: USDC },
      limiter: { take: () => allow },
      resolve: async (url) => {
        const r = resolved[url];
        if (!r) return { ok: false, code: "unreachable", message: "nope" } as never;
        return { ok: true, url, payTo: r.payTo, network: r.network, asset: USDC, amount: "10000", scheme: "exact", feesSponsored: true } as never;
      },
      readCard: async (card) => (card === OTHER_CARD ? { wasmHash: WASM, owner: "GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD" } : { wasmHash: "00", owner: null }),
      cardWasmHash: WASM,
      network: "stellar:testnet",
      backfill: { fetchJson: async () => ({ _embedded: { records: [] } }), sleep: async () => {}, pauseMs: 0 },
      cronSecret: "s3cret",
      enabled: () => enabled,
      freshnessMs: 60_000,
    };
  });
  afterAll(async () => {
    await db.close();
  });

  it("GET /api/cards lists an owner's cards oldest first; 400 on a bad owner", async () => {
    const h = createIndexerHandlers(deps);
    const res = await h.cards(get(`/api/cards?owner=${OWNER}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=5");
    const body = await res.json();
    expect(body.cards.map((c: { card: string; label: string | null }) => [c.card, c.label])).toEqual([
      [CBI3, null],
      [CAXB, "cli card 2 renamed"],
    ]);
    expect(body.cards[0].createdTx).toMatch(/^ca2a7f2d/);
    expect(body.stale).toBe(false);
    expect((await h.cards(get("/api/cards?owner=nope"))).status).toBe(400);
    expect((await h.cards(get("/api/cards"))).status).toBe(400);
  });

  it("GET activity pages and names counterparties from labels; 404 unknown, 400 invalid", async () => {
    const h = createIndexerHandlers(deps);
    await db.query("insert into merchant_labels (card, pay_to, name, url, verified_at) values ($1,$2,'demo.rail402.dev','https://demo.rail402.dev/weather', now()) on conflict do nothing", [CBI3, RAIL]);
    const res = await h.activity(get(`/api/cards/${CBI3}/activity?limit=2`), ctx({ card: CBI3 }));
    const body = await res.json();
    expect(body.items.map((i: { kind: string; merchantName: string | null }) => [i.kind, i.merchantName])).toEqual([
      ["payment", "demo.rail402.dev"],
      ["merchant_added", null],
    ]);
    expect(body.nextCursor).toBeTruthy();
    const page2 = await (await h.activity(get(`/api/cards/${CBI3}/activity?cursor=${encodeURIComponent(body.nextCursor)}`), ctx({ card: CBI3 }))).json();
    expect(page2.items.map((i: { kind: string }) => i.kind)).toEqual(["funded", "created"]);
    expect((await h.activity(get(`/api/cards/${OTHER_CARD}/activity`), ctx({ card: OTHER_CARD }))).status).toBe(404);
    expect((await h.activity(get("/api/cards/xyz/activity"), ctx({ card: "xyz" }))).status).toBe(400);
  });

  it("GET merchants folds the allowlist and joins labels", async () => {
    const h = createIndexerHandlers(deps);
    const body = await (await h.merchants(get(`/api/cards/${CBI3}/merchants`), ctx({ card: CBI3 }))).json();
    expect(body.merchants).toEqual([expect.objectContaining({ payTo: RAIL, name: "demo.rail402.dev", removedAt: null })]);
  });

  it("POST label verifies the URL's payee: 200 on match, 422 on mismatch/unresolvable, 400 on bad body", async () => {
    const h = createIndexerHandlers(deps);
    const ok = await h.label(post(`/api/cards/${CAXB}/merchants/${RAIL}/label`, { url: "https://demo.rail402.dev/weather" }), ctx({ card: CAXB, payTo: RAIL }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ card: CAXB, payTo: RAIL, name: "demo.rail402.dev", url: "https://demo.rail402.dev/weather" });
    const mismatch = await h.label(post(`/api/cards/${CAXB}/merchants/${RAIL}/label`, { url: "https://other.example/x" }), ctx({ card: CAXB, payTo: RAIL }));
    expect(mismatch.status).toBe(422);
    expect((await mismatch.json()).error).toBe("payee_mismatch");
    const dead = await h.label(post(`/api/cards/${CAXB}/merchants/${RAIL}/label`, { url: "https://dead.example/" }), ctx({ card: CAXB, payTo: RAIL }));
    expect(dead.status).toBe(422);
    expect((await dead.json()).error).toBe("unresolvable");
    const bad = await h.label(new Request(`http://app.local/api/cards/${CAXB}/merchants/${RAIL}/label`, { method: "POST", body: "{" }), ctx({ card: CAXB, payTo: RAIL }));
    expect(bad.status).toBe(400);
    expect((await h.label(post(`/api/cards/${CAXB}/merchants/nope/label`, { url: "x" }), ctx({ card: CAXB, payTo: "nope" }))).status).toBe(400);
  });

  it("POST track accepts a real card (owner read on chain) and rejects anything else", async () => {
    const h = createIndexerHandlers(deps);
    const ok = await h.track(post(`/api/cards/${OTHER_CARD}/track`, {}), ctx({ card: OTHER_CARD }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ card: OTHER_CARD, tracked: true, backfilled: true });
    const cards = await (await h.cards(get("/api/cards?owner=GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD"))).json();
    expect(cards.cards[0]).toMatchObject({ card: OTHER_CARD, trackedBy: "manual" });
    const again = await h.track(post(`/api/cards/${OTHER_CARD}/track`, {}), ctx({ card: OTHER_CARD }));
    expect(await again.json()).toEqual({ card: OTHER_CARD, tracked: true, backfilled: true });
    const no = await h.track(post("/api/cards/CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC/track", {}), ctx({ card: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC" }));
    expect(no.status).toBe(422);
  });

  it("GET tick needs the cron secret", async () => {
    const h = createIndexerHandlers(deps);
    expect((await h.tick(get("/api/indexer/tick"))).status).toBe(401);
    expect((await h.tick(get("/api/indexer/tick", { authorization: "Bearer wrong" }))).status).toBe(401);
    const ok = await h.tick(get("/api/indexer/tick", { authorization: "Bearer s3cret" }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ pages: 0, caughtUp: true });
  });

  it("503 without a database, 429 when rate limited, stale header when the tick fails", async () => {
    const h = createIndexerHandlers(deps);
    enabled = false;
    expect((await h.cards(get(`/api/cards?owner=${OWNER}`))).status).toBe(503);
    expect((await h.tick(get("/api/indexer/tick", { authorization: "Bearer s3cret" }))).status).toBe(503);
    enabled = true;
    allow = false;
    expect((await h.cards(get(`/api/cards?owner=${OWNER}`))).status).toBe(429);
    allow = true;
    const down: EventsRpc = { getLedgerBounds: async () => { throw new Error("rpc down"); }, getEvents: idleRpc.getEvents };
    const h2 = createIndexerHandlers({ ...deps, tick: { ...deps.tick, rpc: down }, freshnessMs: 0 });
    const res = await h2.cards(get(`/api/cards?owner=${OWNER}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-mooring-index-stale")).toBe("1");
    expect((await res.json()).stale).toBe(true);
  });
});
