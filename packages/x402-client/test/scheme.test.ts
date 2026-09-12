import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Address,
  Keypair,
  Transaction,
  contract,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { CardPolicyDenied } from "../src/denial.js";
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

afterEach(() => {
  vi.restoreAllMocks();
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

describe("CardExactStellarScheme.buildTransfer", () => {
  /** A minimal AssembledTransaction stand-in with a controllable simulation. */
  const fakeTx = (simulation: unknown) => ({
    built: new Transaction(TRANSFER_TX_XDR, PASSPHRASE),
    simulation,
    needsNonInvokerSigningBy: vi.fn().mockReturnValueOnce([CARD]).mockReturnValue([]),
    simulate: vi.fn().mockResolvedValue(undefined),
  });

  /** Stubs only `AssembledTransaction.build`, so `buildTransfer`'s body runs. */
  const stubBuild = (scheme: CardExactStellarScheme, simulation: unknown) => {
    const build = vi
      .spyOn(contract.AssembledTransaction, "build")
      .mockResolvedValue(fakeTx(simulation) as never);
    vi.spyOn(scheme as any, "sign").mockResolvedValue(undefined as never);
    vi.spyOn(scheme as any, "latestLedger").mockResolvedValue(1000 as never);
    return build;
  };

  const okSimulation = { transactionData: {}, minResourceFee: "1", latestLedger: 100 };

  it("invokes asset.transfer(card, payTo, amount) with address/address/i128 args", async () => {
    const scheme = new CardExactStellarScheme({
      card: CARD,
      agent: Keypair.random(),
      network: "stellar:testnet",
    });
    const build = stubBuild(scheme, okSimulation);

    await scheme.createPaymentPayload(2, reqs() as never);

    expect(build).toHaveBeenCalledTimes(1);
    const opts = build.mock.calls[0]![0] as {
      contractId: string;
      method: string;
      networkPassphrase: string;
      args: xdr.ScVal[];
    };
    expect(opts.contractId).toBe(TOKEN);
    expect(opts.method).toBe("transfer");
    expect(opts.networkPassphrase).toBe(PASSPHRASE);
    expect(opts.args).toHaveLength(3);

    const expected = [
      nativeToScVal(Address.fromString(CARD), { type: "address" }),
      nativeToScVal(Address.fromString(MERCHANT), { type: "address" }),
      nativeToScVal(10000n, { type: "i128" }),
    ];
    expect(opts.args.map((a) => a.toXDR("base64"))).toEqual(
      expected.map((a) => a.toXDR("base64")),
    );
  });

  it("rejects a failed simulation", async () => {
    const scheme = new CardExactStellarScheme({
      card: CARD,
      agent: Keypair.random(),
      network: "stellar:testnet",
    });
    stubBuild(scheme, { error: "boom" });

    await expect(scheme.createPaymentPayload(2, reqs() as never)).rejects.toThrow(
      /Stellar simulation failed: boom/,
    );
  });

  it("rejects a simulation that needs a ledger entry restore", async () => {
    const scheme = new CardExactStellarScheme({
      card: CARD,
      agent: Keypair.random(),
      network: "stellar:testnet",
    });
    stubBuild(scheme, {
      ...okSimulation,
      restorePreamble: { transactionData: {}, minResourceFee: "1" },
    });

    await expect(scheme.createPaymentPayload(2, reqs() as never)).rejects.toThrow(
      /requires a ledger entry restore/,
    );
  });

  it("rejects a missing simulation", async () => {
    const scheme = new CardExactStellarScheme({
      card: CARD,
      agent: Keypair.random(),
      network: "stellar:testnet",
    });
    stubBuild(scheme, undefined);

    await expect(scheme.createPaymentPayload(2, reqs() as never)).rejects.toThrow(
      /simulation result is undefined/,
    );
  });
});

describe("CardExactStellarScheme enforcing simulation", () => {
  /** The card's `__check_auth` rejecting a payment, as the RPC reports it. */
  const cardRejection = (code: number) =>
    [
      "HostError: Error(Auth, InvalidAction)",
      "",
      "Event log (newest first):",
      `   0: [Diagnostic Event] contract:${TOKEN}, topics:[error, Error(Auth, InvalidAction)], ` +
        `data:["failed account authentication with error", ${CARD}, Error(Contract, #${code})]`,
    ].join("\n");

  /**
   * Stubs `AssembledTransaction.build` with a transaction whose first
   * simulation succeeds and whose post-signing re-simulation fails with
   * `error`.
   */
  const stubFailingResimulation = (scheme: CardExactStellarScheme, error: string) => {
    const tx = {
      built: new Transaction(TRANSFER_TX_XDR, PASSPHRASE),
      simulation: { transactionData: {}, minResourceFee: "1", latestLedger: 100 } as unknown,
      needsNonInvokerSigningBy: vi.fn().mockReturnValueOnce([CARD]).mockReturnValue([]),
      simulate: vi.fn().mockImplementation(async () => {
        tx.simulation = { error };
      }),
    };
    vi.spyOn(contract.AssembledTransaction, "build").mockResolvedValue(tx as never);
    vi.spyOn(scheme as any, "sign").mockResolvedValue(undefined as never);
    vi.spyOn(scheme as any, "latestLedger").mockResolvedValue(1000 as never);
    return tx;
  };

  it("asks for legacy (v1) address credentials, which facilitators can decode", async () => {
    const scheme = new CardExactStellarScheme({
      card: CARD,
      agent: Keypair.random(),
      network: "stellar:testnet",
    });
    const tx = stubFailingResimulation(scheme, "unused");
    tx.simulate.mockResolvedValue(undefined);

    await scheme.createPaymentPayload(2, reqs() as never);

    const build = contract.AssembledTransaction.build as unknown as ReturnType<typeof vi.fn>;
    expect(build.mock.calls[0]![0]).toMatchObject({ useUpgradedAuth: false });
    expect(tx.simulate).toHaveBeenCalledWith({ useUpgradedAuth: false });
  });

  it("reports the card's rejection as a typed denial at the simulate stage", async () => {
    const onDenial = vi.fn();
    const scheme = new CardExactStellarScheme({
      card: CARD,
      agent: Keypair.random(),
      network: "stellar:testnet",
      onDenial,
    });
    stubFailingResimulation(scheme, cardRejection(6));

    const err = await scheme.createPaymentPayload(2, reqs() as never).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CardPolicyDenied);
    expect(err).toMatchObject({ reason: "not_allowlisted", stage: "simulate", contractError: 6 });
    expect(onDenial).toHaveBeenCalledWith(err);
  });

  it("leaves a token-level failure a plain error, even when it names the card", async () => {
    const onDenial = vi.fn();
    const scheme = new CardExactStellarScheme({
      card: CARD,
      agent: Keypair.random(),
      network: "stellar:testnet",
      onDenial,
    });
    // The token, not the card, refusing the transfer. The card's address is in
    // the `transfer` arguments of every such diagnostic, and the SAC's own error
    // codes overlap the card's 1-8 range — only the account-authentication
    // phrase distinguishes a policy decision from this.
    stubFailingResimulation(
      scheme,
      [
        "HostError: Error(Contract, #8)",
        "",
        "Event log (newest first):",
        `   0: [Diagnostic Event] contract:${TOKEN}, topics:[error, Error(Contract, #8)], ` +
          `data:["resulting balance is not within the allowed range", 0, -10000, 9223372036854775807]`,
        `   1: [Diagnostic Event] topics:[fn_call, ${TOKEN}, transfer], ` +
          `data:[${CARD}, ${MERCHANT}, 10000]`,
      ].join("\n"),
    );

    const err = await scheme.createPaymentPayload(2, reqs() as never).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(CardPolicyDenied);
    expect(onDenial).not.toHaveBeenCalled();
  });

  it("ignores an authentication failure that is not the card's", async () => {
    const onDenial = vi.fn();
    const scheme = new CardExactStellarScheme({
      card: CARD,
      agent: Keypair.random(),
      network: "stellar:testnet",
      onDenial,
    });
    stubFailingResimulation(
      scheme,
      `HostError: Error(Auth, InvalidAction)\n   0: [Diagnostic Event] contract:${TOKEN}, ` +
        `data:["failed account authentication with error", ${MERCHANT}, Error(Contract, #3)], ` +
        `args:[${CARD}]`,
    );

    const err = await scheme.createPaymentPayload(2, reqs() as never).catch((e: unknown) => e);

    expect(err).not.toBeInstanceOf(CardPolicyDenied);
    expect(onDenial).not.toHaveBeenCalled();
  });
});
