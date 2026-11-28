import { decodePaymentRequiredHeader } from "@x402/core/http";
import { Receipt as MppReceipt } from "mppx";
import { Mppx } from "mppx/client/core";
import { payX402, type MooringClientOptions, type X402Paid } from "./client.js";
import { CardPolicyDenied, GuardDenied, PaymentError, isAbsoluteHttpUrl, stripQuery } from "./denial.js";
import { deploymentFor } from "./deployments.js";
import { formatUsdc } from "./guard/config.js";
import type { Guard, GuardTerms, Reservation } from "./guard/types.js";
import { withAgentLock } from "./mpp/agent-lock.js";
import { cardChargeMethod, isSequenceConflict, isSequenceConflictError, sequenceConflict } from "./mpp/charge.js";
import { detectProtocol, selectChargeChallenge } from "./mpp/detect.js";
import type { ChargeRequest } from "./mpp/schema.js";
import { receiptId, signReceipt, type Receipt } from "./receipts.js";

export interface PayOptions extends MooringClientOptions {
  /** The transport (default `globalThis.fetch`). */
  fetch?: typeof globalThis.fetch;
  /** The USDC SAC address MPP charges must be in (default: the network's Mooring deployment). */
  usdc?: string;
  /**
   * Local caps and stop switch, decided before the agent key signs anything.
   * A refusal rejects with `GuardDenied`, which reaches neither `onDenial`
   * (the card's refusals only) nor `onPaymentError`.
   */
  guard?: Guard;
  /**
   * Called with the agent-signed receipt of every payment attempt that got as
   * far as known terms — settled, denied (by the guard or the card) or failed.
   * A throwing callback does not change the payment's outcome.
   */
  onReceipt?: (r: Receipt) => void;
}

export interface PayResult {
  response: Response;
  /** Which protocol paid; `none` when the seller did not ask for payment. */
  protocol: "x402" | "mpp" | "none";
  /** What was paid, or `null` when nothing was (or the seller did not report it). */
  settlement: { txHash: string; amount: string; payTo: string; asset: string; network: string } | null;
  /** The agent-signed receipt of the payment; `null` when nothing was paid. */
  receipt: Receipt | null;
}

/**
 * Requests `url` and, when the seller answers 402, pays it from the card with
 * whichever protocol the 402 asks for: x402 (`PAYMENT-REQUIRED`) or an MPP
 * Stellar charge (`WWW-Authenticate: Payment`). The seller's 402 is reused in
 * both cases, so a paid request costs exactly two round trips.
 *
 * With a `guard`, the stop switch is read as soon as the 402 names its
 * protocol and the caps are reserved against with the selected terms, both
 * before the agent key signs anything; the reservation is committed with the
 * outcome. Every attempt with known terms is reported to `onReceipt`.
 *
 * Rejects with `GuardDenied` when the guard refuses, `CardPolicyDenied` when
 * the card's policy refuses and
 * `PaymentError` for every payment failure — a 402 that carries neither
 * protocol's terms, unreadable x402 terms, or no offer the card can pay is
 * `rejected` with a `not_payable` detail — never with a bare 402. Errors that
 * are not payment outcomes (the transport itself failing, an RPC the card
 * cannot reach while signing) propagate unchanged.
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

  const protocol = detectProtocol(first);
  if (protocol === null) {
    if (first.status === 402) {
      return fail(new PaymentError({ kind: "rejected", detail: "not_payable: 402 without x402 or MPP terms" }));
    }
    return { response: first, protocol: "none", settlement: null, receipt: null };
  }

  const attempt: { terms?: GuardTerms; reservation?: Reservation } = {};
  const receipt = (
    status: Receipt["status"],
    extra: { txHash?: string; reason?: string },
  ): Receipt | null => {
    const t = attempt.terms;
    if (!t) return null;
    const signed = signReceipt(
      {
        v: 1,
        id: receiptId(),
        ts: new Date().toISOString(),
        protocol,
        card: opts.card,
        agent: opts.agent.publicKey(),
        payTo: t.payTo,
        amount: t.amount,
        asset: t.asset,
        network: t.network,
        ...(t.url ? { url: t.url } : {}),
        status,
        ...extra,
      },
      opts.agent,
    );
    try {
      opts.onReceipt?.(signed);
    } catch {
      /* the receipt sink's failure is not the payment's */
    }
    return signed;
  };

  try {
    if (opts.guard && (await opts.guard.isStopped(opts.card))) {
      // Stopped: refuse before any protocol work. The terms are read from the
      // 402's headers (or JSON body) only, for the guard's verdict and the receipt.
      attempt.terms = await peekTerms(protocol, first, opts, requestUrl);
      const blank = { card: opts.card, payTo: "", amount: "0", asset: "", network: opts.network };
      throw (
        (await opts.guard.check(attempt.terms ?? blank)) ??
        new GuardDenied("stopped", { card: opts.card, attempted: formatUsdc(attempt.terms?.amount ?? "0") })
      );
    }

    /** Validates the terms and reserves them against the guard's caps. */
    const reserve = async (t: GuardTerms): Promise<void> => {
      if (typeof t.amount !== "string" || !/^\d+$/.test(t.amount)) {
        throw new PaymentError({
          kind: "rejected",
          detail: `malformed_terms: amount must be a base-unit integer (got ${String(t.amount)})`,
        });
      }
      attempt.terms = t;
      if (opts.guard) attempt.reservation = await opts.guard.reserve(t);
    };

    const { response, settlement } =
      protocol === "x402"
        ? await payX402(opts, transport, request, first, requestUrl, (req) =>
            reserve({
              card: opts.card,
              payTo: req.payTo,
              amount: req.amount,
              asset: req.asset,
              network: req.network,
              ...(requestUrl ? { url: requestUrl } : {}),
            }),
          )
        : await payMpp(opts, transport, request, first, requestUrl, fail, reserve);

    if (attempt.reservation) await opts.guard!.commit(attempt.reservation, "settled");
    return {
      response,
      protocol,
      settlement,
      receipt: receipt("settled", settlement?.txHash ? { txHash: settlement.txHash } : {}),
    };
  } catch (err) {
    const denied = err instanceof GuardDenied || err instanceof CardPolicyDenied;
    const status = denied ? "denied" : "failed";
    // An unconfirmed settlement may have debited the card: count it as spent
    // (over-counting is the safe direction for a cap), report it as failed.
    const unconfirmed = err instanceof PaymentError && err.kind === "unconfirmed";
    if (attempt.reservation) await opts.guard!.commit(attempt.reservation, unconfirmed ? "settled" : status);
    if (unconfirmed) {
      receipt("failed", {
        reason: `unconfirmed: ${err.detail ?? ""}`,
        ...(err.transaction ? { txHash: err.transaction } : {}),
      });
      throw err;
    }
    const reason = denied
      ? err.reason
      : err instanceof PaymentError
        ? err.detail
        : err instanceof Error
          ? err.message
          : String(err);
    receipt(status, reason ? { reason } : {});
    throw err;
  }
}

/**
 * The terms a 402 asks for, read without any protocol work: the first Stellar
 * charge challenge (MPP), or the x402 `accepts` entry for the card's network
 * from `PAYMENT-REQUIRED` or the JSON body. `undefined` when unreadable.
 */
async function peekTerms(
  protocol: "x402" | "mpp",
  first: Response,
  opts: PayOptions,
  requestUrl: string | undefined,
): Promise<GuardTerms | undefined> {
  const url = requestUrl ? { url: requestUrl } : {};
  try {
    if (protocol === "mpp") {
      const charge = selectChargeChallenge(first)?.request as ChargeRequest | undefined;
      if (!charge) return undefined;
      return {
        card: opts.card,
        payTo: charge.recipient,
        amount: charge.amount,
        asset: charge.currency,
        network: charge.methodDetails?.network ?? opts.network,
        ...url,
      };
    }
    const header = first.headers.get("PAYMENT-REQUIRED");
    const terms = (header ? decodePaymentRequiredHeader(header) : await first.clone().json()) as {
      accepts?: Array<{ network?: string; amount?: string; maxAmountRequired?: string; payTo?: string; asset?: string }>;
    };
    const offer = terms.accepts?.find((a) => a.network === opts.network);
    const amount = offer?.amount ?? offer?.maxAmountRequired;
    if (!offer || !amount || !offer.payTo || !offer.asset) return undefined;
    return { card: opts.card, payTo: offer.payTo, amount, asset: offer.asset, network: offer.network!, ...url };
  } catch {
    return undefined;
  }
}

/**
 * Pays an MPP charge. A `sequence_conflict` (the agent account's sequence
 * moved under an unsponsored payment: `txBAD_SEQ` from the simulation or the
 * seller) means the transaction was not applied, so the payment is retried
 * once from a fresh credential under the same reservation.
 */
async function payMpp(
  opts: PayOptions,
  transport: typeof globalThis.fetch,
  request: Request,
  first: Response,
  requestUrl: string | undefined,
  fail: (error: PaymentError) => never,
  reserve: (t: GuardTerms) => Promise<void>,
): Promise<X402Paid> {
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
        // A sequence conflict may be retried; it is reported once, below,
        // only when it is the outcome.
        onPaymentError: (e) => {
          if (!isSequenceConflictError(e)) opts.onPaymentError?.(e);
        },
      }),
    ],
    polyfill: false,
    fetch: transport,
  });

  // `preparePayment` selects the challenge from the 402 already in hand, so
  // the seller is not asked for terms a second time.
  const headers = new Headers(request.headers);

  /** One paid attempt: sign the credential, send it, read the receipt. Throws `sequence_conflict` unreported. */
  const settle = async (
    payment: Awaited<ReturnType<typeof mppx.preparePayment>>,
    charge: ChargeRequest,
  ): Promise<X402Paid> => {
    // The charge method reports its own denials and errors to the callbacks.
    const credential = await payment.createCredential();
    const paidInit = payment.setCredential({ headers }, credential);
    const response = await transport(new Request(request.clone(), paidInit));

    if (!response.ok) {
      // Read from a clone, so the caller's response keeps its body.
      const body = await response.clone().text().catch(() => "");
      if (isSequenceConflict(`${body}\n${response.headers.get("WWW-Authenticate") ?? ""}`)) {
        // Not applied: the network refused the sequence, nothing was spent.
        throw sequenceConflict(`seller answered ${response.status}`);
      }
    }

    let receipt;
    try {
      if (response.status === 402) throw new Error("the seller asked for payment again");
      receipt = MppReceipt.fromResponse(response);
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

    return {
      response,
      settlement: {
        txHash: receipt.reference,
        amount: charge.amount,
        payTo: charge.recipient,
        asset: charge.currency,
        network: charge.methodDetails?.network ?? opts.network,
      },
    };
  };

  const prepare = async () => {
    try {
      return await mppx.preparePayment(first, { request: { headers } });
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
  };

  // Selecting the challenge reads no chain state; the sequence is read when
  // the credential is created, inside the lock below.
  let payment = await prepare();
  const charge = payment.challenge.request as ChargeRequest;
  try {
    await reserve({
      card: opts.card,
      payTo: charge.recipient,
      amount: charge.amount,
      asset: charge.currency,
      network: charge.methodDetails?.network ?? opts.network,
      ...(requestUrl ? { url: requestUrl } : {}),
    });
  } catch (err) {
    if (err instanceof PaymentError) return fail(err);
    throw err;
  }

  const run = async (): Promise<X402Paid> => {
    for (let attempt = 1; ; attempt++) {
      if (attempt > 1) payment = await prepare();
      try {
        return await settle(payment, charge);
      } catch (err) {
        if (!isSequenceConflictError(err)) throw err;
        if (attempt === 1) continue;
        return fail(err);
      }
    }
  };

  // Unsponsored, the agent account is the source and its sequence is consumed
  // only when the seller broadcasts: one payment per agent key, held from the
  // credential's build until the seller's answer (retry included). A
  // sponsored envelope's source is the placeholder, so it takes no lock.
  return charge.methodDetails?.feePayer === true ? run() : withAgentLock(opts.agent.publicKey(), run);
}
