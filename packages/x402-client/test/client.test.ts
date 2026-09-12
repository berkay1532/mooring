import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";

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
});
