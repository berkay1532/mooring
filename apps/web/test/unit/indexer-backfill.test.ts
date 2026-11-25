// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { backfillCard, backfillFactory, resolveTxHashes, type BackfillDeps } from "../../lib/indexer/backfill";
import { fromExpertRecord, type ExpertRecord } from "../../lib/indexer/normalize/stellarExpert";
import { getCard, listActivity, listCards, listMerchants } from "../../lib/indexer/store";
import type { IndexedEvent } from "../../lib/indexer/types";
import expertCard from "../fixtures/indexer/stellar-expert-card-events.json";
import expertFactory from "../fixtures/indexer/stellar-expert-factory-events.json";
import expertUsdc from "../fixtures/indexer/stellar-expert-usdc-events.json";
import horizonLedger from "../fixtures/indexer/horizon-ledger-5904134.json";
import { testDb } from "../helpers/pglite";

const FACTORY = "CBMSK4OSNLBEXTJWNEWX422RPVDEUNFEWADTSPECGBI26ESDYW65AUSE";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const CBI3 = "CBI3L3KLF63F2I72ZGHVC766JZCDPBCTLQVLP7X36G5MB3DVD62CV7RY";
const CAXB = "CAXB2N4XYXXIUJNOCJVRAHVZJD262GSBIEJRHVW6BD3GY5LGPVDVD2D5";
const PAY_TX = "e343161a4264c407bf1556d32080b54195fe4eb978c55478f9ca18b5da0f3be0";

type Page = { _embedded: { records: ExpertRecord[] } };
const cardRecords = (expertCard as Page)._embedded.records;
const usdcRecords = (expertUsdc as Page)._embedded.records;
const factoryRecords = (expertFactory as Page)._embedded.records;

/** Serves the fixtures by URL; Horizon knows only ledger 5904134 (the payment). */
function fakeFetch(opts: { pageSize?: number } = {}) {
  const urls: string[] = [];
  const fetchJson = async (url: string): Promise<unknown> => {
    urls.push(url);
    const u = new URL(url);
    if (u.hostname.startsWith("horizon")) {
      return u.pathname.includes("/ledgers/5904134/") ? horizonLedger : { _embedded: { records: [] } };
    }
    const contract = u.pathname.split("/")[4];
    const topic = u.searchParams.get("topic");
    const cursor = u.searchParams.get("cursor");
    let records: ExpertRecord[] = [];
    if (contract === FACTORY) records = factoryRecords;
    else if (contract === USDC) records = topic === CBI3 ? usdcRecords : [];
    else if (contract === CAXB) records = cardRecords;
    if (cursor) records = records.filter((r) => r.id > cursor);
    const limit = opts.pageSize ?? Number(u.searchParams.get("limit"));
    const page = records.slice(0, limit);
    return { _embedded: { records: page }, _links: {} };
  };
  return { fetchJson, urls };
}

function deps(db: BackfillDeps["sql"], fetchJson: BackfillDeps["fetchJson"]): BackfillDeps {
  return { sql: db, fetchJson, factory: FACTORY, usdc: USDC, sleep: async () => {}, pauseMs: 0 };
}

describe("indexer/backfill", () => {
  let db: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => {
    db = await testDb();
  });
  afterAll(async () => {
    await db.close();
  });

  it("resolveTxHashes maps stellar.expert TOIDs to Horizon hashes per ledger, counting misses", async () => {
    const events = usdcRecords.map(fromExpertRecord).filter((e): e is IndexedEvent => e !== null);
    const { fetchJson, urls } = fakeFetch();
    const r = await resolveTxHashes(events, deps(db, fetchJson));
    expect(r.resolved).toEqual([{ eventId: `se:${usdcRecords[1].id}`, txHash: PAY_TX }]);
    expect(r.unresolved).toBe(1); // the funding ledger is not in the fixture
    expect(urls.filter((u) => u.includes("/ledgers/"))).toHaveLength(2);
  });

  it("backfillFactory inserts every created card, then backfills each one once", async () => {
    const { fetchJson, urls } = fakeFetch();
    const r = await backfillFactory(deps(db, fetchJson));
    expect(r.cards).toBe(factoryRecords.length);
    const cards = await listCards(db, "GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD");
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.backfilled_at !== null && c.tracked_by === "factory")).toBe(true);
    // a second run finds everything backfilled and touches no card
    const again = await backfillFactory(deps(db, fetchJson));
    expect(again.cards).toBe(0);
    expect(urls.some((u) => u.includes(`/contract/${FACTORY}/events`))).toBe(true);
  });

  it("backfillCard imports card events and USDC transfers with resolved hashes, idempotently", async () => {
    await db.query("insert into cards (card, owner, tracked_by) values ($1, 'GBXKAJETATENTZ2TAYVBYGOCNUWRRJHSIKUC2NPWKYN7ZULYHKJHTGIR', 'manual') on conflict do nothing", [CBI3]);
    await db.query("insert into cards (card, owner, tracked_by) values ($1, 'GBXKAJETATENTZ2TAYVBYGOCNUWRRJHSIKUC2NPWKYN7ZULYHKJHTGIR', 'manual') on conflict do nothing", [CAXB]);
    const { fetchJson } = fakeFetch();
    const r1 = await backfillCard(CBI3, deps(db, fetchJson));
    expect(r1).toMatchObject({ cards: 1, events: 2, written: 2, hashesResolved: 1, unresolved: 1 });
    const act = await listActivity(db, CBI3);
    expect(act.items.map((i) => [i.kind, i.amount, i.txHash])).toEqual([
      ["payment", "10000", PAY_TX],
      ["funded", "10000000", null],
    ]);
    expect((await getCard(db, CBI3))?.backfilled_at).not.toBeNull();

    const r2 = await backfillCard(CBI3, deps(db, fetchJson));
    expect(r2.written).toBe(0);

    const r3 = await backfillCard(CAXB, deps(db, fetchJson));
    expect(r3.events).toBe(cardRecords.length);
    expect((await listMerchants(db, CAXB))[0]).toMatchObject({ removedAt: expect.any(String) });
    expect((await listActivity(db, CAXB)).items.map((i) => i.kind)).toEqual([
      "withdrawn",
      "signer_changed",
      "policy_changed",
      "state_changed",
      "state_changed",
      "label_changed",
      "merchant_removed",
      "merchant_added",
    ]);
    expect((await getCard(db, CAXB))?.label).toBe("cli card 2 renamed");
  });

  it("pages stellar.expert with the cursor until a short page", async () => {
    await db.query("delete from card_events where card = $1", [CAXB]);
    await db.query("update cards set backfilled_at = null where card = $1", [CAXB]);
    const { fetchJson, urls } = fakeFetch();
    const r = await backfillCard(CAXB, { ...deps(db, fetchJson), pageSize: 3 });
    expect(r.events).toBe(cardRecords.length);
    expect(urls.filter((u) => u.includes(`/contract/${CAXB}/events`)).length).toBeGreaterThanOrEqual(3);
  });

  it("refuses to backfill a card it does not track", async () => {
    await expect(backfillCard("CNOPE", deps(db, fakeFetch().fetchJson))).rejects.toThrow(/not a tracked card/);
  });
});
