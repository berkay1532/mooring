import { describe, expect, it } from "vitest";
import { xdr } from "@stellar/stellar-sdk";
import { contractInstanceKey, deriveCardAddress, saltBytes } from "../src/derive.js";

const OWNER = "GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD";
const FACTORY = "CBMSK4OSNLBEXTJWNEWX422RPVDEUNFEWADTSPECGBI26ESDYW65AUSE";
const TESTNET = "Test SDF Network ; September 2015";

describe("saltBytes", () => {
  it("encodes the index big-endian in the last four bytes", () => {
    expect([...saltBytes(0)]).toEqual(new Array(32).fill(0));
    const one = saltBytes(1);
    expect(one.length).toBe(32);
    expect([...one.slice(28)]).toEqual([0, 0, 0, 1]);
    expect([...saltBytes(0x01020304).slice(28)]).toEqual([1, 2, 3, 4]);
  });
  it("rejects anything outside [0, 2^32)", () => {
    for (const n of [-1, 1.5, 2 ** 32, Number.NaN]) expect(() => saltBytes(n)).toThrow(RangeError);
  });
});

describe("deriveCardAddress", () => {
  it("matches the shared vector (web app + contracts/factory/src/test.rs)", () => {
    expect(deriveCardAddress(OWNER, saltBytes(1), FACTORY, TESTNET)).toBe("CBXHE6IOGUVDJEKAHPJGFXRPYSI7H6UFWQE2AYTE5HOSEOWFEXWJ6ULP");
  });
  it("changes with the salt, the owner, the factory and the network", () => {
    const base = deriveCardAddress(OWNER, saltBytes(1), FACTORY, TESTNET);
    expect(deriveCardAddress(OWNER, saltBytes(2), FACTORY, TESTNET)).not.toBe(base);
    expect(deriveCardAddress(OWNER, saltBytes(1), FACTORY, "Public Global Stellar Network ; September 2015")).not.toBe(base);
  });
  it("contractInstanceKey is a persistent contract-instance key for the address", () => {
    const key = contractInstanceKey("CBXHE6IOGUVDJEKAHPJGFXRPYSI7H6UFWQE2AYTE5HOSEOWFEXWJ6ULP");
    expect(key.type).toBe("contractData");
    const data = (key as xdr.LedgerKeyContractDataArm).contractData;
    expect(data.durability).toBe(xdr.ContractDataDurability.persistent);
    expect(data.key.type).toBe("scvLedgerKeyContractInstance");
  });
});
