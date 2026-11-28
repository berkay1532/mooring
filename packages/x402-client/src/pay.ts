import { Receipt } from "mppx";
import { Mppx } from "mppx/client/core";
import { payX402, type MooringClientOptions } from "./client.js";
import { PaymentError, isAbsoluteHttpUrl, stripQuery } from "./denial.js";
import { deploymentFor } from "./deployments.js";
import { cardChargeMethod } from "./mpp/charge.js";
import { detectProtocol } from "./mpp/detect.js";
import type { ChargeRequest } from "./mpp/schema.js";

export interface PayOptions extends MooringClientOptions {
  /** The transport (default `globalThis.fetch`). */
  fetch?: typeof globalThis.fetch;
  /** The USDC SAC address MPP charges must be in (default: the network's Mooring deployment). */
  usdc?: string;
}

export interface PayResult {
  response: Response;
  /** Which protocol paid; `none` when the seller did not ask for payment. */
  protocol: "x402" | "mpp" | "none";
  /** What was paid, or `null` when nothing was (or the seller did not report it). */
  settlement: { txHash: string; amount: string; payTo: string; asset: string; network: string } | null;
  /** Reserved for the signed receipt ledger. */
  receipt: null;
}

/**
 * Requests `url` and, when the seller answers 402, pays it from the card with
 * whichever protocol the 402 asks for: x402 (`PAYMENT-REQUIRED`) or an MPP
 * Stellar charge (`WWW-Authenticate: Payment`). The seller's 402 is reused in
 * both cases, so a paid request costs exactly two round trips.
 *
 * Rejects with `CardPolicyDenied` when the card's policy refuses and
 * `PaymentError` for everything else — including a 402 that carries neither
 * protocol's terms — never with a bare 402.
 */
export function pay(url: string | URL, init: RequestInit | undefined, opts: PayOptions): Promise<PayResult> {
  return payRequest(url, init, opts);
}

/** Internal: `pay()` for any fetch input (`createMooringFetch` also accepts a `Request`). */
export async function payRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  opts: PayOptions,
): Promise<PayResult> {
  const transport = opts.fetch ?? globalThis.fetch;
  // Only an absolute http(s) URL can become an allow link; anything else
  // (a relative path, another scheme) is left off the denial entirely. Read
  // from the caller's input, not the resolved Request.
  const rawUrl = input instanceof Request ? input.url : String(input);
  const requestUrl = isAbsoluteHttpUrl(rawUrl) ? stripQuery(rawUrl) : undefined;
  // One Request for the whole exchange, so a body can be sent twice: the
  // first leg and every paid leg send a clone.
  const request = new Request(input, init);
  const first = await transport(request.clone());

  const fail = (error: PaymentError): never => {
    opts.onPaymentError?.(error);
    throw error;
  };

  switch (detectProtocol(first)) {
    case "x402": {
      const { response, settlement } = await payX402(opts, transport, request, first, requestUrl);
      return { response, protocol: "x402", settlement, receipt: null };
    }
    case "mpp":
      return payMpp(opts, transport, request, first, requestUrl, fail);
    default:
      if (first.status === 402) {
        return fail(new PaymentError({ kind: "rejected", detail: "not_payable: 402 without x402 or MPP terms" }));
      }
      return { response: first, protocol: "none", settlement: null, receipt: null };
  }
}

async function payMpp(
  opts: PayOptions,
  transport: typeof globalThis.fetch,
  request: Request,
  first: Response,
  requestUrl: string | undefined,
  fail: (error: PaymentError) => never,
): Promise<PayResult> {
  const mppx = Mppx.create({
    methods: [
      cardChargeMethod({
        card: opts.card,
        agent: opts.agent,
        network: opts.network,
        rpcUrl: opts.rpcUrl,
        appUrl: opts.appUrl,
        requestUrl,
        precheck: opts.precheck,
        usdc: opts.usdc ?? deploymentFor(opts.network).usdc,
        onDenial: opts.onDenial,
        onPaymentError: opts.onPaymentError,
      }),
    ],
    polyfill: false,
    fetch: transport,
  });

  // `preparePayment` selects the challenge from the 402 already in hand, so
  // the seller is not asked for terms a second time.
  const headers = new Headers(request.headers);
  let payment;
  try {
    payment = await mppx.preparePayment(first, { request: { headers } });
  } catch (err) {
    // No configured method can pay this challenge (another network, say):
    // nothing was signed or spent.
    return fail(
      new PaymentError({
        kind: "rejected",
        detail: `mpp_unpayable: ${err instanceof Error ? err.message : String(err)}`,
      }),
    );
  }
  // The charge method reports its own denials and errors to the callbacks.
  const credential = await payment.createCredential();
  const paidInit = payment.setCredential({ headers }, credential);
  const response = await transport(new Request(request.clone(), paidInit));

  let receipt;
  try {
    if (response.status === 402) throw new Error("the seller asked for payment again");
    receipt = Receipt.fromResponse(response);
  } catch (err) {
    // The credential was handed over and may have been broadcast; without a
    // receipt the settlement state is unknown.
    return fail(
      new PaymentError({
        kind: "unconfirmed",
        detail: `${response.status} without a Payment-Receipt; settlement state unknown (${err instanceof Error ? err.message : String(err)})`,
      }),
    );
  }

  const charge = payment.challenge.request as ChargeRequest;
  return {
    response,
    protocol: "mpp",
    settlement: {
      txHash: receipt.reference,
      amount: charge.amount,
      payTo: charge.recipient,
      asset: charge.currency,
      network: charge.methodDetails?.network ?? opts.network,
    },
    receipt: null,
  };
}
