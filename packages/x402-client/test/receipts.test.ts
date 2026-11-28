import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { canonicalReceipt, receiptId, signReceipt, verifyReceipt, type Receipt } from "../src/receipts.js";

const agent = Keypair.random();

const unsigned = (): Omit<Receipt, "sig"> => ({
  v: 1,
  id: receiptId(),
  ts: "2026-11-28T10:00:00.000Z",
  protocol: "mpp",
  card: "CAJPWJBFBM6WMYZBRURA7VW3GKSLMHTHIIZIRFVFKUSAPWX4526YAHCJ",
  agent: agent.publicKey(),
  payTo: "GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG",
  amount: "10000",
  asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  network: "stellar:testnet",
  url: "https://api.test/weather",
  status: "settled",
  txHash: "cd".repeat(32),
});

describe("receipts", () => {
  it("signs a receipt the agent's public key verifies, and a changed amount fails", () => {
    const r = signReceipt(unsigned(), agent);
    expect(r.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(verifyReceipt(r)).toBe(true);
    expect(verifyReceipt({ ...r, amount: "10001" })).toBe(false);
    // Another key cannot vouch for it.
    expect(verifyReceipt({ ...r, agent: Keypair.random().publicKey() })).toBe(false);
    // Garbage never throws.
    expect(verifyReceipt({ ...r, sig: "zz" })).toBe(false);
    expect(verifyReceipt({ ...r, agent: "not-a-key" })).toBe(false);
  });

  it("canonical form sorts keys and omits sig", () => {
    const r = signReceipt(unsigned(), agent);
    const canonical = canonicalReceipt(r);
    expect(canonical).not.toContain("sig");
    expect(canonical).not.toMatch(/\s/);
    const keys = Object.keys(JSON.parse(canonical));
    expect(keys).toEqual([...keys].sort());
    expect(keys).toEqual(Object.keys(unsigned()).sort());
    // Key order of the input does not matter.
    const shuffled = Object.fromEntries(Object.entries(unsigned()).reverse()) as Omit<Receipt, "sig">;
    const base = { ...unsigned(), id: "x" };
    expect(canonicalReceipt({ ...shuffled, id: "x" })).toBe(canonicalReceipt(base));
    // Nested objects are sorted too, and undefined fields are dropped.
    expect(canonicalReceipt({ b: { d: 1, c: [{ z: 1, y: 2 }] }, a: undefined } as never)).toBe(
      '{"b":{"c":[{"y":2,"z":1}],"d":1}}',
    );
  });

  it("receiptId is 16 random bytes in hex", () => {
    const a = receiptId();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(receiptId()).not.toBe(a);
  });
});
