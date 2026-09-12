import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { readCardInfo } from "../src/card.js";

const CARD = "CAJPWJBFBM6WMYZBRURA7VW3GKSLMHTHIIZIRFVFKUSAPWX4526YAHCJ";
const TOKEN = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const MERCHANT = "GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG";
const USDC = 10_000_000n;

const info = {
  owner: "G",
  signer: new Uint8Array(32),
  token: TOKEN,
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
  settleFails?: boolean;
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
        paid ? "invalid_exact_stellar_payload_simulation_failed" : undefined,
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
        errorReason: "settle_exact_stellar_transaction_failed",
        transaction: "deadbeef",
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

  it("classifies a settle failure as a policy denial with the tx hash", async () => {
    const f = createMooringFetch({
      ...opts(),
      fetch: fakeServer({ amount: "10000", settleFails: true }),
    });
    await expect(f("http://api.test/weather")).rejects.toMatchObject({
      stage: "settle",
      detail: expect.stringContaining("deadbeef"),
    });
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

  it("denies a 402 that carries no decodable PAYMENT-REQUIRED header", async () => {
    const f = createMooringFetch({
      ...opts(),
      fetch: fakeServer({ amount: "10000", opaque402: true }),
    });
    await expect(f("http://api.test/weather")).rejects.toMatchObject({
      name: "CardPolicyDenied",
      reason: "unknown",
      stage: "verify",
    });
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
