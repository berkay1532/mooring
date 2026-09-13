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
});
