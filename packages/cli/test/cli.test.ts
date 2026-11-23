import { describe, expect, it, vi } from "vitest";
import { CardPolicyDenied } from "@mooring-live/x402-client";
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

  it.each([
    [{ payTo: "GX", url: "https://api.test/weather" }, true],
    [{ payTo: "GX" }, false],
  ])("prints the allow link on a denial when the merchant has a url (%j)", async (merchant, hasLink) => {
    const out: string[] = [];
    process.env.AGENT_SECRET = "SDCXRZMPIMR74JONSVNG7MQJS7SLQX2KTNKO5EIZHZLUFQYQ3JTT26SC";
    process.exitCode = undefined;
    const denied = new CardPolicyDenied("not_allowlisted", "precheck", { merchant });
    const program = buildProgram({
      stdout: (s: string) => out.push(s),
      createMooringFetch: () => async () => {
        throw denied;
      },
    } as never);
    await program.parseAsync(["node", "mooring", "pay", "http://x/weather", "--card", CARD]);
    expect(out[0]).toBe("Denied (not_allowlisted) at precheck");
    if (hasLink) {
      expect(out).toEqual([
        "Denied (not_allowlisted) at precheck",
        `Allow it: https://app.mooring.live/allow?card=${CARD}&url=${encodeURIComponent("https://api.test/weather")}`,
      ]);
    } else {
      expect(out).toEqual(["Denied (not_allowlisted) at precheck"]);
    }
    expect(process.exitCode).toBe(2);
    process.exitCode = undefined;
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

describe("mooring create", () => {
  const OWNER_SECRET = "SDCXRZMPIMR74JONSVNG7MQJS7SLQX2KTNKO5EIZHZLUFQYQ3JTT26SC";
  const AGENT = "GBSVTVRQ4AEFRNGH2MIOOWZSAVLZKOKNKI4UAGSMBZSNRP4I3FL3ELYP";
  const result = { card: CARD, saltIndex: 2, txHash: "cafe".repeat(16), owner: "GOWNER" };

  it("discovers the next salt, creates with the known testnet deployment and prints the card", async () => {
    const out: string[] = [];
    process.env.OWNER_SECRET = OWNER_SECRET;
    const nextCardIndex = vi.fn(async () => 2);
    const createCard = vi.fn(async () => result);
    const program = buildProgram({ stdout: (s: string) => out.push(s), nextCardIndex, createCard } as never);
    await program.parseAsync(["node", "mooring", "create", "--label", "ops", "--signer", AGENT, "--budget", "5", "--period", "1d", "--max-per-tx", "1"]);
    expect(nextCardIndex).toHaveBeenCalledTimes(1);
    const [params] = createCard.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(params.saltIndex).toBe(2);
    expect(params.factory).toBe("CBMSK4OSNLBEXTJWNEWX422RPVDEUNFEWADTSPECGBI26ESDYW65AUSE");
    expect(params.token).toBe("CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA");
    expect(params.label).toBe("ops");
    expect((params.policy as { period_amount: bigint }).period_amount).toBe(50_000_000n);
    expect((params.policy as { max_per_tx: bigint }).max_per_tx).toBe(10_000_000n);
    expect(out[0]).toBe(`Card: ${CARD}`);
    expect(out.join("\n")).toContain("Salt index: 2");
    expect(out.join("\n")).toContain(`Tx: ${"cafe".repeat(16)}`);
  });

  it("--salt skips discovery and --json prints the result", async () => {
    const out: string[] = [];
    process.env.OWNER_SECRET = OWNER_SECRET;
    const nextCardIndex = vi.fn(async () => 9);
    const createCard = vi.fn(async () => ({ ...result, saltIndex: 7 }));
    const program = buildProgram({ stdout: (s: string) => out.push(s), nextCardIndex, createCard } as never);
    await program.parseAsync(["node", "mooring", "create", "--label", "ops", "--signer", AGENT, "--budget", "5", "--period", "1d", "--salt", "7", "--json"]);
    expect(nextCardIndex).not.toHaveBeenCalled();
    const parsed = JSON.parse(out.join(""));
    expect(parsed.card).toBe(CARD);
    expect(parsed.saltIndex).toBe(7);
    expect(parsed.policy.period_amount).toBe("50000000");
  });

  it("exits 2 without an owner secret and 1 on bad arguments or an unknown deployment", async () => {
    const createCard = vi.fn();
    const run = async (args: string[], env?: string) => {
      const out: string[] = [];
      process.exitCode = 0;
      if (env === undefined) delete process.env.OWNER_SECRET;
      else process.env.OWNER_SECRET = env;
      const program = buildProgram({ stdout: (s: string) => out.push(s), nextCardIndex: vi.fn(async () => 0), createCard } as never);
      await program.parseAsync(["node", "mooring", "create", "--label", "ops", "--signer", AGENT, "--budget", "5", "--period", "1d", ...args]);
      return { out: out.join("\n"), code: process.exitCode };
    };
    expect(await run([])).toMatchObject({ code: 2 });
    expect((await run([])).out).toContain("Missing owner secret");
    expect(await run([], "not-a-secret")).toMatchObject({ code: 1 });
    expect(await run(["--max-per-tx", "6"], OWNER_SECRET)).toMatchObject({ code: 1 });
    expect((await run(["--expiry", "2020-01-01"], OWNER_SECRET)).out).toContain("expiry: must be in the future");
    const pubnet = await run(["--network", "stellar:pubnet"], OWNER_SECRET);
    expect(pubnet.code).toBe(1);
    expect(pubnet.out).toContain("not deployed on stellar:pubnet");
    expect(createCard).not.toHaveBeenCalled();
    process.exitCode = 0;
  });
});
