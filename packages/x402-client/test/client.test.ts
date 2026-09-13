import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { readCardInfo } from "../src/card.js";
import { reconcileSettlement } from "../src/reconcile.js";
import { authFailureEvents, tokenFailureEvents } from "./fixtures/events.js";

const CARD = "CAJPWJBFBM6WMYZBRURA7VW3GKSLMHTHIIZIRFVFKUSAPWX4526YAHCJ";
const TOKEN = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const MERCHANT = "GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG";
const USDC = 10_000_000n;

const info = {
  owner: "G",
  signer: new Uint8Array(32),
  token: TOKEN,
  label: "inference-agent",
  policy: {
    period_amount: 50n * USDC,
    period_duration: 86_400n,
    max_per_tx: 10n * USDC,
    expiry: 4_000_000_000n,
  },
  state: 0,
  period: { start: 0n, spent: 0n },
  remaining: 50n * USDC,
  balance: 20n * USDC,
  allow_count: 1,
};

vi.mock("../src/card.js", () => ({
  readCardInfo: vi.fn(async () => info),
  readMerchants: vi.fn(async () => [MERCHANT]),
}));
vi.mock("../src/reconcile.js", () => ({
  reconcileSettlement: vi.fn(async () => ({ status: "NOT_FOUND" })),
}));
vi.mock("../src/scheme.js", () => ({
  CardExactStellarScheme: class {
    scheme = "exact";
    findDefaultAsset = () => undefined;
    async createPaymentPayload(v: number) {
      return { x402Version: v, payload: { transaction: "AAAA" } };
    }
  },
}));

const { createMooringFetch, getSettlement } = await import("../src/client.js");

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const paymentRequired = (amount: string, payTo = MERCHANT, error?: string) => ({
  x402Version: 2,
  error,
  resource: { url: "http://api.test/weather" },
  accepts: [
    {
      scheme: "exact",
      network: "stellar:testnet",
      asset: TOKEN,
      amount,
      payTo,
      maxTimeoutSeconds: 60,
      extra: { areFeesSponsored: true },
    },
  ],
});

function fakeServer(opts: {
  amount: string;
  payTo?: string;
  verifyFails?: boolean;
  /** The facilitator's `invalidReason` for a failed verify. */
  verifyError?: string;
  settleFails?: boolean;
  /** The facilitator's `errorReason` for a failed settle. */
  settleError?: string;
  /** Answer the failed settle with an empty hash (nothing was submitted). */
  settleWithoutHash?: boolean;
  /** Answer the paid request with a 402 carrying no PAYMENT-REQUIRED header. */
  opaque402?: boolean;
  /** Answer the paid request 200 with an undecodable PAYMENT-RESPONSE header. */
  badSettlementHeader?: boolean;
}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const paid = headers.has("PAYMENT-SIGNATURE");
    if (!paid || opts.verifyFails) {
      const body = paymentRequired(
        opts.amount,
        opts.payTo,
        paid ? (opts.verifyError ?? "invalid_exact_stellar_payload_simulation_failed") : undefined,
      );
      return new Response(JSON.stringify(body), {
        status: 402,
        headers: { "PAYMENT-REQUIRED": b64(body), "content-type": "application/json" },
      });
    }
    if (opts.opaque402) {
      return new Response("no", { status: 402 });
    }
    if (opts.badSettlementHeader) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "PAYMENT-RESPONSE": "not-base64!!", "content-type": "application/json" },
      });
    }
    if (opts.settleFails) {
      const settle = {
        success: false,
        errorReason: opts.settleError ?? "settle_exact_stellar_transaction_failed",
        transaction: opts.settleWithoutHash ? "" : "deadbeef",
        network: "stellar:testnet",
      };
      return new Response(JSON.stringify(settle), {
        status: 402,
        headers: { "PAYMENT-RESPONSE": b64(settle) },
      });
    }
    const settle = {
      success: true,
      transaction: "cafebabe",
      network: "stellar:testnet",
      payer: CARD,
    };
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "PAYMENT-RESPONSE": b64(settle), "content-type": "application/json" },
    });
  });
}

/**
 * Charges every URL 1 USDC, but bills `/unlisted` to a merchant the card does not
 * allow. The paid leg settles slowly so a denial recorded by one in-flight request
 * would be observed by the other if denials were not scoped per call.
 */
function routingServer() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const body = paymentRequired("10000", url.includes("/unlisted") ? "GOTHER" : MERCHANT);
    if (!headers.has("PAYMENT-SIGNATURE")) {
      return new Response(JSON.stringify(body), {
        status: 402,
        headers: { "PAYMENT-REQUIRED": b64(body), "content-type": "application/json" },
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    const settle = { success: true, transaction: "cafebabe", network: "stellar:testnet", payer: CARD };
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "PAYMENT-RESPONSE": b64(settle), "content-type": "application/json" },
    });
  });
}

const opts = () => ({ card: CARD, agent: Keypair.random(), network: "stellar:testnet" as const });

describe("createMooringFetch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pays a 402 and exposes the settlement", async () => {
    const f = createMooringFetch({ ...opts(), fetch: fakeServer({ amount: "10000" }) });
    const res = await f("http://api.test/weather");
    expect(res.status).toBe(200);
    expect(getSettlement(res)).toMatchObject({ success: true, transaction: "cafebabe" });
  });

  it("denies locally before signing when the merchant is not allowlisted", async () => {
    const onDenial = vi.fn();
    const f = createMooringFetch({
      ...opts(),
      onDenial,
      fetch: fakeServer({ amount: "10000", payTo: "GOTHER" }),
    });
    await expect(f("http://api.test/weather")).rejects.toMatchObject({
      name: "CardPolicyDenied",
      reason: "not_allowlisted",
      stage: "precheck",
    });
    expect(onDenial).toHaveBeenCalledTimes(1);
  });

  it("denies locally when the amount exceeds the per-tx cap", async () => {
    const f = createMooringFetch({
      ...opts(),
      fetch: fakeServer({ amount: (11n * USDC).toString() }),
    });
    await expect(f("http://api.test/weather")).rejects.toMatchObject({
      reason: "over_per_tx_cap",
      stage: "precheck",
    });
  });

  it("classifies a verify-time 402 as a policy denial", async () => {
    const f = createMooringFetch({
      ...opts(),
      precheck: false,
      fetch: fakeServer({ amount: "10000", verifyFails: true }),
    });
    await expect(f("http://api.test/weather")).rejects.toMatchObject({
      name: "CardPolicyDenied",
      stage: "verify",
    });
  });

  it("names the policy reason at verify when the re-run pre-check finds one", async () => {
    const onDenial = vi.fn();
    const f = createMooringFetch({
      ...opts(),
      onDenial,
      precheck: false,
      fetch: fakeServer({ amount: "10000", payTo: "GOTHER", verifyFails: true }),
    });
    await expect(f("http://api.test/weather")).rejects.toMatchObject({
      name: "CardPolicyDenied",
      reason: "not_allowlisted",
      stage: "verify",
    });
    expect(onDenial).toHaveBeenCalledTimes(1);
  });

  it("reports a non-policy verify refusal as a PaymentError, not a denial", async () => {
    const onDenial = vi.fn();
    const onPaymentError = vi.fn();
    const f = createMooringFetch({
      ...opts(),
      precheck: false,
      onDenial,
      onPaymentError,
      fetch: fakeServer({
        amount: "10000",
        verifyFails: true,
        verifyError: "invalid_exact_stellar_payload_fee_exceeds_maximum",
      }),
    });
    await expect(f("http://api.test/weather")).rejects.toMatchObject({
      name: "PaymentError",
      kind: "rejected",
      detail: expect.stringContaining("fee_exceeds_maximum"),
    });
    expect(onDenial).not.toHaveBeenCalled();
    expect(onPaymentError).toHaveBeenCalledTimes(1);
  });

  it("reconciles a settle failure the ledger confirms failed, and names the card's error", async () => {
    vi.mocked(reconcileSettlement).mockResolvedValueOnce({
      status: "FAILED",
      events: authFailureEvents(CARD, 8),
    } as never);
    const f = createMooringFetch({
      ...opts(),
      fetch: fakeServer({ amount: "10000", settleFails: true }),
    });
    await expect(f("http://api.test/weather")).rejects.toMatchObject({
      name: "CardPolicyDenied",
      reason: "over_budget",
      stage: "settle",
      contractError: 8,
      detail: expect.stringContaining("deadbeef"),
    });
    expect(vi.mocked(reconcileSettlement).mock.calls[0]![2]).toBe("deadbeef");
  });

  it("reports a confirmed-failed settlement it cannot attribute to the card as unknown", async () => {
    vi.mocked(reconcileSettlement).mockResolvedValueOnce({
      status: "FAILED",
      events: tokenFailureEvents(CARD),
    } as never);
    const f = createMooringFetch({
      ...opts(),
      fetch: fakeServer({ amount: "10000", settleFails: true }),
    });
    await expect(f("http://api.test/weather")).rejects.toMatchObject({
      name: "CardPolicyDenied",
      reason: "unknown",
      stage: "settle",
      contractError: undefined,
    });
  });

  it("never calls a settlement the ledger accepted a policy denial", async () => {
    vi.mocked(reconcileSettlement).mockResolvedValueOnce({ status: "SUCCESS" } as never);
    const onDenial = vi.fn();
    const onPaymentError = vi.fn();
    const f = createMooringFetch({
      ...opts(),
      onDenial,
      onPaymentError,
      fetch: fakeServer({ amount: "10000", settleFails: true }),
    });
    await expect(f("http://api.test/weather")).rejects.toMatchObject({
      name: "PaymentError",
      kind: "unconfirmed",
      transaction: "deadbeef",
      detail: expect.stringContaining("settled on-chain but the server reported failure"),
    });
    expect(onDenial).not.toHaveBeenCalled();
    expect(onPaymentError).toHaveBeenCalledTimes(1);
  });

  it("reports a settlement still unseen after the reconciliation window as unconfirmed", async () => {
    vi.mocked(reconcileSettlement).mockResolvedValueOnce({ status: "NOT_FOUND" } as never);
    const f = createMooringFetch({
      ...opts(),
      fetch: fakeServer({ amount: "10000", settleFails: true }),
    });
    await expect(f("http://api.test/weather")).rejects.toMatchObject({
      name: "PaymentError",
      kind: "unconfirmed",
      transaction: "deadbeef",
    });
  });

  it("reports a settlement that never reached the ledger as a rejection", async () => {
    const f = createMooringFetch({
      ...opts(),
      precheck: false,
      fetch: fakeServer({
        amount: "10000",
        settleFails: true,
        settleWithoutHash: true,
        settleError: "settle_exact_stellar_transaction_submission_failed",
      }),
    });
    await expect(f("http://api.test/weather")).rejects.toMatchObject({
      name: "PaymentError",
      kind: "rejected",
      transaction: undefined,
      detail: expect.stringContaining("submission_failed"),
    });
    expect(reconcileSettlement).not.toHaveBeenCalled();
  });

  it("keeps a paid 200 whose PAYMENT-RESPONSE header is undecodable", async () => {
    const f = createMooringFetch({
      ...opts(),
      fetch: fakeServer({ amount: "10000", badSettlementHeader: true }),
    });
    const res = await f("http://api.test/weather");
    expect(res.status).toBe(200);
    expect(getSettlement(res)).toBeNull();
  });

  it("reports an opaque 402 as unconfirmed, not as a policy denial", async () => {
    const onDenial = vi.fn();
    const onPaymentError = vi.fn();
    const f = createMooringFetch({
      ...opts(),
      onDenial,
      onPaymentError,
      fetch: fakeServer({ amount: "10000", opaque402: true }),
    });
    await expect(f("http://api.test/weather")).rejects.toMatchObject({
      name: "PaymentError",
      kind: "unconfirmed",
      detail: "402 without PAYMENT-REQUIRED or PAYMENT-RESPONSE; settlement state unknown",
    });
    expect(onDenial).not.toHaveBeenCalled();
    expect(onPaymentError).toHaveBeenCalledTimes(1);
  });

  it("fails closed with a clear message when the pre-check cannot read the card", async () => {
    vi.mocked(readCardInfo).mockRejectedValueOnce(new Error("rpc unreachable"));
    const f = createMooringFetch({ ...opts(), fetch: fakeServer({ amount: "10000" }) });
    await expect(f("http://api.test/weather")).rejects.toMatchObject({
      name: "CardPolicyDenied",
      reason: "unknown",
      stage: "precheck",
      detail: expect.stringContaining("pre-check unavailable: rpc unreachable"),
    });
  });

  it("scopes denials per request, so a concurrent payment still succeeds", async () => {
    const f = createMooringFetch({ ...opts(), fetch: routingServer() });
    const denied = f("http://api.test/unlisted");
    const paid = f("http://api.test/weather");
    const [deniedResult, paidResult] = await Promise.allSettled([denied, paid]);

    expect(paidResult.status).toBe("fulfilled");
    expect((paidResult as PromiseFulfilledResult<Response>).value.status).toBe(200);
    expect(deniedResult.status).toBe("rejected");
    expect((deniedResult as PromiseRejectedResult).reason).toMatchObject({
      name: "CardPolicyDenied",
      reason: "not_allowlisted",
      stage: "precheck",
    });
  });
});
