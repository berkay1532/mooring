import { afterEach, describe, expect, it, vi } from "vitest";
import { rpc } from "@stellar/stellar-sdk";
import {
  RECONCILE_ATTEMPTS,
  RECONCILE_DELAY_MS,
  reconcileSettlement,
} from "../src/reconcile.js";
import { authFailureEvents } from "./fixtures/events.js";

const HASH = "bc1b78eb2c0f4112d47f8faed70f608429a383d38a24f67ddda72f64453ccbba";
const CARD = "CAJPWJBFBM6WMYZBRURA7VW3GKSLMHTHIIZIRFVFKUSAPWX4526YAHCJ";
const RPC_URL = "https://soroban-testnet.stellar.org";
const fast = { attempts: 3, delayMs: 0 };

const notFound = { status: "NOT_FOUND" };
const success = { status: "SUCCESS" };
const failed = { status: "FAILED", diagnosticEventsXdr: authFailureEvents(CARD, 8) };

/** Stubs the RPC's `getTransaction`, answering each call in turn. */
function stubRpc(...answers: unknown[]) {
  const spy = vi.spyOn(rpc.Server.prototype, "getTransaction");
  for (const a of answers) {
    if (a instanceof Error) spy.mockRejectedValueOnce(a);
    else spy.mockResolvedValueOnce(a as never);
  }
  spy.mockResolvedValue(notFound as never);
  return spy;
}

afterEach(() => vi.restoreAllMocks());

describe("reconcileSettlement", () => {
  it("reports a transaction the ledger accepted", async () => {
    stubRpc(success);
    await expect(reconcileSettlement(RPC_URL, "stellar:testnet", HASH, fast)).resolves.toEqual({
      status: "SUCCESS",
    });
  });

  it("reports a failed transaction with its diagnostic events", async () => {
    stubRpc(failed);
    const out = await reconcileSettlement(RPC_URL, "stellar:testnet", HASH, fast);
    expect(out.status).toBe("FAILED");
    expect(out.status === "FAILED" && out.events).toHaveLength(1);
  });

  it("keeps polling while the transaction is not yet visible", async () => {
    const spy = stubRpc(notFound, notFound, success);
    await expect(reconcileSettlement(RPC_URL, "stellar:testnet", HASH, fast)).resolves.toEqual({
      status: "SUCCESS",
    });
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("gives up as NOT_FOUND once the window is exhausted", async () => {
    const spy = stubRpc(notFound, notFound, notFound);
    await expect(reconcileSettlement(RPC_URL, "stellar:testnet", HASH, fast)).resolves.toEqual({
      status: "NOT_FOUND",
    });
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("treats an RPC error as 'not seen yet' and keeps polling", async () => {
    const spy = stubRpc(new Error("rpc unreachable"), success);
    await expect(reconcileSettlement(RPC_URL, "stellar:testnet", HASH, fast)).resolves.toEqual({
      status: "SUCCESS",
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("allows HTTP on testnet only", async () => {
    stubRpc(success);
    await expect(
      reconcileSettlement("http://localhost:8000", "stellar:testnet", HASH, fast),
    ).resolves.toEqual({ status: "SUCCESS" });
    // The SDK itself refuses an insecure endpoint unless `allowHttp` is set.
    await expect(
      reconcileSettlement("http://localhost:8000", "stellar:pubnet", HASH, fast),
    ).rejects.toThrow(/insecure/i);
  });

  it("defaults to a ~10 s reconciliation window, 1 s apart", () => {
    expect(RECONCILE_ATTEMPTS).toBe(10);
    expect(RECONCILE_DELAY_MS).toBe(1000);
  });
});
