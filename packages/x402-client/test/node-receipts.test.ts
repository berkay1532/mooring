import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signReceipt, verifyReceipt, type Receipt } from "../src/receipts.js";
import { appendReceipt, exportReceipts, readReceipts } from "../src/node/index.js";

const CARD = "CAJPWJBFBM6WMYZBRURA7VW3GKSLMHTHIIZIRFVFKUSAPWX4526YAHCJ";
const OTHER = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const agent = Keypair.random();

function receipt(over: Partial<Receipt> = {}): Receipt {
  const { sig: _s, ...rest } = {
    v: 1 as const,
    id: "a".repeat(32),
    ts: "2026-11-28T10:00:00.000Z",
    protocol: "x402" as const,
    card: CARD,
    agent: agent.publicKey(),
    payTo: "GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG",
    amount: "10000",
    asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    network: "stellar:testnet",
    url: "https://api.test/weather",
    status: "settled" as const,
    txHash: "f".repeat(64),
    sig: "",
    ...over,
  };
  return signReceipt(rest, agent);
}

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "mooring-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("receipt ledger", () => {
  it("appends one JSON line per receipt, creating the directory", async () => {
    const nested = path.join(dir, "deep", "home");
    const r1 = receipt({ id: "1".repeat(32) });
    const r2 = receipt({ id: "2".repeat(32), status: "denied", txHash: undefined, reason: "daily_cap" });
    appendReceipt(nested, r1);
    appendReceipt(nested, r2);
    const lines = (await fs.readFile(path.join(nested, "receipts.jsonl"), "utf8")).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("");
    const back = readReceipts(nested);
    expect(back).toEqual([r1, r2]);
    expect(back.every(verifyReceipt)).toBe(true);
  });

  it("readReceipts returns [] without a ledger, filters by since and card, skips blank lines", async () => {
    expect(readReceipts(dir)).toEqual([]);
    const early = receipt({ id: "1".repeat(32), ts: "2026-11-27T10:00:00.000Z" });
    const late = receipt({ id: "2".repeat(32), ts: "2026-11-28T10:00:00.000Z" });
    const other = receipt({ id: "3".repeat(32), card: OTHER });
    appendReceipt(dir, early);
    await fs.appendFile(path.join(dir, "receipts.jsonl"), "\n  \n");
    appendReceipt(dir, late);
    appendReceipt(dir, other);
    expect(readReceipts(dir).map((r) => r.id)).toEqual([early.id, late.id, other.id]);
    expect(readReceipts(dir, { since: "2026-11-28T00:00:00Z" }).map((r) => r.id)).toEqual([late.id, other.id]);
    expect(readReceipts(dir, { card: OTHER }).map((r) => r.id)).toEqual([other.id]);
  });

  it("a malformed line throws with its line number", async () => {
    appendReceipt(dir, receipt());
    await fs.appendFile(path.join(dir, "receipts.jsonl"), "{broken\n");
    expect(() => readReceipts(dir)).toThrow(/receipts\.jsonl:2/);
  });

  it("exportReceipts csv has the fixed header and quotes commas", () => {
    appendReceipt(dir, receipt({ id: "1".repeat(32), url: "https://api.test/q?a=1,2" }));
    appendReceipt(
      dir,
      receipt({ id: "2".repeat(32), status: "failed", txHash: undefined, url: undefined, reason: 'said "no"\nthen left' }),
    );
    const csv = exportReceipts(dir, { format: "csv" });
    const [header, ...rows] = csv.split("\r\n");
    expect(header).toBe("id,ts,protocol,card,agent,payTo,amount,asset,network,url,status,txHash,reason,sig");
    expect(rows[0]).toContain(',"https://api.test/q?a=1,2",settled,');
    expect(rows[0]!.split(",")[0]).toBe("1".repeat(32));
    // Absent fields are empty; quotes are doubled and newlines kept inside quotes.
    expect(csv).toContain(`,stellar:testnet,,failed,,"said ""no""\nthen left",`);
  });

  it("exportReceipts json is a pretty-printed array and honours filters", () => {
    const a = receipt({ id: "1".repeat(32) });
    const b = receipt({ id: "2".repeat(32), card: OTHER });
    appendReceipt(dir, a);
    appendReceipt(dir, b);
    const json = exportReceipts(dir, { format: "json", card: OTHER });
    expect(json).toBe(JSON.stringify([b], null, 2));
    expect(exportReceipts(dir, { format: "csv", card: "C_NONE" })).toBe(
      "id,ts,protocol,card,agent,payTo,amount,asset,network,url,status,txHash,reason,sig\r\n",
    );
  });
});
