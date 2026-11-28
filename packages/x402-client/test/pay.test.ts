import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Keypair, rpc, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { Challenge, Credential, Errors, Receipt } from "mppx";
import { chargeMethod } from "../src/mpp/schema.js";
import { readCardInfo, readMerchants } from "../src/card.js";
import { CardPolicyDenied, GuardDenied, PaymentError } from "../src/denial.js";
import { MemoryGuard } from "../src/guard/memory.js";
import { verifyReceipt, type Receipt as MooringReceipt } from "../src/receipts.js";
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

const x402Challenge = () =>
  new Response(JSON.stringify(x402Terms), {
    status: 402,
    headers: { "PAYMENT-REQUIRED": b64(x402Terms), "content-type": "application/json" },
  });
const x402Paid = () =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "PAYMENT-RESPONSE": b64({ success: true, transaction: X402_TX, network: "stellar:testnet" }),
      "content-type": "application/json",
    },
  });
const mppReceipt = () =>
  Receipt.serialize(
    Receipt.from({ method: "stellar", reference: MPP_TX, status: "success", timestamp: new Date().toISOString() }),
  );
const mppPaid = () =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Payment-Receipt": mppReceipt(), "content-type": "application/json" },
  });
function stubMppRpc() {
  const stub = stubCardTransferRpc();
  const latest = vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValue({
    id: "x",
    sequence: 1000,
    protocolVersion: 23,
  } as never);
  return { ...stub, latest };
}

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
    expect(result.receipt).toMatchObject({ protocol: "x402", status: "settled", txHash: X402_TX });
    expect(verifyReceipt(result.receipt!)).toBe(true);
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
    expect(result.receipt).toMatchObject({ protocol: "mpp", status: "settled", txHash: MPP_TX });
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
  describe("guard and receipts", () => {
    for (const protocol of ["x402", "mpp"] as const) {
      it(`refuses before signing when the guard says stop and emits a denied receipt (${protocol})`, async () => {
        const { simulate, latest } = stubMppRpc();
        const guard = new MemoryGuard();
        await guard.stop("operator stop");
        const receipts: MooringReceipt[] = [];
        const onDenial = vi.fn();
        const onPaymentError = vi.fn();
        const fetch = scripted(protocol === "x402" ? x402Challenge : () => mppChallengeResponse());

        const err = await pay("http://api.test/weather?q=1", undefined, {
          ...opts(fetch),
          guard,
          onReceipt: (r) => receipts.push(r),
          onDenial,
          onPaymentError,
        }).catch((e) => e);

        expect(err).toBeInstanceOf(GuardDenied);
        expect(err.reason).toBe("stopped");
        // Nothing past the first 402: no card read, no RPC, no signature.
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(readCardInfo).not.toHaveBeenCalled();
        expect(simulate).not.toHaveBeenCalled();
        expect(latest).not.toHaveBeenCalled();
        expect(onDenial).not.toHaveBeenCalled();
        expect(onPaymentError).not.toHaveBeenCalled();
        expect(receipts).toHaveLength(1);
        expect(receipts[0]).toMatchObject({
          v: 1,
          protocol,
          card: CARD,
          agent: agent.publicKey(),
          payTo: PAY_TO,
          amount: "10000",
          asset: USDC_TESTNET,
          network: "stellar:testnet",
          url: "http://api.test/weather",
          status: "denied",
          reason: "stopped",
        });
        expect(receipts[0]!.txHash).toBeUndefined();
        expect(verifyReceipt(receipts[0]!)).toBe(true);
      });

      it(`refuses over a local cap before the pre-check or signing (${protocol})`, async () => {
        const { simulate, latest } = stubMppRpc();
        const guard = new MemoryGuard({ maxPerTx: "5000" });
        const receipts: MooringReceipt[] = [];
        const fetch = scripted(protocol === "x402" ? x402Challenge : () => mppChallengeResponse());

        const err = await pay("http://api.test/weather", undefined, {
          ...opts(fetch),
          guard,
          onReceipt: (r) => receipts.push(r),
        }).catch((e) => e);

        expect(err).toBeInstanceOf(GuardDenied);
        expect(err.reason).toBe("max_per_tx");
        expect(err.message).toContain("0.001 USDC attempted, limit 0.0005");
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(readCardInfo).not.toHaveBeenCalled();
        expect(simulate).not.toHaveBeenCalled();
        expect(latest).not.toHaveBeenCalled();
        expect(receipts.map((r) => [r.status, r.reason])).toEqual([["denied", "max_per_tx"]]);
        expect((await guard.snapshot(CARD)).reserved).toBe("0");
      });
    }

    it("emits a settled receipt with the tx hash after an MPP payment", async () => {
      stubMppRpc();
      const guard = new MemoryGuard({ dailyCap: "1" + "0".repeat(7) });
      const receipts: MooringReceipt[] = [];
      const fetch = scripted(() => mppChallengeResponse(), mppPaid);

      const result = await pay("http://api.test/weather", undefined, {
        ...opts(fetch),
        guard,
        onReceipt: (r) => receipts.push(r),
      });

      expect(receipts).toHaveLength(1);
      const r = receipts[0]!;
      expect(r).toMatchObject({
        v: 1,
        protocol: "mpp",
        card: CARD,
        agent: agent.publicKey(),
        payTo: PAY_TO,
        amount: "10000",
        asset: USDC_TESTNET,
        network: "stellar:testnet",
        url: "http://api.test/weather",
        status: "settled",
        txHash: MPP_TX,
      });
      expect(r.id).toMatch(/^[0-9a-f]{32}$/);
      expect(Number.isNaN(Date.parse(r.ts))).toBe(false);
      expect(r.reason).toBeUndefined();
      expect(verifyReceipt(r)).toBe(true);
      expect(result.receipt).toEqual(r);
      expect(await guard.snapshot(CARD)).toMatchObject({ daily: "10000", total: "10000", reserved: "0" });
    });

    it("emits a settled receipt and commits the reservation after an x402 payment", async () => {
      const guard = new MemoryGuard({ dailyCap: "10000" });
      const receipts: MooringReceipt[] = [];
      const fetch = scripted(x402Challenge, x402Paid);

      const result = await pay("http://api.test/weather", undefined, {
        ...opts(fetch),
        guard,
        onReceipt: (r) => receipts.push(r),
      });

      expect(receipts).toHaveLength(1);
      expect(receipts[0]).toMatchObject({ protocol: "x402", status: "settled", txHash: X402_TX, amount: "10000" });
      expect(verifyReceipt(receipts[0]!)).toBe(true);
      expect(result.receipt).toEqual(receipts[0]);
      expect(await guard.snapshot(CARD)).toMatchObject({ daily: "10000", reserved: "0" });
      // The daily cap is now full.
      const again = await pay("http://api.test/weather", undefined, {
        ...opts(scripted(x402Challenge)),
        guard,
      }).catch((e) => e);
      expect(again).toBeInstanceOf(GuardDenied);
      expect(again.reason).toBe("daily_cap");
    });

    it("a card policy denial emits a denied receipt and releases the reservation", async () => {
      vi.mocked(readMerchants).mockResolvedValueOnce([]);
      const guard = new MemoryGuard({ dailyCap: "10000" });
      const receipts: MooringReceipt[] = [];
      const onDenial = vi.fn();
      const fetch = scripted(x402Challenge);

      const err = await pay("http://api.test/weather", undefined, {
        ...opts(fetch),
        guard,
        onDenial,
        onReceipt: (r) => receipts.push(r),
      }).catch((e) => e);

      expect(err).toBeInstanceOf(CardPolicyDenied);
      expect(onDenial).toHaveBeenCalledWith(err);
      expect(receipts.map((r) => [r.status, r.reason])).toEqual([["denied", "not_allowlisted"]]);
      expect(await guard.snapshot(CARD)).toMatchObject({ daily: "0", reserved: "0" });
    });

    it("an unconfirmed payment counts as spent and emits a failed receipt", async () => {
      stubMppRpc();
      const guard = new MemoryGuard({ dailyCap: "10000" });
      const receipts: MooringReceipt[] = [];
      const fetch = scripted(
        () => mppChallengeResponse(),
        () => mppChallengeResponse(),
      );

      const err = await pay("http://api.test/weather", undefined, {
        ...opts(fetch),
        guard,
        onReceipt: (r) => receipts.push(r),
      }).catch((e) => e);

      expect(err).toBeInstanceOf(PaymentError);
      expect(err.kind).toBe("unconfirmed");
      expect(receipts).toHaveLength(1);
      expect(receipts[0]).toMatchObject({ status: "failed", reason: `unconfirmed: ${err.detail}` });
      expect(receipts[0]!.reason).toMatch(/^unconfirmed:/);
      expect(verifyReceipt(receipts[0]!)).toBe(true);
      expect(await guard.snapshot(CARD)).toMatchObject({ daily: "10000", total: "10000", reserved: "0" });
    });

    it("a rejected payment after the reservation releases it and emits a failed receipt", async () => {
      const { simulate } = stubMppRpc();
      const guard = new MemoryGuard({ dailyCap: "10000" });
      const receipts: MooringReceipt[] = [];
      const onPaymentError = vi.fn();
      // A charge in an asset the card does not hold: refused inside createCredential, after reserving.
      const OTHER_ASSET = "CAJPWJBFBM6WMYZBRURA7VW3GKSLMHTHIIZIRFVFKUSAPWX4526YAHCJ";
      const challenge = Challenge.fromMethod(chargeMethod, {
        secretKey: "test",
        realm: "api.mooring.live",
        request: {
          amount: "10000",
          currency: OTHER_ASSET,
          recipient: PAY_TO,
          methodDetails: { network: "stellar:testnet", credentialTypes: ["transaction"] },
        },
      });
      const fetch = scripted(
        () => new Response(null, { status: 402, headers: { "WWW-Authenticate": Challenge.serialize(challenge) } }),
      );

      const err = await pay("http://api.test/weather", undefined, {
        ...opts(fetch),
        guard,
        onPaymentError,
        onReceipt: (r) => receipts.push(r),
      }).catch((e) => e);

      expect(err).toBeInstanceOf(PaymentError);
      expect(err.kind).toBe("rejected");
      expect(err.detail).toMatch(/^unsupported_asset/);
      expect(simulate).not.toHaveBeenCalled();
      expect(receipts).toHaveLength(1);
      expect(receipts[0]).toMatchObject({ status: "failed", reason: err.detail, asset: OTHER_ASSET });
      expect(receipts[0]!.txHash).toBeUndefined();
      expect(await guard.snapshot(CARD)).toMatchObject({ daily: "0", total: "0", reserved: "0" });
    });

    /** A guard whose reserve/commit are spies over a MemoryGuard. */
    function spiedGuard() {
      const guard = new MemoryGuard({ dailyCap: "10000" });
      const reserve = vi.spyOn(guard, "reserve");
      const commit = vi.spyOn(guard, "commit");
      return { guard, reserve, commit };
    }
    const badSeq = (text: string) => () =>
      new Response(JSON.stringify({ error: `transaction rejected: ${text}` }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });

    it("retries once on sequence_conflict keeping the reservation, then fails", async () => {
      const { getAccount } = stubMppRpc();
      const { guard, reserve, commit } = spiedGuard();
      const receipts: MooringReceipt[] = [];
      const onPaymentError = vi.fn();
      const fetch = scripted(() => mppChallengeResponse(), badSeq("txBAD_SEQ"), badSeq("tx_bad_seq"));

      const err = await pay("http://api.test/weather", undefined, {
        ...opts(fetch),
        guard,
        onPaymentError,
        onReceipt: (r) => receipts.push(r),
      }).catch((e) => e);

      expect(err).toBeInstanceOf(PaymentError);
      expect(err).toMatchObject({ kind: "rejected", detail: expect.stringMatching(/^sequence_conflict/) });
      // The 402 is reused: one challenge, two paid attempts, two credentials built.
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(getAccount).toHaveBeenCalledTimes(2);
      expect(reserve).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledWith(expect.anything(), "failed");
      expect(onPaymentError).toHaveBeenCalledTimes(1);
      expect(onPaymentError).toHaveBeenCalledWith(err);
      expect(receipts.map((r) => [r.status, r.reason])).toEqual([["failed", err.detail]]);
      expect(await guard.snapshot(CARD)).toMatchObject({ daily: "0", reserved: "0" });
    });

    it("retries once on sequence_conflict and settles when the retry succeeds", async () => {
      const { getAccount } = stubMppRpc();
      const { guard, reserve, commit } = spiedGuard();
      const receipts: MooringReceipt[] = [];
      const onPaymentError = vi.fn();
      const fetch = scripted(() => mppChallengeResponse(), badSeq("TXBAD_SEQ"), mppPaid);

      const result = await pay("http://api.test/weather", undefined, {
        ...opts(fetch),
        guard,
        onPaymentError,
        onReceipt: (r) => receipts.push(r),
      });

      expect(result.response.status).toBe(200);
      expect(result.settlement?.txHash).toBe(MPP_TX);
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(getAccount).toHaveBeenCalledTimes(2);
      expect(reserve).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledWith(expect.anything(), "settled");
      expect(onPaymentError).not.toHaveBeenCalled();
      expect(receipts.map((r) => [r.status, r.txHash])).toEqual([["settled", MPP_TX]]);
    });

    it("a sequence_conflict in the WWW-Authenticate of the paid response is retried too", async () => {
      stubMppRpc();
      const { guard, reserve } = spiedGuard();
      const fetch = scripted(
        () => mppChallengeResponse(),
        () => new Response(null, { status: 401, headers: { "WWW-Authenticate": 'Payment error="tx_bad_seq"' } }),
        mppPaid,
      );

      const result = await pay("http://api.test/weather", undefined, { ...opts(fetch), guard });

      expect(result.settlement?.txHash).toBe(MPP_TX);
      expect(reserve).toHaveBeenCalledTimes(1);
    });

    describe("per agent key serialization", () => {
      /** A 402 with a Stellar charge challenge, optionally fee-sponsored. */
      const challenge402 = (feePayer?: boolean) => () =>
        new Response(null, {
          status: 402,
          headers: {
            "WWW-Authenticate": Challenge.serialize(
              Challenge.fromMethod(chargeMethod, {
                secretKey: "test",
                realm: "api.mooring.live",
                request: {
                  amount: "10000",
                  currency: USDC_TESTNET,
                  recipient: PAY_TO,
                  methodDetails: {
                    network: "stellar:testnet",
                    credentialTypes: ["transaction"],
                    ...(feePayer ? { feePayer } : {}),
                  },
                },
              }),
            ),
          },
        });

      /**
       * A seller for one payer `tag`: answers the unpaid leg with `challenge`
       * and the paid leg with `paid` once `gate` resolves. Every step is logged.
       */
      function seller(tag: string, events: string[], challenge: () => Response, gate: Promise<void>, paid: () => Response = mppPaid) {
        return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          if (!headersOf(input, init).get("Authorization")) return challenge();
          events.push(`paid-sent:${tag}`);
          await gate;
          events.push(`paid-answered:${tag}`);
          return paid();
        });
      }

      /** Logs every credential build (each one reads the source account). */
      function logBuilds(events: string[]) {
        const { getAccount, simulate } = stubMppRpc();
        getAccount.mockImplementation(async (address: string) => {
          events.push(`build:${address === agent.publicKey() ? "A" : address.slice(0, 4)}`);
          return new Account(address, "5");
        });
        return { getAccount, simulate };
      }

      const tick = () => new Promise((r) => setTimeout(r, 20));

      it("holds the agent lock from the credential's build until the seller answers", async () => {
        const events: string[] = [];
        logBuilds(events);
        let open!: () => void;
        const gate = new Promise<void>((r) => (open = r));
        const order: string[] = [];

        const p1 = pay("http://api.test/one", undefined, opts(seller("1", events, challenge402(), gate)))
          .then((r) => (order.push("1"), r));
        const p2 = pay("http://api.test/two", undefined, opts(seller("2", events, challenge402(), Promise.resolve())))
          .then((r) => (order.push("2"), r));
        await tick();
        // The first payment is waiting on its seller; the second has not built.
        expect(events).toEqual(["build:A", "paid-sent:1"]);

        open();
        const [r1, r2] = await Promise.all([p1, p2]);
        expect(events).toEqual(["build:A", "paid-sent:1", "paid-answered:1", "build:A", "paid-sent:2", "paid-answered:2"]);
        expect(order).toEqual(["1", "2"]);
        expect(r1.settlement?.txHash).toBe(MPP_TX);
        expect(r2.settlement?.txHash).toBe(MPP_TX);
      });

      it("releases the agent lock when the first payment fails", async () => {
        const events: string[] = [];
        logBuilds(events);
        const failed = () => new Response("boom", { status: 500 });

        const p1 = pay("http://api.test/one", undefined, opts(seller("1", events, challenge402(), Promise.resolve(), failed)));
        const p2 = pay("http://api.test/two", undefined, opts(seller("2", events, challenge402(), Promise.resolve())));

        await expect(p1).rejects.toMatchObject({ name: "PaymentError", kind: "unconfirmed" });
        await expect(p2).resolves.toMatchObject({ protocol: "mpp" });
      });

      it("does not serialize two different agent keys", async () => {
        const events: string[] = [];
        logBuilds(events);
        let open!: () => void;
        const gate = new Promise<void>((r) => (open = r));
        const other = Keypair.random();

        const p1 = pay("http://api.test/one", undefined, opts(seller("1", events, challenge402(), gate)));
        await tick();
        const p2 = pay("http://api.test/two", undefined, {
          ...opts(seller("2", events, challenge402(), Promise.resolve())),
          agent: other,
        });
        await expect(p2).resolves.toMatchObject({ protocol: "mpp" });
        // The other key built and settled while the first key's seller was still pending.
        expect(events).toEqual([
          "build:A",
          "paid-sent:1",
          `build:${other.publicKey().slice(0, 4)}`,
          "paid-sent:2",
          "paid-answered:2",
        ]);
        open();
        await p1;
      });

      it("does not serialize sponsored payments for one agent key", async () => {
        const events: string[] = [];
        const { simulate } = logBuilds(events);
        let open!: () => void;
        const gate = new Promise<void>((r) => (open = r));

        const p1 = pay("http://api.test/one", undefined, opts(seller("1", events, challenge402(true), gate)));
        await tick();
        const p2 = pay("http://api.test/two", undefined, opts(seller("2", events, challenge402(true), Promise.resolve())));
        await expect(p2).resolves.toMatchObject({ protocol: "mpp" });
        expect(events).toEqual(["paid-sent:1", "paid-sent:2", "paid-answered:2"]);
        // Both credentials were built and simulated (build + enforcing each).
        expect(simulate).toHaveBeenCalledTimes(4);
        open();
        await p1;
      });
    });

    describe("a paid leg that fails in transit", () => {
      for (const protocol of ["x402", "mpp"] as const) {
        it(`is unconfirmed, counted as spent and receipted as failed (${protocol})`, async () => {
          stubMppRpc();
          const { guard, commit } = spiedGuard();
          const receipts: MooringReceipt[] = [];
          const onPaymentError = vi.fn();
          const fetch = scripted(protocol === "x402" ? x402Challenge : () => mppChallengeResponse(), () => {
            throw new TypeError("fetch failed");
          });

          const err = await pay("http://api.test/weather", undefined, {
            ...opts(fetch),
            guard,
            onPaymentError,
            onReceipt: (r) => receipts.push(r),
          }).catch((e) => e);

          expect(err).toBeInstanceOf(PaymentError);
          expect(err).toMatchObject({ kind: "unconfirmed", detail: "paid request failed in transit: fetch failed" });
          expect(fetch).toHaveBeenCalledTimes(2);
          expect(commit).toHaveBeenCalledTimes(1);
          expect(commit).toHaveBeenCalledWith(expect.anything(), "settled");
          expect(onPaymentError).toHaveBeenCalledTimes(1);
          expect(onPaymentError).toHaveBeenCalledWith(err);
          expect(receipts).toHaveLength(1);
          expect(receipts[0]).toMatchObject({ protocol, status: "failed" });
          expect(receipts[0]!.reason).toMatch(/^unconfirmed: paid request failed in transit/);
          expect(await guard.snapshot(CARD)).toMatchObject({ daily: "10000", reserved: "0" });
        });
      }

      it("a transport error on the first, unpaid leg stays a plain failure", async () => {
        const onPaymentError = vi.fn();
        const fetch = scripted(() => {
          throw new TypeError("fetch failed");
        });
        const err = await pay("http://api.test/weather", undefined, { ...opts(fetch), onPaymentError }).catch(
          (e) => e,
        );
        expect(err).toBeInstanceOf(TypeError);
        expect(err).not.toBeInstanceOf(PaymentError);
        expect(onPaymentError).not.toHaveBeenCalled();
      });
    });

    describe("a guard whose commit fails", () => {
      for (const protocol of ["x402", "mpp"] as const) {
        it(`does not change a settled payment's outcome (${protocol})`, async () => {
          stubMppRpc();
          const { guard, commit } = spiedGuard();
          commit.mockRejectedValue(new Error("guard lock timed out"));
          const receipts: MooringReceipt[] = [];
          const fetch = scripted(
            protocol === "x402" ? x402Challenge : () => mppChallengeResponse(),
            protocol === "x402" ? x402Paid : mppPaid,
          );

          const result = await pay("http://api.test/weather", undefined, {
            ...opts(fetch),
            guard,
            onReceipt: (r) => receipts.push(r),
          });

          expect(result.protocol).toBe(protocol);
          expect(result.response.status).toBe(200);
          expect(result.settlement?.txHash).toBe(protocol === "x402" ? X402_TX : MPP_TX);
          expect(commit).toHaveBeenCalledTimes(1);
          expect(commit).toHaveBeenCalledWith(expect.anything(), "settled");
          expect(receipts.map((r) => r.status)).toEqual(["settled"]);
          expect(result.receipt).toEqual(receipts[0]);
        });
      }

      it("an unconfirmed payment still rethrows its own error and emits its receipt", async () => {
        stubMppRpc();
        const { guard, commit } = spiedGuard();
        commit.mockRejectedValue(new Error("guard lock timed out"));
        const receipts: MooringReceipt[] = [];
        const fetch = scripted(
          () => mppChallengeResponse(),
          () => mppChallengeResponse(),
        );

        const err = await pay("http://api.test/weather", undefined, {
          ...opts(fetch),
          guard,
          onReceipt: (r) => receipts.push(r),
        }).catch((e) => e);

        expect(err).toBeInstanceOf(PaymentError);
        expect(err.kind).toBe("unconfirmed");
        expect(commit).toHaveBeenCalledTimes(1);
        expect(commit).toHaveBeenCalledWith(expect.anything(), "settled");
        expect(receipts).toHaveLength(1);
        expect(receipts[0]).toMatchObject({ status: "failed", reason: `unconfirmed: ${err.detail}` });
      });

      it("a card denial still rethrows the denial and emits a denied receipt", async () => {
        vi.mocked(readMerchants).mockResolvedValueOnce([]);
        const { guard, commit } = spiedGuard();
        commit.mockRejectedValue(new Error("guard lock timed out"));
        const receipts: MooringReceipt[] = [];

        const err = await pay("http://api.test/weather", undefined, {
          ...opts(scripted(x402Challenge)),
          guard,
          onReceipt: (r) => receipts.push(r),
        }).catch((e) => e);

        expect(err).toBeInstanceOf(CardPolicyDenied);
        expect(commit).toHaveBeenCalledTimes(1);
        expect(commit).toHaveBeenCalledWith(expect.anything(), "denied");
        expect(receipts.map((r) => [r.status, r.reason])).toEqual([["denied", "not_allowlisted"]]);
      });
    });

    it("carries the MPP seller's refusal text into the unconfirmed detail", async () => {
      stubMppRpc();
      const fetch = scripted(
        () => mppChallengeResponse(),
        () => {
          const r = mppChallengeResponse();
          return new Response(JSON.stringify({ error: "contract authorizers cannot be verified off-chain" }), {
            status: 402,
            headers: r.headers,
          });
        },
      );

      const err = await pay("http://api.test/weather", undefined, opts(fetch)).catch((e) => e);

      expect(err).toBeInstanceOf(PaymentError);
      expect(err.kind).toBe("unconfirmed");
      expect(err.detail).toMatch(/^402 without a Payment-Receipt; settlement state unknown — seller said: /);
      expect(err.detail).toContain("contract authorizers cannot be verified off-chain");
    });

    it("carries the WWW-Authenticate error_description when the refusal has no body", async () => {
      stubMppRpc();
      const fetch = scripted(
        () => mppChallengeResponse(),
        () =>
          new Response(null, {
            status: 401,
            headers: { "WWW-Authenticate": 'Payment error="invalid_credential", error_description="auth entry expired"' },
          }),
      );

      const err = await pay("http://api.test/weather", undefined, opts(fetch)).catch((e) => e);

      expect(err).toMatchObject({ kind: "unconfirmed" });
      expect(err.detail).toBe(
        "401 without a Payment-Receipt; settlement state unknown — seller said: auth entry expired",
      );
    });

    it("truncates the seller's refusal text to 200 characters", async () => {
      stubMppRpc();
      const long = "x".repeat(500);
      const fetch = scripted(
        () => mppChallengeResponse(),
        () => new Response(`${long}\nsecond line`, { status: 400 }),
      );

      const err = await pay("http://api.test/weather", undefined, opts(fetch)).catch((e) => e);

      expect(err.detail).toBe(`400 without a Payment-Receipt; settlement state unknown — seller said: ${"x".repeat(200)}`);
    });

    describe("an MPP seller's verification refusal", () => {
      /** The card's `__check_auth` refusing, as the RPC reports it (and the seller keeps it). */
      const cardRejection = (code: number) =>
        [
          "HostError: Error(Auth, InvalidAction)",
          "",
          "Event log (newest first):",
          `   0: [Diagnostic Event] contract:${USDC_TESTNET}, topics:[error, Error(Auth, InvalidAction)], ` +
            `data:["failed account authentication with error", ${CARD}, Error(Contract, #${code})]`,
        ].join("\n");
      /** What the seller answers when it refuses a credential: mppx's problem document and a fresh challenge. */
      const refused = (reason: string, why?: string) => () =>
        new Response(
          JSON.stringify(
            new Errors.VerificationFailedError({ reason, ...(why ? { details: { why } } : {}) }).toProblemDetails("id"),
          ),
          { status: 402, headers: { ...Object.fromEntries(mppChallengeResponse().headers), "content-type": "application/problem+json" } },
        );

      it("a seller verification refusal naming the card is a CardPolicyDenied at stage verify and releases the reservation", async () => {
        stubMppRpc();
        const { guard, commit } = spiedGuard();
        const receipts: MooringReceipt[] = [];
        const onDenial = vi.fn();
        const onPaymentError = vi.fn();
        const fetch = scripted(() => mppChallengeResponse(), refused(`simulation failed: ${cardRejection(6)}`));

        const err = await pay("http://api.test/weather", undefined, {
          ...opts(fetch),
          guard,
          onDenial,
          onPaymentError,
          onReceipt: (r) => receipts.push(r),
        }).catch((e) => e);

        expect(err).toBeInstanceOf(CardPolicyDenied);
        expect(err).toMatchObject({
          reason: "not_allowlisted",
          stage: "verify",
          contractError: 6,
          merchant: { payTo: PAY_TO, amount: "10000", network: "stellar:testnet", url: "http://api.test/weather" },
        });
        expect(err.detail).toBe(
          "Payment verification failed: simulation failed: HostError: Error(Auth, InvalidAction)",
        );
        // The card and the app reach the denial: the owner gets an allow link.
        expect(err.message).toContain(`https://app.mooring.live/allow?card=${CARD}&url=`);
        expect(onDenial).toHaveBeenCalledTimes(1);
        expect(onDenial).toHaveBeenCalledWith(err);
        expect(onPaymentError).not.toHaveBeenCalled();
        expect(commit).toHaveBeenCalledTimes(1);
        expect(commit).toHaveBeenCalledWith(expect.anything(), "denied");
        expect(receipts.map((r) => [r.status, r.reason])).toEqual([["denied", "not_allowlisted"]]);
        expect(await guard.snapshot(CARD)).toMatchObject({ daily: "0", reserved: "0" });
      });

      it("a seller verification refusal for another reason is rejected as seller_refused and releases the reservation", async () => {
        stubMppRpc();
        const { guard, commit } = spiedGuard();
        const receipts: MooringReceipt[] = [];
        const onDenial = vi.fn();
        const onPaymentError = vi.fn();
        const fetch = scripted(
          () => mppChallengeResponse(),
          refused("no authorization entry authorizes the transfer", "signature does not match"),
        );

        const err = await pay("http://api.test/weather", undefined, {
          ...opts(fetch),
          guard,
          onDenial,
          onPaymentError,
          onReceipt: (r) => receipts.push(r),
        }).catch((e) => e);

        expect(err).toBeInstanceOf(PaymentError);
        expect(err.kind).toBe("rejected");
        expect(err.detail).toMatch(/^seller_refused: /);
        expect(err.detail).toBe(
          "seller_refused: Payment verification failed: no authorization entry authorizes the transfer.",
        );
        expect(onDenial).not.toHaveBeenCalled();
        expect(onPaymentError).toHaveBeenCalledTimes(1);
        expect(onPaymentError).toHaveBeenCalledWith(err);
        expect(commit).toHaveBeenCalledTimes(1);
        expect(commit).toHaveBeenCalledWith(expect.anything(), "failed");
        expect(receipts.map((r) => [r.status, r.reason])).toEqual([["failed", err.detail]]);
        expect(await guard.snapshot(CARD)).toMatchObject({ daily: "0", total: "0", reserved: "0" });
      });

      it("caps a seller_refused detail at 200 characters of the refusal", async () => {
        stubMppRpc();
        const fetch = scripted(() => mppChallengeResponse(), refused(`simulation failed: ${"y".repeat(500)}`));

        const err = await pay("http://api.test/weather", undefined, opts(fetch)).catch((e) => e);

        expect(err).toMatchObject({ kind: "rejected" });
        expect(err.detail).toBe(
          `seller_refused: ${`Payment verification failed: simulation failed: ${"y".repeat(500)}`.slice(0, 200)}`,
        );
      });

      it("a non-OK paid response without the verification marker is still unconfirmed and counted as spent", async () => {
        stubMppRpc();
        const { guard, commit } = spiedGuard();
        const onPaymentError = vi.fn();
        const fetch = scripted(
          () => mppChallengeResponse(),
          () =>
            new Response(JSON.stringify(new Errors.CredentialReplayedError().toProblemDetails("id")), {
              status: 402,
              headers: mppChallengeResponse().headers,
            }),
        );

        const err = await pay("http://api.test/weather", undefined, { ...opts(fetch), guard, onPaymentError }).catch(
          (e) => e,
        );

        expect(err).toBeInstanceOf(PaymentError);
        expect(err.kind).toBe("unconfirmed");
        expect(err.detail).toContain("Credential has already been used");
        expect(onPaymentError).toHaveBeenCalledTimes(1);
        expect(commit).toHaveBeenCalledWith(expect.anything(), "settled");
        expect(await guard.snapshot(CARD)).toMatchObject({ daily: "10000", total: "10000", reserved: "0" });
      });

      it("a refusal after broadcast that leaves the outcome open stays unconfirmed", async () => {
        stubMppRpc();
        const { guard, commit } = spiedGuard();
        const fetch = scripted(() => mppChallengeResponse(), refused(`transaction not confirmed: ${MPP_TX}`));

        const receipts: MooringReceipt[] = [];
        const err = await pay("http://api.test/weather", undefined, {
          ...opts(fetch),
          guard,
          onReceipt: (r) => receipts.push(r),
        }).catch((e) => e);

        expect(err).toMatchObject({ kind: "unconfirmed", transaction: MPP_TX });
        // The full 64-hex hash survives, decoded from the problem detail.
        expect(err.detail).toContain(`transaction not confirmed: ${MPP_TX}`);
        expect(commit).toHaveBeenCalledWith(expect.anything(), "settled");
        expect(receipts).toHaveLength(1);
        expect(receipts[0]).toMatchObject({ status: "failed", txHash: MPP_TX });
        expect(receipts[0]!.reason).toContain(MPP_TX);
      });

      it("a refusal naming a transport failure before acceptance stays unconfirmed without a hash", async () => {
        stubMppRpc();
        const { guard, commit } = spiedGuard();
        const fetch = scripted(() => mppChallengeResponse(), refused("transaction was not accepted: fetch failed"));

        const err = await pay("http://api.test/weather", undefined, { ...opts(fetch), guard }).catch((e) => e);

        expect(err).toMatchObject({ kind: "unconfirmed" });
        expect(err.transaction).toBeUndefined();
        expect(err.detail).toContain("transaction was not accepted: fetch failed");
        expect(commit).toHaveBeenCalledWith(expect.anything(), "settled");
      });

      it("a refusal saying the network rejected the envelope is seller_refused and releases the reservation", async () => {
        stubMppRpc();
        const { guard, commit } = spiedGuard();
        const fetch = scripted(
          () => mppChallengeResponse(),
          refused("transaction rejected by the network: tx_insufficient_fee"),
        );

        const err = await pay("http://api.test/weather", undefined, { ...opts(fetch), guard }).catch((e) => e);

        expect(err).toBeInstanceOf(PaymentError);
        expect(err.kind).toBe("rejected");
        expect(err.detail).toBe(
          "seller_refused: Payment verification failed: transaction rejected by the network: tx_insufficient_fee.",
        );
        expect(commit).toHaveBeenCalledWith(expect.anything(), "failed");
        expect(await guard.snapshot(CARD)).toMatchObject({ daily: "0", total: "0", reserved: "0" });
      });
    });

    describe("a POST body", () => {
      for (const protocol of ["x402", "mpp"] as const) {
        it(`is sent with the method on both legs (${protocol})`, async () => {
          stubMppRpc();
          const seen: Array<{ method: string; body: string }> = [];
          const replies = [
            protocol === "x402" ? x402Challenge : () => mppChallengeResponse(),
            protocol === "x402" ? x402Paid : mppPaid,
          ];
          const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const req = new Request(input, init);
            seen.push({ method: req.method, body: await req.text() });
            return replies.shift()!();
          });

          const result = await pay(
            "http://api.test/quote",
            { method: "POST", body: JSON.stringify({ q: 1 }), headers: { "content-type": "application/json" } },
            opts(fetch as typeof globalThis.fetch),
          );

          expect(result.protocol).toBe(protocol);
          expect(seen).toEqual([
            { method: "POST", body: '{"q":1}' },
            { method: "POST", body: '{"q":1}' },
          ]);
        });
      }
    });

    it("an MPP charge for another network is not_payable", async () => {
      const { simulate } = stubMppRpc();
      const onPaymentError = vi.fn();
      const challenge = Challenge.fromMethod(chargeMethod, {
        secretKey: "test",
        realm: "api.mooring.live",
        request: {
          amount: "10000",
          currency: USDC_TESTNET,
          recipient: PAY_TO,
          methodDetails: { network: "stellar:pubnet", credentialTypes: ["transaction"] },
        },
      });
      const fetch = scripted(
        () => new Response(null, { status: 402, headers: { "WWW-Authenticate": Challenge.serialize(challenge) } }),
      );

      const err = await pay("http://api.test/weather", undefined, { ...opts(fetch), onPaymentError }).catch(
        (e) => e,
      );

      expect(err).toBeInstanceOf(PaymentError);
      expect(err.kind).toBe("rejected");
      expect(err.detail).toMatch(/^not_payable: mpp /);
      expect(onPaymentError).toHaveBeenCalledWith(err);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(simulate).not.toHaveBeenCalled();
    });

    it("a free response produces no receipt", async () => {
      const onReceipt = vi.fn();
      const fetch = scripted(() => new Response("free", { status: 200 }));
      const result = await pay("http://api.test/free", undefined, { ...opts(fetch), onReceipt });
      expect(result.receipt).toBeNull();
      expect(onReceipt).not.toHaveBeenCalled();
    });
  });
});
