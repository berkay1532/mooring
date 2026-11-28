import { afterEach, describe, expect, it, vi } from "vitest";
import { Account, Asset, Keypair, Operation, TransactionBuilder, rpc, xdr } from "@stellar/stellar-sdk";
import { chargeRpcFromServer } from "../src/mpp-card-charge.js";
import { configFromEnv } from "../src/config.js";
import { PASSPHRASE, PAY_TO, SECRET, USDC } from "./fixtures.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Any signed envelope; the stubbed RPC only needs it to decode. */
function envelope(): string {
  const source = Keypair.random();
  const tx = new TransactionBuilder(new Account(source.publicKey(), "1"), { fee: "100", networkPassphrase: PASSPHRASE })
    .addOperation(Operation.payment({ destination: PAY_TO, asset: Asset.native(), amount: "1" }))
    .setTimeout(30)
    .build();
  tx.sign(source);
  return tx.toXDR();
}

describe("chargeRpcFromServer", () => {
  const live = () => chargeRpcFromServer("https://soroban-testnet.stellar.org", "stellar:testnet");

  it("reports a simulation error with the host's text", async () => {
    vi.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
      id: "1",
      latestLedger: 1,
      events: [],
      error: "HostError: Error(Auth, InvalidAction)",
      _parsed: true,
    } as never);
    expect(await live().simulate(envelope())).toEqual({ ok: false, error: "HostError: Error(Auth, InvalidAction)" });
  });

  it("names the network's result code when a send is not accepted", async () => {
    vi.spyOn(rpc.Server.prototype, "sendTransaction").mockResolvedValue({
      status: "ERROR",
      hash: "00",
      latestLedger: 1,
      latestLedgerCloseTime: 1,
      errorResult: { result: { type: "txBadSeq" } } as unknown as xdr.TransactionResult,
    } as never);
    // `tx_bad_seq` is what the client's sequence-conflict classifier matches.
    await expect(live().send(envelope())).rejects.toThrow("ERROR tx_bad_seq");
  });

  it("returns the hash of a pending send and maps transaction statuses", async () => {
    vi.spyOn(rpc.Server.prototype, "sendTransaction").mockResolvedValue({
      status: "PENDING",
      hash: "ff",
      latestLedger: 1,
      latestLedgerCloseTime: 1,
    } as never);
    const getTransaction = vi.spyOn(rpc.Server.prototype, "getTransaction");
    getTransaction.mockResolvedValueOnce({ status: "SUCCESS" } as never);
    getTransaction.mockResolvedValueOnce({ status: "FAILED" } as never);
    getTransaction.mockResolvedValueOnce({ status: "NOT_FOUND" } as never);
    vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValue({ sequence: 4242 } as never);

    const r = live();
    expect(await r.send(envelope())).toEqual({ hash: "ff" });
    expect([await r.wait("ff"), await r.wait("ff"), await r.wait("ff")]).toEqual(["SUCCESS", "FAILED", "NOT_FOUND"]);
    expect(await r.latestLedger()).toBe(4242);
  });
});

describe("configFromEnv", () => {
  const env = { SELLER_PAY_TO: PAY_TO, OZ_API_KEY: "k", MPP_SECRET_KEY: SECRET };

  it("defaults to testnet, its USDC and the OZ Channels testnet facilitator", () => {
    const cfg = configFromEnv(env);
    expect(cfg).toMatchObject({ network: "stellar:testnet", payTo: PAY_TO, usdc: USDC, priceBaseUnits: "10000" });
    expect(cfg.rpcUrl).toMatch(/^https:\/\//);
  });

  it("refuses a missing payee, API key or short MPP secret", () => {
    expect(() => configFromEnv({ ...env, SELLER_PAY_TO: "" })).toThrow("SELLER_PAY_TO");
    expect(() => configFromEnv({ ...env, OZ_API_KEY: "" })).toThrow("OZ_API_KEY");
    expect(() => configFromEnv({ ...env, MPP_SECRET_KEY: "short" })).toThrow("MPP_SECRET_KEY");
    expect(() => configFromEnv({ ...env, STELLAR_NETWORK: "stellar:futurenet" })).toThrow("STELLAR_NETWORK");
  });

  it("needs an explicit facilitator on pubnet", () => {
    expect(() =>
      configFromEnv({ ...env, STELLAR_NETWORK: "stellar:pubnet", SOROBAN_RPC_URL: "https://rpc.example" }),
    ).toThrow("FACILITATOR_URL");
  });
});
