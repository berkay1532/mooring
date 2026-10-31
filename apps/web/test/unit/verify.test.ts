import { Address, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";

import { contractInstanceKey } from "../../lib/chain/derive";
import { assertMooringCard, readContractWasmHash } from "../../lib/chain/verify";

const CARD = "CBXHE6IOGUVDJEKAHPJGFXRPYSI7H6UFWQE2AYTE5HOSEOWFEXWJ6ULP";
const HASH = "158b6acf3cde928e2c9c18c9e0f79fd29f7b847b7c73908c3972ef923c85d20f";

function instanceEntry(executable: xdr.ContractExecutable): xdr.LedgerEntryData {
  return xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: xdr.ExtensionPoint.v0(),
      contract: Address.fromString(CARD).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent,
      val: xdr.ScVal.scvContractInstance(new xdr.ScContractInstance({ executable, storage: null })),
    }),
  );
}

// A hex string is decoded by the SDK itself (`Hash`'s declared encoding);
// a `Buffer` would fail jsdom's realm-specific `Uint8Array` check.
const wasm = (hex: string) => xdr.ContractExecutable.contractExecutableWasm(hex);

/**
 * A stubbed RPC answering with a real entry. The entry is round-tripped
 * through base64 exactly as `rpc.Server` parses a JSON-RPC answer.
 */
function rpcWith(data: xdr.LedgerEntryData | null) {
  return {
    getLedgerEntries: vi.fn(async (..._keys: xdr.LedgerKey[]) => ({
      entries: data
        ? [{ key: contractInstanceKey(CARD), val: xdr.LedgerEntryData.fromXdr(data.toXdr("base64"), "base64") }]
        : [],
    })),
  };
}

describe("readContractWasmHash", () => {
  it("reads the instance entry's WASM hash as lowercase hex", async () => {
    const rpc = rpcWith(instanceEntry(wasm(HASH)));
    await expect(readContractWasmHash(rpc, CARD)).resolves.toBe(HASH);
    expect(rpc.getLedgerEntries).toHaveBeenCalledTimes(1);
    const [key] = rpc.getLedgerEntries.mock.calls[0];
    expect(key.toXDR("base64")).toBe(contractInstanceKey(CARD).toXDR("base64"));
  });

  it("accepts a raw base64 `xdr` entry too", async () => {
    const rpc = {
      getLedgerEntries: async () => ({ entries: [{ xdr: instanceEntry(wasm(HASH)).toXdr("base64") }] }),
    };
    await expect(readContractWasmHash(rpc, CARD)).resolves.toBe(HASH);
  });

  it("is null for a Stellar asset contract", async () => {
    const rpc = rpcWith(instanceEntry(xdr.ContractExecutable.contractExecutableStellarAsset()));
    await expect(readContractWasmHash(rpc, CARD)).resolves.toBeNull();
  });

  it("is null when no instance entry exists", async () => {
    await expect(readContractWasmHash(rpcWith(null), CARD)).resolves.toBeNull();
  });

  it("rejects a malformed response rather than reading it as no hash", async () => {
    const rpc = { getLedgerEntries: async () => ({}) as { entries: readonly unknown[] } };
    await expect(readContractWasmHash(rpc, CARD)).rejects.toThrow(/Malformed/);
  });
});

describe("assertMooringCard", () => {
  it("passes for the expected hash (case-insensitive)", async () => {
    await expect(
      assertMooringCard(rpcWith(instanceEntry(wasm(HASH))), CARD, HASH.toUpperCase()),
    ).resolves.toBeUndefined();
  });

  it("refuses a different WASM hash", async () => {
    await expect(
      assertMooringCard(rpcWith(instanceEntry(wasm("ab".repeat(32)))), CARD, HASH),
    ).rejects.toThrow("This address is not a Mooring card.");
  });

  it("refuses a Stellar asset contract", async () => {
    const rpc = rpcWith(instanceEntry(xdr.ContractExecutable.contractExecutableStellarAsset()));
    await expect(assertMooringCard(rpc, CARD, HASH)).rejects.toThrow("This address is not a Mooring card.");
  });

  it("refuses a missing contract", async () => {
    await expect(assertMooringCard(rpcWith(null), CARD, HASH)).rejects.toThrow(
      "This address is not a Mooring card.",
    );
  });
});
