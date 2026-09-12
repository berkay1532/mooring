import { describe, expect, it, vi } from "vitest";
import { Keypair, Transaction, xdr } from "@stellar/stellar-sdk";
import { CardExactStellarScheme } from "../src/scheme.js";
import { TRANSFER_TX_XDR } from "./fixtures/transfer-tx.js";

const CARD = "CAJPWJBFBM6WMYZBRURA7VW3GKSLMHTHIIZIRFVFKUSAPWX4526YAHCJ";
const TOKEN = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const MERCHANT = "GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG";
const PASSPHRASE = "Test SDF Network ; September 2015";

const reqs = (over: Partial<Record<string, unknown>> = {}) => ({
  scheme: "exact",
  network: "stellar:testnet",
  asset: TOKEN,
  amount: "10000",
  payTo: MERCHANT,
  maxTimeoutSeconds: 60,
  extra: { areFeesSponsored: true },
  ...over,
});

describe("CardExactStellarScheme.validateRequirements", () => {
  const scheme = new CardExactStellarScheme({
    card: CARD,
    agent: Keypair.random(),
    network: "stellar:testnet",
  });

  it("accepts valid requirements", () => {
    expect(() => scheme.validateRequirements(reqs() as never)).not.toThrow();
  });

  it("rejects wrong scheme, network, addresses, amount and unsponsored fees", () => {
    expect(() => scheme.validateRequirements(reqs({ scheme: "upto" }) as never)).toThrow(/scheme/);
    expect(() => scheme.validateRequirements(reqs({ network: "stellar:pubnet" }) as never)).toThrow(
      /network/,
    );
    expect(() => scheme.validateRequirements(reqs({ payTo: "not-an-address" }) as never)).toThrow(
      /destination/,
    );
    expect(() => scheme.validateRequirements(reqs({ asset: MERCHANT }) as never)).toThrow(/asset/);
    expect(() => scheme.validateRequirements(reqs({ amount: "0" }) as never)).toThrow(/amount/);
    expect(() => scheme.validateRequirements(reqs({ amount: "1.5" }) as never)).toThrow(/amount/);
    expect(() => scheme.validateRequirements(reqs({ extra: {} }) as never)).toThrow(
      /areFeesSponsored/,
    );
  });
});

describe("CardExactStellarScheme.createPaymentPayload", () => {
  it("builds transfer(card, payTo, amount), signs the card entry with the agent and returns the tx XDR", async () => {
    const agent = Keypair.random();
    const scheme = new CardExactStellarScheme({ card: CARD, agent, network: "stellar:testnet" });

    // Stub the three RPC-dependent collaborators the scheme uses. They are
    // `protected`, so the spies go through an `any` cast.
    const fakeBuilt = new Transaction(TRANSFER_TX_XDR, PASSPHRASE);
    const fakeTx = {
      built: fakeBuilt,
      simulation: { minResourceFee: "1", latestLedger: 100 },
      // The card is the only pending signer before signing, and nobody is
      // pending after it (this is what the real `needsNonInvokerSigningBy`
      // reports once the entry's signature is no longer `scvVoid`).
      needsNonInvokerSigningBy: vi.fn().mockReturnValueOnce([CARD]).mockReturnValue([]),
      simulate: vi.fn().mockResolvedValue(undefined),
    };
    const build = vi.spyOn(scheme as any, "buildTransfer").mockResolvedValue(fakeTx as never);
    const sign = vi.spyOn(scheme as any, "sign").mockResolvedValue(undefined as never);
    vi.spyOn(scheme as any, "latestLedger").mockResolvedValue(1000 as never);

    const out = await scheme.createPaymentPayload(2, reqs() as never);

    expect(build).toHaveBeenCalledWith(TOKEN, CARD, MERCHANT, 10000n);
    expect(sign).toHaveBeenCalledWith(fakeTx, 1000 + Math.ceil(60 / 5));
    expect(fakeTx.simulate).toHaveBeenCalledTimes(1);
    expect(out.x402Version).toBe(2);
    expect(typeof (out.payload as { transaction: string }).transaction).toBe("string");
    expect(() =>
      xdr.TransactionEnvelope.fromXDR((out.payload as { transaction: string }).transaction, "base64"),
    ).not.toThrow();
  });

  it("refuses when the card is not the only pending signer", async () => {
    const scheme = new CardExactStellarScheme({
      card: CARD,
      agent: Keypair.random(),
      network: "stellar:testnet",
    });
    vi.spyOn(scheme as any, "buildTransfer").mockResolvedValue({
      built: {},
      simulation: {},
      needsNonInvokerSigningBy: () => [MERCHANT],
      simulate: async () => {},
    } as never);
    vi.spyOn(scheme as any, "latestLedger").mockResolvedValue(1 as never);

    await expect(scheme.createPaymentPayload(2, reqs() as never)).rejects.toThrow(
      /Expected to sign with/,
    );
  });

  it("refuses a payload that still needs a signature after signing", async () => {
    const scheme = new CardExactStellarScheme({
      card: CARD,
      agent: Keypair.random(),
      network: "stellar:testnet",
    });
    vi.spyOn(scheme as any, "buildTransfer").mockResolvedValue({
      built: new Transaction(TRANSFER_TX_XDR, PASSPHRASE),
      simulation: { minResourceFee: "1", latestLedger: 100 },
      needsNonInvokerSigningBy: () => [CARD],
      simulate: async () => {},
    } as never);
    vi.spyOn(scheme as any, "sign").mockResolvedValue(undefined as never);
    vi.spyOn(scheme as any, "latestLedger").mockResolvedValue(1000 as never);

    await expect(scheme.createPaymentPayload(2, reqs() as never)).rejects.toThrow(
      /unexpected signer\(s\) required/,
    );
  });
});
