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

/**
 * A fake RPC that answers a whole round at once, as the real
 * `getLedgerEntries` does: only the keys that exist come back, in no
 * particular order.
 */
function fakeRpc(existing: ReadonlySet<string>) {
  return vi.fn(async (...keys: xdr.LedgerKey[]) => ({
    entries: keys
      .filter((key) => existing.has(key.toXDR("base64")))
      .reverse()
      .map((key) => ({ key, val: key, lastModifiedLedgerSeq: 1 })),
  }));
}

describe("discoverCards", () => {
  it("stops at the first gap, returns addresses in salt order, and probes one round per call", async () => {
    const getLedgerEntries = fakeRpc(new Set([addressFor(0), addressFor(1)].map(keyOf)));

    const result = await discoverCards(OWNER, {
      rpc: { getLedgerEntries },
      factory: FACTORY,
      passphrase: PASS,
      batch: 4,
      max: 32,
    });

    expect(result).toEqual([addressFor(0), addressFor(1)]);
    // One call for the whole round of 4 (salts 0-3); the gap at salt 2 stops
    // discovery before a second round starts.
    expect(getLedgerEntries).toHaveBeenCalledTimes(1);
    expect(getLedgerEntries.mock.calls[0]).toHaveLength(4);
  });

  it("never probes past `max`", async () => {
    // Every salt "exists" — without a `max` ceiling this would run forever.
    const getLedgerEntries = vi.fn(async (...keys: xdr.LedgerKey[]) => ({
      entries: keys.map((key) => ({ key, val: key, lastModifiedLedgerSeq: 1 })),
    }));

    const result = await discoverCards(OWNER, {
      rpc: { getLedgerEntries },
      factory: FACTORY,
      passphrase: PASS,
      batch: 8,
      max: 10,
    });

    expect(result.length).toBe(10);
    // Two rounds: 8 keys, then the 2 that are left under `max`.
    expect(getLedgerEntries).toHaveBeenCalledTimes(2);
    expect(getLedgerEntries.mock.calls.map((call) => call.length)).toEqual([8, 2]);
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

  it("throws on a resolved response that carries no entries array", async () => {
    const getLedgerEntries = vi.fn(async () => ({}) as { entries: readonly unknown[] });

    await expect(
      discoverCards(OWNER, {
        rpc: { getLedgerEntries },
        factory: FACTORY,
        passphrase: PASS,
        batch: 4,
        max: 32,
      }),
    ).rejects.toThrow(/no entries array/i);
  });
});
