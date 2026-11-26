// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fromRpcEvent, type RpcEventLike } from "../../lib/indexer/normalize/rpc";
import {
  applyEvents,
  decodeCursor,
  encodeCursor,
  fillLabel,
  getState,
  insertCard,
  knownCards,
  listActivity,
  listCards,
  listMerchants,
  markTick,
  setCursor,
  setTxHashes,
  tryLock,
  unlock,
  upsertLabel,
} from "../../lib/indexer/store";
import type { IndexedEvent } from "../../lib/indexer/types";
import rpcEvents from "../fixtures/indexer/rpc-events.json";
import { testDb } from "../helpers/pglite";

const FACTORY = "CBMSK4OSNLBEXTJWNEWX422RPVDEUNFEWADTSPECGBI26ESDYW65AUSE";
const CBI3 = "CBI3L3KLF63F2I72ZGHVC766JZCDPBCTLQVLP7X36G5MB3DVD62CV7RY";
const CAXB = "CAXB2N4XYXXIUJNOCJVRAHVZJD262GSBIEJRHVW6BD3GY5LGPVDVD2D5";
const OWNER = "GBXKAJETATENTZ2TAYVBYGOCNUWRRJHSIKUC2NPWKYN7ZULYHKJHTGIR";
const MERCHANT = "GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG";

const events = (rpcEvents as RpcEventLike[]).map(fromRpcEvent).filter((e): e is IndexedEvent => e !== null);

describe("indexer/store", () => {
  let db: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => {
    db = await testDb();
  });
  afterAll(async () => {
    await db.close();
  });

  it("applies the fixture in order: cards appear, then their events and payments", async () => {
    const known = await knownCards(db);
    expect(known.size).toBe(0);
    const written = await applyEvents(db, events, known, FACTORY);
    expect(written).toBe(15);
    expect([...known].sort()).toEqual([CAXB, CBI3].sort());

    const cards = await listCards(db, OWNER);
    expect(cards.map((c) => [c.card, c.created_ledger, c.tracked_by, c.label])).toEqual([
      [CBI3, 5883567, "factory", null],
      [CAXB, 5883572, "factory", "cli card 2 renamed"],
    ]);
    expect(cards[0].created_tx).toBe("ca2a7f2d27c256027258cecd46cea644c75da890c6847435365202be04a7ba95");
  });

  it("is idempotent: re-applying writes nothing new", async () => {
    const before = await db.query<{ n: string }>("select (select count(*) from card_events)::text as n");
    await applyEvents(db, events, await knownCards(db), FACTORY);
    const after = await db.query<{ n: string }>("select (select count(*) from card_events)::text as n");
    expect(after[0].n).toBe(before[0].n);
    const pays = await db.query<{ n: string }>("select count(*)::text as n from payments");
    expect(pays[0].n).toBe("4");
  });

  it("reads a created card's on-chain label through readLabel; a failed read is retried by fillLabel later", async () => {
    const NEW = "CNEWCARDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const created: IndexedEvent = {
      ...events[0],
      eventId: "created-new",
      payload: { owner: OWNER, card: NEW },
    };
    const reads: string[] = [];
    const flaky = async (card: string) => {
      reads.push(card);
      if (reads.length === 1) throw new Error("rpc down");
      return "inference-agent";
    };
    const known = await knownCards(db);
    expect(await applyEvents(db, [created], known, FACTORY, { readLabel: flaky })).toBe(1);
    expect(known.has(NEW)).toBe(true);
    expect(reads).toEqual([NEW]);
    let row = await db.query<{ label: string | null }>("select label from cards where card = $1", [NEW]);
    expect(row[0].label).toBeNull();

    expect(await fillLabel(db, NEW, flaky)).toBe(true);
    row = await db.query<{ label: string | null }>("select label from cards where card = $1", [NEW]);
    expect(row[0].label).toBe("inference-agent");
    // never overwrites a label that is already known (label_changed or an earlier read)
    expect(await fillLabel(db, NEW, async () => "other")).toBe(false);
    expect(await fillLabel(db, NEW, async () => null)).toBe(false);
  });

  it("ignores events from cards it does not know and card_created from other factories", async () => {
    const known = await knownCards(db);
    const foreign: IndexedEvent[] = [
      { ...events[0], eventId: "x1", contract: "COTHERFACTORY" },
      { ...events[3], eventId: "x2", contract: "CSOMEONEELSE" },
      { ...events[2], eventId: "x3", payload: { from: "GA", to: "GB", amount: "1" } },
    ];
    expect(await applyEvents(db, foreign, known, FACTORY)).toBe(0);
  });

  it("activity is newest first, hides the withdraw's own transfer leg, pages by cursor", async () => {
    const page1 = await listActivity(db, CAXB, { limit: 4 });
    expect(page1.items.map((i) => i.kind)).toEqual(["withdrawn", "funded", "signer_changed", "policy_changed"]);
    expect(page1.items[0].payload).toEqual({ to: OWNER, amount: "500000" });
    expect(page1.items[1]).toMatchObject({ amount: "1000000", counterparty: MERCHANT });
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listActivity(db, CAXB, { limit: 10, cursor: page1.nextCursor });
    expect(page2.items.map((i) => i.kind)).toEqual([
      "state_changed",
      "state_changed",
      "label_changed",
      "merchant_removed",
      "merchant_added",
      "created",
    ]);
    expect(page2.nextCursor).toBeNull();

    const cbi3 = await listActivity(db, CBI3);
    expect(cbi3.items.map((i) => [i.kind, i.amount])).toEqual([
      ["payment", "10000"],
      ["merchant_added", null],
      ["funded", "10000000"],
      ["created", null],
    ]);
    expect(cbi3.items[0].txHash).toBe("e343161a4264c407bf1556d32080b54195fe4eb978c55478f9ca18b5da0f3be0");
  });

  it("merchants fold add → remove and join labels", async () => {
    expect(await listMerchants(db, CAXB)).toEqual([
      expect.objectContaining({ payTo: MERCHANT, removedAt: expect.any(String), name: null }),
    ]);
    await upsertLabel(db, { card: CBI3, payTo: "GBSVTVRQ4AEFRNGH2MIOOWZSAVLZKOKNKI4UAGSMBZSNRP4I3FL3ELYP", name: "demo.rail402.dev", url: "https://demo.rail402.dev/weather" });
    await upsertLabel(db, { card: CBI3, payTo: "GBSVTVRQ4AEFRNGH2MIOOWZSAVLZKOKNKI4UAGSMBZSNRP4I3FL3ELYP", name: "demo.rail402.dev", url: "https://demo.rail402.dev/translate" });
    const m = await listMerchants(db, CBI3);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ removedAt: null, name: "demo.rail402.dev", url: "https://demo.rail402.dev/translate" });
    expect(m[0].addedTx).toBe("4e246e69" + m[0].addedTx!.slice(8));
  });

  it("insertCard keeps existing creation data and accepts manual cards", async () => {
    await insertCard(db, { card: "CMANUAL", owner: OWNER, trackedBy: "manual" });
    await insertCard(db, { card: CBI3, owner: OWNER, createdLedger: 1, createdTx: "zzz" });
    const cards = await listCards(db, OWNER);
    expect(cards.find((c) => c.card === CBI3)?.created_ledger).toBe(5883567);
    expect(cards.find((c) => c.card === "CMANUAL")).toMatchObject({ tracked_by: "manual", created_ledger: null });
  });

  it("setTxHashes fills stellar.expert rows (events and payment legs) only where empty", async () => {
    await db.query(
      "insert into card_events (event_id, card, kind, ledger, ts, payload) values ('se:1-0000', $1, 'label_changed', 9, now(), '{}')",
      [CBI3],
    );
    await db.query(
      "insert into payments (event_id, card, direction, counterparty, amount, ledger, ts) values ('se:2-0000:out', $1, 'out', 'G', 1, 9, now())",
      [CBI3],
    );
    await setTxHashes(db, [
      { eventId: "se:1-0000", txHash: "aa" },
      { eventId: "se:2-0000", txHash: "bb" },
    ]);
    const e = await db.query<{ tx_hash: string }>("select tx_hash from card_events where event_id = 'se:1-0000'");
    const p = await db.query<{ tx_hash: string }>("select tx_hash from payments where event_id = 'se:2-0000:out'");
    expect([e[0].tx_hash, p[0].tx_hash]).toEqual(["aa", "bb"]);
  });

  it("state: cursor, tick, and a lock that a second caller cannot take until it goes stale", async () => {
    expect((await getState(db)).cursor).toBeNull();
    await setCursor(db, { cursor: "c1", lastLedger: 10 });
    await markTick(db);
    const s = await getState(db);
    expect(s).toMatchObject({ cursor: "c1", last_ledger: 10 });
    expect(s.last_tick).not.toBeNull();

    expect(await tryLock(db, 60_000)).toBe(true);
    expect(await tryLock(db, 60_000)).toBe(false);
    expect(await tryLock(db, 0)).toBe(true); // stale immediately → stolen
    await unlock(db);
    expect(await tryLock(db, 60_000)).toBe(true);
    await unlock(db);
  });

  it("cursor codec round-trips and rejects junk", () => {
    expect(decodeCursor(encodeCursor(42, "abc:def"))).toEqual({ ledger: 42, id: "abc:def" });
    expect(decodeCursor("nope")).toBeNull();
    expect(decodeCursor("x:1")).toBeNull();
    expect(decodeCursor(null)).toBeNull();
  });
});
