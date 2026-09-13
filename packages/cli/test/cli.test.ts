import { describe, expect, it, vi } from "vitest";
import { buildProgram } from "../src/index.js";

const CARD = "CAJPWJBFBM6WMYZBRURA7VW3GKSLMHTHIIZIRFVFKUSAPWX4526YAHCJ";

describe("mooring keygen", () => {
  it("prints a G and an S key, and the hex with --hex", async () => {
    const out: string[] = [];
    const program = buildProgram({ stdout: (s: string) => out.push(s) } as never);
    await program.parseAsync(["node", "mooring", "keygen", "--hex"]);
    const text = out.join("\n");
    expect(text).toMatch(/G[A-Z2-7]{55}/);
    expect(text).toMatch(/S[A-Z2-7]{55}/);
    expect(text).toMatch(/[0-9a-f]{64}/);
  });
});

describe("mooring status", () => {
  it("prints info and merchants as JSON with --json", async () => {
    const out: string[] = [];
    const info = { state: 0, remaining: 10n, balance: 20n, allow_count: 1, policy: { max_per_tx: 5n }, label: "inference-agent" };
    const program = buildProgram({
      stdout: (s: string) => out.push(s),
      readCardInfo: vi.fn(async () => info),
      readMerchants: vi.fn(async () => ["GMERCHANT"]),
    } as never);
    await program.parseAsync(["node", "mooring", "status", "--card", CARD, "--json"]);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.merchants).toEqual(["GMERCHANT"]);
    expect(parsed.info.remaining).toBe("10");
    expect(parsed.info.label).toBe("inference-agent");
  });

  it("prints the label as the first line in text mode", async () => {
    const out: string[] = [];
    const info = { state: 0, remaining: 10n, balance: 20n, allow_count: 1, policy: { max_per_tx: 5n }, label: "inference-agent" };
    const program = buildProgram({
      stdout: (s: string) => out.push(s),
      readCardInfo: vi.fn(async () => info),
      readMerchants: vi.fn(async () => ["GMERCHANT"]),
    } as never);
    await program.parseAsync(["node", "mooring", "status", "--card", CARD]);
    expect(out[0]).toBe("Label: inference-agent");
  });
});

describe("mooring pay", () => {
  it("prints the settlement on success and exits 2 on denial", async () => {
    const out: string[] = [];
    const fetchOk = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "PAYMENT-RESPONSE": Buffer.from(JSON.stringify({ success: true, transaction: "cafe", network: "stellar:testnet" })).toString("base64") } }));
    // A syntactically valid (but freshly generated, unfunded) Stellar secret.
    // The fake fetch above never signs anything with it.
    process.env.AGENT_SECRET = "SDCXRZMPIMR74JONSVNG7MQJS7SLQX2KTNKO5EIZHZLUFQYQ3JTT26SC";
    const program = buildProgram({ stdout: (s: string) => out.push(s), createMooringFetch: () => fetchOk, getSettlement: () => ({ success: true, transaction: "cafe", network: "stellar:testnet" }) } as never);
    await program.parseAsync(["node", "mooring", "pay", "http://x/weather", "--card", CARD]);
    expect(out.join("\n")).toContain("cafe");
  });

  it("prints a clean error and exits 1 on a malformed agent secret, without a stack trace", async () => {
    const out: string[] = [];
    process.env.AGENT_SECRET = "not-a-valid-secret";
    const originalExitCode = process.exitCode;
    const program = buildProgram({ stdout: (s: string) => out.push(s) } as never);
    await program.parseAsync(["node", "mooring", "pay", "http://x/weather", "--card", CARD]);
    expect(out.join("\n")).toBe("Invalid agent secret in $AGENT_SECRET");
    expect(process.exitCode).toBe(1);
    process.exitCode = originalExitCode;
  });

  it("rejects an unknown --network value", async () => {
    process.env.AGENT_SECRET = "SDCXRZMPIMR74JONSVNG7MQJS7SLQX2KTNKO5EIZHZLUFQYQ3JTT26SC";
    const program = buildProgram({ stdout: () => {} } as never);
    program.exitOverride();
    await expect(
      program.parseAsync(["node", "mooring", "pay", "http://x/weather", "--card", CARD, "--network", "stellar:bogus"]),
    ).rejects.toThrow();
  });
});
