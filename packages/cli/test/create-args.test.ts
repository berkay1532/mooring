import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { buildPolicy, parseExpiry, parsePeriod, parseSigner, parseUsdc } from "../src/create-args.js";

const NOW = new Date("2026-11-23T12:00:00Z");

describe("create argument parsing", () => {
  it("parseUsdc", () => {
    expect(parseUsdc("1")).toBe(10_000_000n);
    expect(parseUsdc("0.25")).toBe(2_500_000n);
    expect(parseUsdc("0.0000001")).toBe(1n);
    for (const bad of ["0", "1.00000001", "abc", "-1", ""]) expect(() => parseUsdc(bad)).toThrow();
  });
  it("parsePeriod", () => {
    expect(parsePeriod("1d")).toBe(86_400n);
    expect(parsePeriod("12h")).toBe(43_200n);
    expect(parsePeriod("30m")).toBe(1_800n);
    expect(parsePeriod("3600")).toBe(3_600n);
    for (const bad of ["0", "1w", "day", ""]) expect(() => parsePeriod(bad)).toThrow();
  });
  it("parseExpiry", () => {
    expect(parseExpiry("+30d", NOW)).toBe(BigInt(Math.floor(NOW.getTime() / 1000) + 30 * 86_400));
    expect(parseExpiry("+12h", NOW)).toBe(BigInt(Math.floor(NOW.getTime() / 1000) + 12 * 3_600));
    expect(parseExpiry("2026-12-31T00:00:00Z", NOW)).toBe(BigInt(Date.parse("2026-12-31T00:00:00Z") / 1000));
    expect(() => parseExpiry("2020-01-01", NOW)).toThrow(/future/);
    expect(() => parseExpiry("soon", NOW)).toThrow();
  });
  it("parseSigner accepts hex or G…", () => {
    const kp = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4));
    expect([...parseSigner(kp.publicKey())]).toEqual([...kp.rawPublicKey()]);
    expect([...parseSigner(Buffer.from(kp.rawPublicKey()).toString("hex"))]).toEqual([...kp.rawPublicKey()]);
    expect(() => parseSigner("nope")).toThrow(/signer/);
  });
  it("buildPolicy defaults max-per-tx to the budget and expiry to +30d, and checks the cap", () => {
    const kp = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4));
    const { policy, label } = buildPolicy({ label: "ops", budget: "5", period: "1d", signer: kp.publicKey() }, NOW);
    expect(policy).toEqual({ period_amount: 50_000_000n, max_per_tx: 50_000_000n, period_duration: 86_400n, expiry: BigInt(Math.floor(NOW.getTime() / 1000) + 30 * 86_400) });
    expect(label).toBe("ops");
    expect(() => buildPolicy({ label: "ops", budget: "5", maxPerTx: "6", period: "1d", signer: kp.publicKey() }, NOW)).toThrow(/max-per-tx/);
    expect(() => buildPolicy({ label: "x".repeat(33), budget: "5", period: "1d", signer: kp.publicKey() }, NOW)).toThrow(/label/);
  });
});
