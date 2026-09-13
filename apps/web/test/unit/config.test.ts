import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REQUIRED_ENV = {
  NEXT_PUBLIC_STELLAR_NETWORK: "stellar:testnet",
  NEXT_PUBLIC_RPC_URL: "https://soroban-testnet.stellar.org",
  NEXT_PUBLIC_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  NEXT_PUBLIC_FACTORY_ADDRESS: "CBMSK4OSNLBEXTJWNEWX422RPVDEUNFEWADTSPECGBI26ESDYW65AUSE",
  NEXT_PUBLIC_USDC_SAC: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
};

describe("config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      process.env[key] = value;
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("reads all required NEXT_PUBLIC_* values", async () => {
    const { config } = await import("../../lib/config");
    expect(config.factory).toBe(REQUIRED_ENV.NEXT_PUBLIC_FACTORY_ADDRESS);
    expect(config.usdc).toBe(REQUIRED_ENV.NEXT_PUBLIC_USDC_SAC);
    expect(config.network).toBe("stellar:testnet");
    expect(config.rpcUrl).toBe(REQUIRED_ENV.NEXT_PUBLIC_RPC_URL);
    expect(config.networkPassphrase).toBe(REQUIRED_ENV.NEXT_PUBLIC_NETWORK_PASSPHRASE);
  });

  it("throws when a required env var is missing", async () => {
    delete process.env.NEXT_PUBLIC_FACTORY_ADDRESS;
    await expect(async () => {
      await import("../../lib/config");
    }).rejects.toThrow(/Missing NEXT_PUBLIC_FACTORY_ADDRESS/);
  });

  /**
   * A regression guard for the production bug in Task 10: `lib/config.ts`
   * read `process.env[name]` dynamically, which Next cannot inline — the
   * browser bundle then threw "Missing NEXT_PUBLIC_…" on load while
   * `next dev` worked. Under vitest both forms behave identically, so no
   * behavioural test can catch it; the source text can.
   */
  it("reads every NEXT_PUBLIC_* value as a literal expression Next can inline", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(resolve(process.cwd(), "lib/config.ts"), "utf8")
      // Comments explain the rule (and quote the wrong form); only code counts.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    // No computed/dynamic reads: `process.env[…]`, destructuring, or aliasing.
    expect(source).not.toMatch(/process\.env\s*\[/);
    expect(source).not.toMatch(/const\s*\{[^}]*\}\s*=\s*process\.env/);

    for (const name of Object.keys(REQUIRED_ENV)) {
      expect(source).toContain(`process.env.${name}`);
    }
  });
});
