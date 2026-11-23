import { describe, expect, it, vi } from "vitest";
import type { xdr } from "@stellar/stellar-sdk";
import { contractInstanceKey, deriveCardAddress, saltBytes } from "../src/derive.js";
import { discoverCards, nextCardIndex } from "../src/discover.js";

const OWNER = "GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD";
const FACTORY = "CBMSK4OSNLBEXTJWNEWX422RPVDEUNFEWADTSPECGBI26ESDYW65AUSE";
const TESTNET = "Test SDF Network ; September 2015";
const opts = { factory: FACTORY, passphrase: TESTNET };
const card = (i: number) => deriveCardAddress(OWNER, saltBytes(i), FACTORY, TESTNET);

/** An RPC that says cards exist exactly at the given salt indexes. */
function rpcWith(indexes: number[]) {
  const present = new Set(indexes.map((i) => contractInstanceKey(card(i)).toXDR("base64")));
  return {
    getLedgerEntries: vi.fn(async (...keys: xdr.LedgerKey[]) => ({
      entries: keys.filter((k) => present.has(k.toXDR("base64"))).map((k) => ({ key: k })),
    })),
  };
}

describe("discoverCards", () => {
  it("returns the dense prefix in salt order and stops at the first gap", async () => {
    const rpc = rpcWith([0, 1, 2, 5]);
    expect(await discoverCards(OWNER, { rpc, ...opts })).toEqual([card(0), card(1), card(2)]);
    expect(rpc.getLedgerEntries).toHaveBeenCalledTimes(1);
  });
  it("probes in batches up to max", async () => {
    const rpc = rpcWith(Array.from({ length: 20 }, (_, i) => i));
    const found = await discoverCards(OWNER, { rpc, ...opts, max: 12, batch: 4 });
    expect(found).toHaveLength(12);
    expect(rpc.getLedgerEntries).toHaveBeenCalledTimes(3);
  });
  it("throws on a malformed response rather than reporting no cards", async () => {
    const rpc = { getLedgerEntries: vi.fn(async () => ({}) as never) };
    await expect(discoverCards(OWNER, { rpc, ...opts })).rejects.toThrow(/entries/);
  });
  it("nextCardIndex is the count", async () => {
    expect(await nextCardIndex(OWNER, { rpc: rpcWith([0, 1]), ...opts })).toBe(2);
    expect(await nextCardIndex(OWNER, { rpc: rpcWith([]), ...opts })).toBe(0);
  });
});
