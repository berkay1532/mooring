import { describe, expect, it } from "vitest";
import { GuardDenied } from "../src/denial.js";
import { MemoryGuard } from "../src/guard/memory.js";
import { guardCapsFromEnv, parseGuardConfig } from "../src/guard/config.js";
import type { GuardTerms } from "../src/guard/types.js";

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

describe("MemoryGuard", () => {
  it("refuses above max_per_tx, then daily_cap, then total_cap, in that order", async () => {
    const g = new MemoryGuard({ maxPerTx: "5000", dailyCap: "10000", totalCap: "15000" });

    // Over every cap: max_per_tx wins.
    const perTx = await g.check(terms("20000"));
    expect(perTx).toBeInstanceOf(GuardDenied);
    expect(perTx!.reason).toBe("max_per_tx");
    expect(perTx!.attempted).toBe("0.002");
    expect(perTx!.limit).toBe("0.0005");

    // Two payments fill the daily cap.
    for (let i = 0; i < 2; i++) await g.commit(await g.reserve(terms("5000")), "settled");
    const daily = await g.check(terms("1"));
    expect(daily!.reason).toBe("daily_cap");
    await expect(g.reserve(terms("1"))).rejects.toMatchObject({ name: "GuardDenied", reason: "daily_cap" });

    // A new day frees the daily cap; the total cap is next.
    const g2 = new MemoryGuard({ dailyCap: "10000", totalCap: "15000" }, clock("2026-11-28T10:00:00Z", "2026-11-29T10:00:00Z"));
    await g2.commit(await g2.reserve(terms("10000")), "settled");
    advance();
    await g2.commit(await g2.reserve(terms("5000")), "settled");
    const total = await g2.check(terms("1"));
    expect(total!.reason).toBe("total_cap");
    expect(total!.limit).toBe("0.0015");
  });

  it("check() does not reserve", async () => {
    const g = new MemoryGuard({ dailyCap: "10000" });
    expect(await g.check(terms("10000"))).toBeNull();
    expect(await g.check(terms("10000"))).toBeNull();
    expect((await g.snapshot(CARD)).reserved).toBe("0");
  });

  it("reservations keep concurrent payments under the cap", async () => {
    const g = new MemoryGuard({ dailyCap: "10000" });
    const [a, b] = await Promise.allSettled([g.reserve(terms("10000")), g.reserve(terms("10000"))]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
    await g.commit((a.status === "fulfilled" ? a : b as any).value, "failed");
    await expect(g.reserve(terms("10000"))).resolves.toBeTruthy();
  });

  it("a settled commit counts toward daily and total; denied and failed release", async () => {
    const g = new MemoryGuard({ dailyCap: "100000" });
    const r1 = await g.reserve(terms("1000"));
    const r2 = await g.reserve(terms("2000"));
    const r3 = await g.reserve(terms("3000"));
    expect((await g.snapshot(CARD)).reserved).toBe("6000");
    await g.commit(r1, "settled");
    await g.commit(r2, "denied");
    await g.commit(r3, "failed");
    // Committing twice is a no-op.
    await g.commit(r1, "settled");
    const s = await g.snapshot(CARD);
    expect(s).toMatchObject({ daily: "1000", total: "1000", reserved: "0", stopped: false });
    expect(s.caps).toEqual({ dailyCap: "100000" });
  });

  it("stop refuses everything until resume; a card-scoped stop refuses only that card", async () => {
    const g = new MemoryGuard();
    await g.stop("runaway loop");
    expect(await g.isStopped(CARD)).toBe(true);
    expect(await g.isStopped(OTHER)).toBe(true);
    const denied = await g.check(terms("1"));
    expect(denied!.reason).toBe("stopped");
    expect(denied!.detail).toBe("runaway loop");
    await expect(g.reserve(terms("1", OTHER))).rejects.toMatchObject({ reason: "stopped" });
    await g.resume();
    expect(await g.isStopped(CARD)).toBe(false);
    expect(await g.check(terms("1"))).toBeNull();

    await g.stop(undefined, CARD);
    expect(await g.isStopped(CARD)).toBe(true);
    expect(await g.isStopped(OTHER)).toBe(false);
    expect((await g.check(terms("1")))!.reason).toBe("stopped");
    expect(await g.check(terms("1", OTHER))).toBeNull();
    expect((await g.snapshot(CARD)).stopped).toBe(true);
    await g.resume(CARD);
    expect(await g.isStopped(CARD)).toBe(false);
  });

  it("stopped is checked before the caps", async () => {
    const g = new MemoryGuard({ maxPerTx: "1" });
    await g.stop();
    expect((await g.check(terms("100")))!.reason).toBe("stopped");
  });

  it("daily resets on a new UTC day, total carries over", async () => {
    const now = clock("2026-11-28T23:59:00Z", "2026-11-29T00:01:00Z");
    const g = new MemoryGuard({ dailyCap: "10000", totalCap: "100000" }, now);
    await g.commit(await g.reserve(terms("10000")), "settled");
    expect((await g.check(terms("1")))!.reason).toBe("daily_cap");
    expect((await g.snapshot(CARD)).day).toBe("2026-11-28");
    advance();
    const s = await g.snapshot(CARD);
    expect(s).toMatchObject({ day: "2026-11-29", daily: "0", total: "10000" });
    expect(await g.check(terms("10000"))).toBeNull();
  });

  it("reservations count toward both caps across a day change", async () => {
    const now = clock("2026-11-28T23:59:00Z", "2026-11-29T00:01:00Z");
    const g = new MemoryGuard({ dailyCap: "10000", totalCap: "15000" }, now);
    const held = await g.reserve(terms("10000"));
    advance();
    expect((await g.snapshot(CARD)).reserved).toBe("10000");
    expect((await g.check(terms("1")))!.reason).toBe("daily_cap");
    await g.commit(held, "settled");
    expect((await g.snapshot(CARD)).daily).toBe("10000");
    expect((await g.check(terms("5001")))!.reason).toBe("daily_cap");
  });

  it("a settled commit counts after 10 minutes and for an unknown reservation", async () => {
    const now = clock("2026-11-28T10:00:00Z", "2026-11-28T10:11:00Z");
    const g = new MemoryGuard({ dailyCap: "100000" }, now);
    const r = await g.reserve(terms("7000"));
    advance();
    await g.commit(r, "settled");
    expect(await g.snapshot(CARD)).toMatchObject({ daily: "7000", total: "7000", reserved: "0" });
    await g.commit({ id: "e".repeat(32), card: CARD, amount: "1000" }, "settled");
    expect((await g.snapshot(CARD)).total).toBe("8000");
    // failed / denied for a missing record stay no-ops.
    await g.commit({ id: "d".repeat(32), card: CARD, amount: "5000" }, "denied");
    expect((await g.snapshot(CARD)).total).toBe("8000");
  });

  it("a second settled commit of the same reservation does not double count", async () => {
    const g = new MemoryGuard();
    const r = await g.reserve(terms("3000"));
    await g.commit(r, "settled");
    await g.commit(r, "settled");
    expect(await g.snapshot(CARD)).toMatchObject({ daily: "3000", total: "3000", reserved: "0" });
  });

  it("state is per card", async () => {
    const g = new MemoryGuard({ dailyCap: "10000" });
    await g.commit(await g.reserve(terms("10000")), "settled");
    expect((await g.check(terms("1")))!.reason).toBe("daily_cap");
    expect(await g.check(terms("10000", OTHER))).toBeNull();
  });
});

describe("guard config", () => {
  it("parseGuardConfig converts decimal USDC and rejects more than 7 decimals", () => {
    expect(parseGuardConfig({ dailyCap: "1" })).toEqual({ dailyCap: "10000000" });
    expect(() => parseGuardConfig({ maxPerTx: "0.00000001" })).toThrow(RangeError);
  });

  it("parseGuardConfig handles fractions and rejects non-numeric values", () => {
    expect(parseGuardConfig({ dailyCap: "2.5", totalCap: "0.0000001", maxPerTx: "0" })).toEqual({
      dailyCap: "25000000",
      totalCap: "1",
      maxPerTx: "0",
    });
    expect(parseGuardConfig({})).toEqual({});
    for (const bad of ["abc", "-1", "1e3", "1.", ".5", ""]) {
      expect(() => parseGuardConfig({ totalCap: bad })).toThrow(RangeError);
    }
  });

  it("guardCapsFromEnv reads the three variables and leaves unset ones absent", () => {
    expect(
      guardCapsFromEnv({ MOORING_DAILY_CAP: "5", MOORING_TOTAL_CAP: "", MOORING_MAX_PER_TX: "0.1" }),
    ).toEqual({ dailyCap: "5", maxPerTx: "0.1" });
    expect(guardCapsFromEnv({})).toEqual({});
  });
});

// A test clock: returns the first instant until advance() is called, then the next.
let instants: Date[] = [];
function clock(...isos: string[]): () => Date {
  instants = isos.map((s) => new Date(s));
  return () => instants[0]!;
}
function advance(): void {
  instants.shift();
}
