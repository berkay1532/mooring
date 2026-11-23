import { describe, expect, it, vi } from "vitest";
import { Address, Keypair, Account, nativeToScVal, scValToNative, xdr, type Transaction } from "@stellar/stellar-sdk";
import { createCard, createCardArgs, encodePolicy, type CreateCardRpc } from "../src/create.js";
import { deriveCardAddress, saltBytes } from "../src/derive.js";

const FACTORY = "CBMSK4OSNLBEXTJWNEWX422RPVDEUNFEWADTSPECGBI26ESDYW65AUSE";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const TESTNET = "Test SDF Network ; September 2015";
const owner = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9));
const policy = { period_amount: 10_000_000n, period_duration: 86_400n, max_per_tx: 10_000_000n, expiry: 1_800_000_000n };
const base = { owner, signer: new Uint8Array(32).fill(1), token: USDC, label: "cli card", policy, saltIndex: 3, factory: FACTORY };

describe("encodePolicy / createCardArgs", () => {
  it("encodes the policy as a sorted map that round-trips through scValToNative", () => {
    const sc = encodePolicy(policy);
    expect(sc.type).toBe("scvMap");
    expect((sc as xdr.ScValMap).map!.map((e) => scValToNative(e.key) as string)).toEqual(["expiry", "max_per_tx", "period_amount", "period_duration"]);
    expect(scValToNative(sc)).toEqual(policy);
  });
  it("lays the arguments out in the contract's order", () => {
    const args = createCardArgs(base);
    expect(args).toHaveLength(6);
    expect(Address.fromScVal(args[0]).toString()).toBe(owner.publicKey());
    expect([...(scValToNative(args[1]) as Buffer)]).toEqual(new Array(32).fill(1));
    expect(Address.fromScVal(args[2]).toString()).toBe(USDC);
    expect(scValToNative(args[4])).toBe("cli card");
    expect([...(scValToNative(args[5]) as Buffer).slice(28)]).toEqual([0, 0, 0, 3]);
  });
  it("rejects a bad signer or label before anything is built", () => {
    expect(() => createCardArgs({ ...base, signer: new Uint8Array(31) })).toThrow(/32 bytes/);
    expect(() => createCardArgs({ ...base, label: "" })).toThrow(/1 to 32/);
    expect(() => createCardArgs({ ...base, label: "ü".repeat(17) })).toThrow(/1 to 32/);
  });
});

describe("createCard", () => {
  const expected = deriveCardAddress(owner.publicKey(), saltBytes(3), FACTORY, TESTNET);
  type Fake = CreateCardRpc & { signedBy: string[] };
  function fakeRpc(over: Partial<Record<keyof CreateCardRpc, unknown>> = {}): Fake {
    const state = { signedBy: [] as string[] };
    const impl = {
      getAccount: async () => new Account(owner.publicKey(), "7"),
      prepareTransaction: async (tx: Transaction) => tx,
      sendTransaction: async (tx: Transaction) => {
        state.signedBy = tx.signatures.map((s) => Buffer.from(s.hint.toXDR()).toString("hex"));
        return { status: "PENDING", hash: "cafe".repeat(16) };
      },
      getTransaction: vi
        .fn()
        .mockResolvedValueOnce({ status: "NOT_FOUND" })
        .mockResolvedValueOnce({ status: "SUCCESS", returnValue: Address.fromString(expected).toScVal() }),
      ...over,
    };
    return Object.assign(state, impl) as unknown as Fake;
  }
  it("builds, prepares, signs with the owner, sends and polls to the returned address", async () => {
    const rpc = fakeRpc();
    const res = await createCard({ ...base, networkPassphrase: TESTNET }, { rpc, sleep: async () => {} });
    expect(res).toEqual({ card: expected, saltIndex: 3, txHash: "cafe".repeat(16), owner: owner.publicKey() });
    expect(rpc.signedBy).toEqual([Buffer.from(owner.signatureHint()).toString("hex")]);
    expect((rpc.getTransaction as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2);
  });
  it("fails when the factory returns a different address, when the send is rejected, or on a FAILED tx", async () => {
    const other = deriveCardAddress(owner.publicKey(), saltBytes(4), FACTORY, TESTNET);
    await expect(
      createCard({ ...base, networkPassphrase: TESTNET }, { rpc: fakeRpc({ getTransaction: async () => ({ status: "SUCCESS", returnValue: Address.fromString(other).toScVal() }) }), sleep: async () => {} }),
    ).rejects.toThrow(/expected/);
    await expect(
      createCard({ ...base, networkPassphrase: TESTNET }, { rpc: fakeRpc({ sendTransaction: async () => ({ status: "ERROR", hash: "x" }) }), sleep: async () => {} }),
    ).rejects.toThrow(/not accepted: ERROR/);
    await expect(
      createCard({ ...base, networkPassphrase: TESTNET }, { rpc: fakeRpc({ getTransaction: async () => ({ status: "FAILED" }) }), sleep: async () => {} }),
    ).rejects.toThrow(/failed on-chain/);
  });
  it("gives up after `attempts` polls", async () => {
    const rpc = fakeRpc({ getTransaction: async () => ({ status: "NOT_FOUND" }) });
    await expect(createCard({ ...base, networkPassphrase: TESTNET }, { rpc, sleep: async () => {}, attempts: 3 })).rejects.toThrow(/not found after 3s/);
  });
  it("nativeToScVal sanity: u64/i128 hints produce the contract's types", () => {
    expect(nativeToScVal(1n, { type: "u64" }).type).toBe("scvU64");
    expect(nativeToScVal(1n, { type: "i128" }).type).toBe("scvI128");
    expect(xdr.ScVal.scvSymbol("expiry").type).toBe("scvSymbol");
  });
});
