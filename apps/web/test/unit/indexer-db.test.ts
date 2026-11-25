// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hasDatabase, splitStatements } from "../../lib/indexer/db";
import { testDb } from "../helpers/pglite";

describe("indexer/db", () => {
  let db: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => {
    db = await testDb();
  });
  afterAll(async () => {
    await db.close();
  });

  it("applies the schema twice without error (idempotent migration)", async () => {
    await expect(db.applySchema()).resolves.toBeUndefined();
    const rows = await db.query<{ n: string }>("select count(*)::text as n from indexer_state");
    expect(rows[0].n).toBe("1");
  });

  it("keeps a single indexer_state row", async () => {
    await expect(db.query("insert into indexer_state (id) values (2)")).rejects.toThrow();
  });

  it("rejects an event for a card it does not know", async () => {
    await expect(
      db.query(
        "insert into card_events (event_id, card, kind, ledger, ts) values ($1, $2, $3, $4, now())",
        ["e1", "CUNKNOWN", "merchant_added", 1],
      ),
    ).rejects.toThrow();
  });

  it("stores amounts as exact numeric and returns them as strings", async () => {
    await db.query("insert into cards (card, owner) values ($1, $2) on conflict do nothing", ["C1", "G1"]);
    await db.query(
      "insert into payments (event_id, card, direction, counterparty, amount, ledger, ts) values ($1,$2,$3,$4,$5,$6,now())",
      ["p1", "C1", "out", "G2", "123456789012345678901234567890", 5],
    );
    const rows = await db.query<{ amount: string }>("select amount::text as amount from payments where event_id = $1", ["p1"]);
    expect(rows[0].amount).toBe("123456789012345678901234567890");
  });

  it("splitStatements drops comments and empty fragments", () => {
    expect(splitStatements("-- c\nCREATE TABLE a (x int);\n\n-- d\nINSERT INTO a VALUES (1);\n")).toEqual([
      "CREATE TABLE a (x int)",
      "INSERT INTO a VALUES (1)",
    ]);
  });

  it("hasDatabase reflects DATABASE_URL and the kill switch", () => {
    const prev = { url: process.env.DATABASE_URL, off: process.env.MOORING_INDEXER_DISABLED };
    delete process.env.DATABASE_URL;
    expect(hasDatabase()).toBe(false);
    process.env.DATABASE_URL = "postgres://x";
    expect(hasDatabase()).toBe(true);
    process.env.MOORING_INDEXER_DISABLED = "1";
    expect(hasDatabase()).toBe(false);
    if (prev.url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prev.url;
    if (prev.off === undefined) delete process.env.MOORING_INDEXER_DISABLED; else process.env.MOORING_INDEXER_DISABLED = prev.off;
  });
});
