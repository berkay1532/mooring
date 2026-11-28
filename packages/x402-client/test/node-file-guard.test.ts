import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GuardDenied } from "../src/denial.js";
import type { Guard, GuardTerms } from "../src/guard/types.js";
import { defaultStateDir, fileGuard, loadGuardConfig } from "../src/node/index.js";
import { withLock } from "../src/node/lock.js";

const CARD = "CAJPWJBFBM6WMYZBRURA7VW3GKSLMHTHIIZIRFVFKUSAPWX4526YAHCJ";
const OTHER = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

const terms = (amount: string, card = CARD): GuardTerms => ({
  card,
  payTo: "GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG",
  amount,
  asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  network: "stellar:testnet",
  url: "https://api.test/weather",
});

let dir: string;
let g: Guard;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "mooring-"));
  g = fileGuard({ stateDir: dir });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("fileGuard", () => {
  it("persists counters across guard instances and processes (two instances, one dir)", async () => {
    const a = fileGuard({ stateDir: dir, caps: { dailyCap: "10000" } });
    const b = fileGuard({ stateDir: dir, caps: { dailyCap: "10000" } });
    await a.commit(await a.reserve(terms("6000")), "settled");
    expect(await b.snapshot(CARD)).toMatchObject({ daily: "6000", total: "6000", reserved: "0" });
    const denied = await b.check(terms("5000"));
    expect(denied).toBeInstanceOf(GuardDenied);
    expect(denied!.reason).toBe("daily_cap");

    // A reservation held by one instance counts for the other.
    const held = await b.reserve(terms("4000"));
    expect((await a.snapshot(CARD)).reserved).toBe("4000");
    expect((await a.check(terms("1")))!.reason).toBe("daily_cap");
    await a.commit(held, "failed");
    expect(await a.check(terms("4000"))).toBeNull();

    const raw = JSON.parse(await fs.readFile(path.join(dir, "spend.json"), "utf8"));
    expect(raw).toMatchObject({ v: 1, cards: { [CARD]: { daily: "6000", total: "6000", reservations: {} } } });
  });

  it("two instances reserving at once cannot both pass a cap (lock)", async () => {
    const a = fileGuard({ stateDir: dir, caps: { dailyCap: "10000" } });
    const b = fileGuard({ stateDir: dir, caps: { dailyCap: "10000" } });
    const results = await Promise.allSettled([
      a.reserve(terms("10000")),
      b.reserve(terms("10000")),
      a.reserve(terms("10000")),
      b.reserve(terms("10000")),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) {
      if (r.status === "rejected") expect(r.reason).toMatchObject({ name: "GuardDenied", reason: "daily_cap" });
    }
  });

  it("decides in the MemoryGuard order: stopped, max_per_tx, daily_cap, total_cap", async () => {
    const f = fileGuard({ stateDir: dir, caps: { maxPerTx: "5000", dailyCap: "10000", totalCap: "15000" } });
    expect((await f.check(terms("20000")))!.reason).toBe("max_per_tx");
    for (let i = 0; i < 2; i++) await f.commit(await f.reserve(terms("5000")), "settled");
    expect((await f.check(terms("1")))!.reason).toBe("daily_cap");
    await f.stop("halt");
    const stopped = await f.check(terms("20000"));
    expect(stopped!.reason).toBe("stopped");
    expect(stopped!.detail).toBe("halt");
  });

  it("a malformed stop file still means stopped", async () => {
    await fs.writeFile(path.join(dir, "stop"), "{not json");
    expect(await g.isStopped(CARD)).toBe(true);
    expect(await g.isStopped(OTHER)).toBe(true);
    expect((await g.check(terms("1")))!.reason).toBe("stopped");
    // resume() lifts it.
    await g.resume();
    expect(await g.isStopped(CARD)).toBe(false);
  });

  it("global and card-scoped stops share the stop file", async () => {
    await g.stop("runaway", CARD);
    expect(await g.isStopped(CARD)).toBe(true);
    expect(await g.isStopped(OTHER)).toBe(false);
    expect(JSON.parse(await fs.readFile(path.join(dir, "stop"), "utf8"))).toMatchObject({
      reason: "runaway",
      cards: [CARD],
    });

    // A global stop on top keeps the card stop; resume() lifts only the global one.
    await g.stop("all");
    expect(await g.isStopped(OTHER)).toBe(true);
    await g.resume();
    expect(await g.isStopped(OTHER)).toBe(false);
    expect(await g.isStopped(CARD)).toBe(true);

    // Removing the last card deletes the file.
    await g.resume(CARD);
    expect(await g.isStopped(CARD)).toBe(false);
    await expect(fs.access(path.join(dir, "stop"))).rejects.toMatchObject({ code: "ENOENT" });

    // A plain global stop file (no cards) stops everything.
    await g.stop();
    expect(JSON.parse(await fs.readFile(path.join(dir, "stop"), "utf8")).cards).toBeUndefined();
    expect((await g.snapshot(OTHER)).stopped).toBe(true);
    await g.resume();
    await expect(fs.access(path.join(dir, "stop"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("drops reservations older than 10 minutes", async () => {
    let now = new Date("2026-11-28T10:00:00Z");
    const f = fileGuard({ stateDir: dir, caps: { dailyCap: "10000" }, now: () => now });
    await f.reserve(terms("10000"));
    expect((await f.check(terms("1")))!.reason).toBe("daily_cap");
    now = new Date("2026-11-28T10:09:59Z");
    expect((await f.snapshot(CARD)).reserved).toBe("10000");
    now = new Date("2026-11-28T10:10:01Z");
    expect((await f.snapshot(CARD)).reserved).toBe("0");
    expect(await f.check(terms("10000"))).toBeNull();
  });

  it("an earlier UTC day resets daily and keeps total", async () => {
    let now = new Date("2026-11-28T23:59:00Z");
    const f = fileGuard({ stateDir: dir, caps: { dailyCap: "10000", totalCap: "100000" }, now: () => now });
    await f.commit(await f.reserve(terms("10000")), "settled");
    expect((await f.check(terms("1")))!.reason).toBe("daily_cap");
    now = new Date("2026-11-29T00:01:00Z");
    expect(await f.snapshot(CARD)).toMatchObject({ day: "2026-11-29", daily: "0", total: "10000" });
    await f.commit(await f.reserve(terms("10000")), "settled");
    const raw = JSON.parse(await fs.readFile(path.join(dir, "spend.json"), "utf8"));
    expect(raw.cards[CARD]).toMatchObject({ day: "2026-11-29", daily: "10000", total: "20000" });
  });
});

describe("withLock", () => {
  it("runs critical sections one at a time", async () => {
    const counter = path.join(dir, "n");
    await fs.writeFile(counter, "0");
    let inside = 0;
    let maxInside = 0;
    await Promise.all(
      Array.from({ length: 5 }, () =>
        withLock(dir, async () => {
          inside++;
          maxInside = Math.max(maxInside, inside);
          const n = Number(await fs.readFile(counter, "utf8"));
          await new Promise((r) => setTimeout(r, 5));
          await fs.writeFile(counter, String(n + 1));
          inside--;
        }),
      ),
    );
    expect(maxInside).toBe(1);
    expect(await fs.readFile(counter, "utf8")).toBe("5");
    await expect(fs.access(path.join(dir, "spend.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("replaces a lock older than 30 s and removes it afterwards, even on throw", async () => {
    const lock = path.join(dir, "spend.lock");
    await fs.writeFile(lock, "");
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(lock, old, old);
    await expect(withLock(dir, async () => 42)).resolves.toBe(42);
    await expect(fs.access(lock)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(withLock(dir, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(fs.access(lock)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("gives up on a fresh lock after 2 s", async () => {
    await fs.writeFile(path.join(dir, "spend.lock"), "");
    const started = Date.now();
    await expect(withLock(dir, async () => 1)).rejects.toThrow(/spend\.lock/);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
  });
});

describe("state dir and config", () => {
  it("defaultStateDir honours MOORING_HOME", () => {
    expect(defaultStateDir({ MOORING_HOME: "/x/y" })).toBe("/x/y");
    expect(defaultStateDir({})).toBe(path.join(os.homedir(), ".mooring"));
  });

  it("loadGuardConfig prefers mooring.guard.json over env", async () => {
    const env = { MOORING_DAILY_CAP: "5", MOORING_MAX_PER_TX: "0.1" };
    expect(loadGuardConfig(dir, env)).toEqual({ dailyCap: "5", maxPerTx: "0.1" });
    await fs.writeFile(path.join(dir, "mooring.guard.json"), JSON.stringify({ dailyCap: "2", totalCap: "50" }));
    expect(loadGuardConfig(dir, env)).toEqual({ dailyCap: "2", totalCap: "50", maxPerTx: "0.1" });
  });

  it("loadGuardConfig throws with the path on a malformed file", async () => {
    const file = path.join(dir, "mooring.guard.json");
    for (const bad of ["{oops", "[]", JSON.stringify({ dailyCap: 5 }), JSON.stringify({ dailyCap: "abc" }), JSON.stringify({ dailycap: "1" })]) {
      await fs.writeFile(file, bad);
      expect(() => loadGuardConfig(dir, {})).toThrow(file);
    }
  });
});
