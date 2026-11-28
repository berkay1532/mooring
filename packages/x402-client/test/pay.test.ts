import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, rpc, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { Credential, Receipt } from "mppx";
import { PaymentError } from "../src/denial.js";
import { stubCardTransferRpc } from "./fixtures/assembled.js";
import { PAY_TO, USDC_TESTNET, mppChallengeResponse } from "./fixtures/mpp-challenge.js";

const CARD = "CAJPWJBFBM6WMYZBRURA7VW3GKSLMHTHIIZIRFVFKUSAPWX4526YAHCJ";
const PASSPHRASE = "Test SDF Network ; September 2015";
const NOW = Math.floor(Date.now() / 1000);
const X402_TX = "ab".repeat(32);
const MPP_TX = "cd".repeat(32);

const agent = Keypair.random();

vi.mock("../src/card.js", () => ({
  readCardInfo: vi.fn(async () => ({
    owner: "G",
    signer: new Uint8Array(32),
    token: USDC_TESTNET,
    label: "agent",
    policy: {
      period_amount: 1_000_000_000n,
      period_duration: 86_400n,
      max_per_tx: 100_000_000n,
      expiry: BigInt(NOW + 365 * 86_400),
    },
    state: 0,
    period: { start: BigInt(NOW - 100), spent: 0n },
    remaining: 1_000_000_000n,
    balance: 500_000_000n,
    allow_count: 1,
  })),
  readMerchants: vi.fn(async () => [PAY_TO]),
}));
// The x402 scheme signs over RPC; a payload stub is enough to drive @x402/fetch.
// The MPP charge method signs for real against the stubbed RPC below.
vi.mock("../src/scheme.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/scheme.js")>()),
  CardExactStellarScheme: class {
    scheme = "exact";
    findDefaultAsset = () => undefined;
    async createPaymentPayload(v: number) {
      return { x402Version: v, payload: { transaction: "AAAA" } };
    }
  },
}));

const { pay } = await import("../src/pay.js");

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const headersOf = (input: RequestInfo | URL, init?: RequestInit) =>
  new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
const opts = (fetch: typeof globalThis.fetch) => ({
  card: CARD,
  agent,
  network: "stellar:testnet" as const,
  fetch,
});

/** A scripted seller: answers each call with the next response. */
function scripted(...responses: Array<() => Response>) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return next();
  });
}

const x402Terms = {
  x402Version: 2,
  resource: { url: "http://api.test/weather" },
  accepts: [
    {
      scheme: "exact",
      network: "stellar:testnet",
      asset: USDC_TESTNET,
      amount: "10000",
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
      extra: { areFeesSponsored: true },
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pay", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pays an x402 seller and reports protocol x402 with the settlement hash", async () => {
    const fetch = scripted(
      () =>
        new Response(JSON.stringify(x402Terms), {
          status: 402,
          headers: { "PAYMENT-REQUIRED": b64(x402Terms), "content-type": "application/json" },
        }),
      () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "PAYMENT-RESPONSE": b64({ success: true, transaction: X402_TX, network: "stellar:testnet" }),
            "content-type": "application/json",
          },
        }),
    );

    const result = await pay("http://api.test/weather", undefined, opts(fetch));

    expect(result.protocol).toBe("x402");
    expect(result.response.status).toBe(200);
    expect(await result.response.json()).toEqual({ ok: true });
    expect(result.settlement).toEqual({
      txHash: X402_TX,
      amount: "10000",
      payTo: PAY_TO,
      asset: USDC_TESTNET,
      network: "stellar:testnet",
    });
    expect(result.receipt).toBeNull();
    // The seller's 402 is reused, so only the paid request follows it.
    expect(fetch).toHaveBeenCalledTimes(2);
    const [first, second] = fetch.mock.calls;
    expect(headersOf(...first!).has("PAYMENT-SIGNATURE")).toBe(false);
    expect(headersOf(...second!).get("PAYMENT-SIGNATURE")).toBeTruthy();
  });

  it("pays an MPP seller and reports protocol mpp with the receipt reference as txHash", async () => {
    stubCardTransferRpc();
    vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValue({
      id: "x",
      sequence: 1000,
      protocolVersion: 23,
    } as never);
    const receipt = Receipt.serialize(
      Receipt.from({
        method: "stellar",
        reference: MPP_TX,
        status: "success",
        timestamp: new Date().toISOString(),
      }),
    );
    const fetch = scripted(
      () => mppChallengeResponse(),
      () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Payment-Receipt": receipt, "content-type": "application/json" },
        }),
    );

    const result = await pay("http://api.test/weather", undefined, opts(fetch));

    expect(result.protocol).toBe("mpp");
    expect(result.response.status).toBe(200);
    expect(result.settlement).toEqual({
      txHash: MPP_TX,
      amount: "10000",
      payTo: PAY_TO,
      asset: USDC_TESTNET,
      network: "stellar:testnet",
    });
    expect(result.receipt).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    const authorization = headersOf(...fetch.mock.calls[1]!).get("Authorization");
    expect(authorization).toMatch(/^Payment /);
    const credential = Credential.deserialize<{ type: string; transaction: string }>(authorization!);
    expect(credential.payload.type).toBe("transaction");
    const tx = TransactionBuilder.fromXDR(credential.payload.transaction, PASSPHRASE) as Transaction;
    expect(tx.operations).toHaveLength(1);
  });

  it("throws unconfirmed when the MPP seller answers the paid request without a receipt", async () => {
    stubCardTransferRpc();
    vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValue({
      id: "x",
      sequence: 1000,
      protocolVersion: 23,
    } as never);
    const onPaymentError = vi.fn();
    const fetch = scripted(
      () => mppChallengeResponse(),
      () => mppChallengeResponse(),
    );

    const err = await pay("http://api.test/weather", undefined, {
      ...opts(fetch),
      onPaymentError,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(PaymentError);
    expect(err.kind).toBe("unconfirmed");
    expect(onPaymentError).toHaveBeenCalledWith(err);
  });

  it("returns a non-402 untouched with protocol none", async () => {
    const ok = new Response("free", { status: 200 });
    const fetch = scripted(() => ok);

    const result = await pay(new URL("http://api.test/free"), { method: "GET" }, opts(fetch));

    expect(result).toEqual({ response: ok, protocol: "none", settlement: null, receipt: null });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a JSON 402 that is not x402 terms as not_payable", async () => {
    const onPaymentError = vi.fn();
    const fetch = scripted(
      () =>
        new Response(JSON.stringify({ error: "payment required" }), {
          status: 402,
          headers: { "content-type": "application/json" },
        }),
    );

    const err = await pay("http://api.test/json", undefined, { ...opts(fetch), onPaymentError }).catch(
      (e) => e,
    );

    expect(err).toBeInstanceOf(PaymentError);
    expect(err.kind).toBe("rejected");
    expect(err.detail).toMatch(/^not_payable: /);
    expect(onPaymentError).toHaveBeenCalledTimes(1);
    expect(onPaymentError).toHaveBeenCalledWith(err);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects x402 terms with no offer for the card's network as not_payable", async () => {
    const onPaymentError = vi.fn();
    const terms = {
      ...x402Terms,
      accepts: [{ ...x402Terms.accepts[0]!, network: "eip155:8453" }],
    };
    const fetch = scripted(
      () =>
        new Response(JSON.stringify(terms), {
          status: 402,
          headers: { "PAYMENT-REQUIRED": b64(terms), "content-type": "application/json" },
        }),
    );

    const err = await pay("http://api.test/base", undefined, { ...opts(fetch), onPaymentError }).catch(
      (e) => e,
    );

    expect(err).toBeInstanceOf(PaymentError);
    expect(err.kind).toBe("rejected");
    expect(err.detail).toMatch(/^not_payable: /);
    expect(onPaymentError).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a 402 that is neither protocol", async () => {
    const fetch = scripted(() => new Response("pay me", { status: 402 }));

    const err = await pay("http://api.test/opaque", undefined, opts(fetch)).catch((e) => e);

    expect(err).toBeInstanceOf(PaymentError);
    expect(err.kind).toBe("rejected");
    expect(err.detail).toMatch(/^not_payable/);
    expect(err.detail).toBe("not_payable: 402 without x402 or MPP terms");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
