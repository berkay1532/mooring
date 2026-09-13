import type { xdr } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";

import { contractInstanceKey, deriveCardAddress, saltBytes } from "../../lib/chain/derive";
import { discoverCards } from "../../lib/chain/discover";

const OWNER = "GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD";
const FACTORY = "CBMSK4OSNLBEXTJWNEWX422RPVDEUNFEWADTSPECGBI26ESDYW65AUSE";
const PASS = "Test SDF Network ; September 2015";

function addressFor(n: number): string {
  return deriveCardAddress(OWNER, saltBytes(n), FACTORY, PASS);
}

function keyOf(address: string): string {
  return contractInstanceKey(address).toXDR("base64");
}

describe("discoverCards", () => {
  it("stops at the first gap, returns addresses in salt order, and probes at most `batch` per round", async () => {
    const existing = new Set([addressFor(0), addressFor(1)].map(keyOf));
    const getLedgerEntries = vi.fn(async (key: xdr.LedgerKey) => {
      return existing.has(key.toXDR("base64")) ? { entries: [{ key, val: key }] } : { entries: [] };
    });

    const result = await discoverCards(OWNER, {
      rpc: { getLedgerEntries },
      factory: FACTORY,
      passphrase: PASS,
      batch: 4,
      max: 32,
    });

    expect(result).toEqual([addressFor(0), addressFor(1)]);
    // One round of 4 probes (salts 0-3); the gap at salt 2 stops discovery
    // before a second round starts.
    expect(getLedgerEntries).toHaveBeenCalledTimes(4);
  });

  it("never probes past `max`", async () => {
    // Every salt "exists" — without a `max` ceiling this would run forever.
    const getLedgerEntries = vi.fn(async () => ({ entries: [{ key: {}, val: {} }] }));

    const result = await discoverCards(OWNER, {
      rpc: { getLedgerEntries },
      factory: FACTORY,
      passphrase: PASS,
      batch: 8,
      max: 10,
    });

    expect(result.length).toBe(10);
    expect(getLedgerEntries).toHaveBeenCalledTimes(10);
  });

  it("propagates an RPC/network failure instead of treating it as no cards", async () => {
    const getLedgerEntries = vi.fn(async () => {
      throw new Error("network error: connection reset");
    });

    await expect(
      discoverCards(OWNER, {
        rpc: { getLedgerEntries },
        factory: FACTORY,
        passphrase: PASS,
        batch: 4,
        max: 32,
      }),
    ).rejects.toThrow(/network error/);
  });
});
