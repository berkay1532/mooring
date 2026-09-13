import { Account, type Transaction } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CardInfo } from "../../lib/chain/card";

const REQUIRED_ENV = {
  NEXT_PUBLIC_STELLAR_NETWORK: "stellar:testnet",
  NEXT_PUBLIC_RPC_URL: "https://soroban-testnet.stellar.org",
  NEXT_PUBLIC_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  NEXT_PUBLIC_FACTORY_ADDRESS: "CBMSK4OSNLBEXTJWNEWX422RPVDEUNFEWADTSPECGBI26ESDYW65AUSE",
  NEXT_PUBLIC_USDC_SAC: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
};

const OWNER = "GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD";
const OTHER_OWNER = "GCWVS52A6XGOKUUSO4X7A5KBI3FWBILM4DS7JYQT3Z4K5YB7V574YEQZ";
const CARD = "CBXHE6IOGUVDJEKAHPJGFXRPYSI7H6UFWQE2AYTE5HOSEOWFEXWJ6ULP";

function fakeInfo(owner: string): CardInfo {
  return {
    owner,
    signer: new Uint8Array(32),
    token: REQUIRED_ENV.NEXT_PUBLIC_USDC_SAC,
    label: "test card",
    policy: { period_amount: 0n, period_duration: 0n, max_per_tx: 0n, expiry: 0n },
    state: 0,
    period: { start: 0n, spent: 0n },
    remaining: 0n,
    balance: 0n,
    allow_count: 0,
  };
}

describe("chain/card", () => {
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

  it("verifyOwnedCard resolves with info() when the owner matches", async () => {
    const { verifyOwnedCard } = await import("../../lib/chain/card");
    const info = fakeInfo(OWNER);
    const read = vi.fn().mockResolvedValue(info);

    await expect(verifyOwnedCard(CARD, OWNER, read)).resolves.toBe(info);
    expect(read).toHaveBeenCalledWith(CARD);
  });

  it("verifyOwnedCard throws when the card belongs to another owner", async () => {
    const { verifyOwnedCard } = await import("../../lib/chain/card");
    const read = vi.fn().mockResolvedValue(fakeInfo(OTHER_OWNER));

    await expect(verifyOwnedCard(CARD, OWNER, read)).rejects.toThrow(
      "This card belongs to another owner",
    );
  });

  it("verifyOwnedCard rejects an address that is not a contract strkey, without reading it", async () => {
    const { verifyOwnedCard } = await import("../../lib/chain/card");
    const read = vi.fn();

    await expect(verifyOwnedCard(OWNER, OWNER, read)).rejects.toThrow(
      /not a valid Stellar contract address/,
    );
    expect(read).not.toHaveBeenCalled();
  });

  it("buildFundTransfer prepares an unsigned SAC transfer from the owner's account", async () => {
    const { buildFundTransfer } = await import("../../lib/chain/card");
    const account = new Account(OWNER, "100");
    const getAccount = vi.fn().mockResolvedValue(account);
    const prepareTransaction = vi.fn(async (tx: Transaction) => tx);

    const tx = await buildFundTransfer(OWNER, CARD, 5_000_000n, {
      getAccount,
      prepareTransaction,
    });

    expect(getAccount).toHaveBeenCalledWith(OWNER);
    expect(prepareTransaction).toHaveBeenCalledTimes(1);
    expect(tx.operations).toHaveLength(1);
    expect(tx.operations[0].type).toBe("invokeHostFunction");
  });

  it("buildFundTransfer gives the owner the SDK's default 300 s signing window", async () => {
    const { buildFundTransfer } = await import("../../lib/chain/card");
    const { DEFAULT_TIMEOUT } = await import("@stellar/stellar-sdk/contract");
    const account = new Account(OWNER, "100");

    const tx = await buildFundTransfer(OWNER, CARD, 5_000_000n, {
      getAccount: vi.fn().mockResolvedValue(account),
      prepareTransaction: vi.fn(async (prepared: Transaction) => prepared),
    });

    // The window starts when the transaction is built, so it has to outlast a
    // real wallet review — 30 s did not (see the final review, B1).
    expect(DEFAULT_TIMEOUT).toBe(300);
    expect(tx.timeBounds).toBeDefined();
    const { minTime, maxTime } = tx.timeBounds as { minTime: string; maxTime: string };
    // `setTimeout` only sets `maxTime` (minTime stays 0), so the window is
    // measured from build time.
    expect(Number(minTime)).toBe(0);
    const window = Number(maxTime) - Math.floor(Date.now() / 1000);
    expect(window).toBeGreaterThan(DEFAULT_TIMEOUT - 5);
    expect(window).toBeLessThanOrEqual(DEFAULT_TIMEOUT);
  });

  it("cardClient and factoryClient bind to the configured contract and network", async () => {
    const { cardClient, factoryClient } = await import("../../lib/chain/card");
    const card = cardClient(CARD);
    const factory = factoryClient();

    expect(card.options.contractId).toBe(CARD);
    expect(card.options.networkPassphrase).toBe(REQUIRED_ENV.NEXT_PUBLIC_NETWORK_PASSPHRASE);
    expect(factory.options.contractId).toBe(REQUIRED_ENV.NEXT_PUBLIC_FACTORY_ADDRESS);
  });
});
