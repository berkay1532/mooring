// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ensureFresh } from "../../lib/indexer/freshness";
import type { RpcEventLike } from "../../lib/indexer/normalize/rpc";
import { RpcError, type EventsRpc, type GetEventsRequest } from "../../lib/indexer/rpc";
import { getState, listActivity, listCards, tryLock, unlock } from "../../lib/indexer/store";
import { buildFilters, cardFilters, tick } from "../../lib/indexer/tick";
import rpcEvents from "../fixtures/indexer/rpc-events.json";
import { testDb } from "../helpers/pglite";

const FACTORY = "CBMSK4OSNLBEXTJWNEWX422RPVDEUNFEWADTSPECGBI26ESDYW65AUSE";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const CBI3 = "CBI3L3KLF63F2I72ZGHVC766JZCDPBCTLQVLP7X36G5MB3DVD62CV7RY";
const OWNER = "GBXKAJETATENTZ2TAYVBYGOCNUWRRJHSIKUC2NPWKYN7ZULYHKJHTGIR";
const ALL = rpcEvents as RpcEventLike[];

/** An RPC fake that serves the fixture by ledger range and records every request. */
function fakeRpc(opts: { oldest: number; latest: number; events?: RpcEventLike[]; failWith?: (req: GetEventsRequest) => Error | null }) {
  const calls: GetEventsRequest[] = [];
  const rpc: EventsRpc = {
    async getLedgerBounds() {
      return { latest: opts.latest, oldest: opts.oldest };
    },
    async getEvents(req) {
      calls.push(req);
      const err = opts.failWith?.(req);
      if (err) throw err;
      const start = req.startLedger ?? 0;
      const end = req.endLedger ?? Infinity;
      const events = (opts.events ?? ALL).filter((e) => e.ledger >= start && e.ledger < end).slice(0, req.pagination.limit);
      return { events, cursor: `${end}-0`, latestLedger: opts.latest, oldestLedger: opts.oldest };
    },
  };
  return { rpc, calls };
}

describe("indexer/tick", () => {
  let db: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => {
    db = await testDb();
  });
  afterAll(async () => {
    await db.close();
  });

  it("buildFilters: factory, topic-only card kinds, USDC transfers (≤ 5 filters, ≤ 5 patterns each)", () => {
    const f = buildFilters(FACTORY, USDC);
    expect(f).toHaveLength(4);
    expect(f[0].contractIds).toEqual([FACTORY]);
    expect(f[1].contractIds).toBeUndefined();
    expect(f.every((x) => (x.topics?.length ?? 0) <= 5)).toBe(true);
    expect(f[3]).toEqual({ type: "contract", contractIds: [USDC], topics: [[expect.stringMatching(/^AAAADwAAAAh0cmFuc2Zlcg==$/), "*", "*", "*"]] });
    expect(cardFilters(CBI3, USDC)[1].topics).toHaveLength(2);
  });

  it("first run starts at the oldest ledger, walks chunks to the tip and records the position", async () => {
    const { rpc, calls } = fakeRpc({ oldest: 5_880_000, latest: 5_920_000 });
    const r = await tick({ sql: db, rpc, factory: FACTORY, usdc: USDC }, { chunkLedgers: 10_000, maxPages: 10 });
    expect(r.skipped).toBeUndefined();
    expect(r).toMatchObject({ pages: 5, events: 15, written: 15, lastLedger: 5_920_000, caughtUp: true });
    expect(calls[0]).toMatchObject({ startLedger: 5_880_000, endLedger: 5_890_000 });
    expect(calls[4]).toMatchObject({ startLedger: 5_920_000, endLedger: 5_920_001 });
    expect((await getState(db)).last_ledger).toBe(5_920_000);
    expect((await listCards(db, OWNER)).map((c) => c.card)).toContain(CBI3);
    expect((await listActivity(db, CBI3)).items.map((i) => i.kind)).toEqual(["payment", "merchant_added", "funded", "created"]);
  });

  it("second run resumes after last_ledger and does nothing when nothing is new", async () => {
    const { rpc, calls } = fakeRpc({ oldest: 5_880_000, latest: 5_920_000 });
    const r = await tick({ sql: db, rpc, factory: FACTORY, usdc: USDC });
    expect(r).toMatchObject({ pages: 0, events: 0, caughtUp: true });
    expect(calls).toHaveLength(0);
  });

  it("stops at the page budget and reports caughtUp=false, then continues next time", async () => {
    const { rpc } = fakeRpc({ oldest: 5_880_000, latest: 5_930_000 });
    const r1 = await tick({ sql: db, rpc, factory: FACTORY, usdc: USDC }, { chunkLedgers: 2_000, maxPages: 2 });
    expect(r1).toMatchObject({ pages: 2, caughtUp: false, lastLedger: 5_924_000 });
    const r2 = await tick({ sql: db, rpc, factory: FACTORY, usdc: USDC }, { chunkLedgers: 2_000, maxPages: 10 });
    expect(r2).toMatchObject({ caughtUp: true, lastLedger: 5_930_000 });
  });

  it("stops when the time budget is spent", async () => {
    let t = 0;
    const { rpc, calls } = fakeRpc({ oldest: 5_880_000, latest: 5_990_000 });
    const r = await tick({ sql: db, rpc, factory: FACTORY, usdc: USDC, now: () => (t += 5_000) }, { chunkLedgers: 1_000, maxPages: 50, budgetMs: 8_000 });
    expect(calls.length).toBeLessThanOrEqual(2);
    expect(r.caughtUp).toBe(false);
  });

  it("records a gap when the saved position fell out of the RPC window", async () => {
    const { rpc, calls } = fakeRpc({ oldest: 6_100_000, latest: 6_100_500 });
    const r = await tick({ sql: db, rpc, factory: FACTORY, usdc: USDC });
    expect(r.gap).toEqual({ from: expect.any(Number), to: 6_099_999 });
    expect(calls[0].startLedger).toBe(6_100_000);
    expect(r.caughtUp).toBe(true);
  });

  it("shrinks the chunk on the RPC processing limit and on a full page", async () => {
    const { rpc, calls } = fakeRpc({
      oldest: 6_100_000,
      latest: 6_104_000,
      failWith: (req) => ((req.endLedger ?? 0) - (req.startLedger ?? 0) > 1_000 ? new RpcError("request exceeded processing limit threshold", -32001) : null),
    });
    const r = await tick({ sql: db, rpc, factory: FACTORY, usdc: USDC }, { chunkLedgers: 4_000, maxPages: 20 });
    expect(r.caughtUp).toBe(true);
    expect(calls.filter((c) => (c.endLedger ?? 0) - (c.startLedger ?? 0) <= 1_000).length).toBeGreaterThan(0);

    const full = fakeRpc({ oldest: 6_105_000, latest: 6_105_010, events: Array.from({ length: 3 }, (_, i) => ({ ...ALL[0], id: `dup${i}`, ledger: 6_105_001 })) });
    const r2 = await tick({ sql: db, rpc: full.rpc, factory: FACTORY, usdc: USDC }, { chunkLedgers: 8, limit: 3, maxPages: 20 });
    expect(r2.caughtUp).toBe(true);
    expect(full.calls.some((c) => (c.endLedger ?? 0) - (c.startLedger ?? 0) === 1)).toBe(true);
  });

  it("is skipped while another tick holds a fresh lock, and always releases its own", async () => {
    expect(await tryLock(db)).toBe(true);
    const { rpc } = fakeRpc({ oldest: 6_100_000, latest: 6_100_000 });
    expect((await tick({ sql: db, rpc, factory: FACTORY, usdc: USDC })).skipped).toBe("locked");
    await unlock(db);
    const boom: EventsRpc = { getLedgerBounds: async () => ({ latest: 7_000_000, oldest: 6_000_000 }), getEvents: async () => { throw new Error("boom"); } };
    await expect(tick({ sql: db, rpc: boom, factory: FACTORY, usdc: USDC })).rejects.toThrow("boom");
    expect((await getState(db)).tick_lock).toBeNull();
  });

  it("ensureFresh: no-op when fresh, runs when stale, never throws", async () => {
    const { rpc, calls } = fakeRpc({ oldest: 6_100_000, latest: 6_110_000 });
    const deps = { sql: db, rpc, factory: FACTORY, usdc: USDC };
    expect(await ensureFresh(deps, 60_000)).toEqual({ ran: false, stale: false });
    expect(calls).toHaveLength(0);
    expect((await ensureFresh(deps, 0, { maxPages: 50 })).ran).toBe(true);
    const boom: EventsRpc = { getLedgerBounds: async () => { throw new Error("rpc down"); }, getEvents: async () => { throw new Error("x"); } };
    expect(await ensureFresh({ ...deps, rpc: boom }, 0)).toMatchObject({ ran: false, stale: true, error: "rpc down" });
  });
});
