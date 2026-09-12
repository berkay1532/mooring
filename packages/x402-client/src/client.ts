import type { Keypair } from "@stellar/stellar-sdk";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import type { PaymentRequirements } from "@x402/fetch";
import { getNetworkPassphrase, getRpcUrl } from "@x402/stellar";
import { readCardInfo, readMerchants } from "./card.js";
import {
  CARD_ERROR_CODES,
  CardPolicyDenied,
  PaymentError,
  cardDenialFromEvents,
  classifyContractError,
  type DenialReason,
  type DenialStage,
} from "./denial.js";
import { precheck } from "./precheck.js";
import { reconcileSettlement } from "./reconcile.js";
import { CardExactStellarScheme, type StellarNetwork } from "./scheme.js";

export interface MooringClientOptions {
  card: string;
  agent: Keypair;
  network: StellarNetwork;
  rpcUrl?: string;
  /** Run the local policy pre-check before signing (default true). */
  precheck?: boolean;
  /** Called whenever the card's policy denies a payment, at any stage. */
  onDenial?: (denial: CardPolicyDenied) => void;
  /** Called whenever a payment fails for a reason that is *not* the card's policy. */
  onPaymentError?: (error: PaymentError) => void;
}

export interface Settlement {
  success: boolean;
  transaction: string;
  network: string;
  payer?: string;
  errorReason?: string;
}

/** Everything `createMooringFetch` can reject with. */
type PaymentFailure = CardPolicyDenied | PaymentError;

/**
 * Internal: the last failure recorded by the hooks, so the fetch wrapper can
 * rethrow it typed. `@x402/fetch` turns an aborted payment into a generic
 * `Error` and returns verify/settle failures as a plain 402 response, so the
 * hooks are the only place where the reason survives.
 */
class FailureBox {
  last?: PaymentFailure;
  set(failure: PaymentFailure, opts: MooringClientOptions): void {
    this.last = failure;
    if (failure instanceof CardPolicyDenied) opts.onDenial?.(failure);
    else opts.onPaymentError?.(failure);
  }
}

/**
 * Builds an x402 client that pays from a Mooring card.
 *
 * The card enforces the budget, allowlist and expiry on-chain; this client
 * mirrors that policy locally so an over-limit payment is refused before the
 * agent key signs anything, and classifies every other outcome into
 * `CardPolicyDenied` (the card's policy refused) or `PaymentError` (anything
 * else).
 *
 * **One instance is single-flight.** x402's hook contexts carry no request
 * identity, so the failure recorded by one payment cannot be told apart from
 * another's: do not run concurrent payments through the same client. Build one
 * per payment, or use `createMooringFetch`, which does that for you.
 *
 * Used directly, the returned `x402Client` still throws x402's own generic
 * errors and hands back bare 402 responses: only `onDenial` / `onPaymentError`
 * surface the typed reason. `createMooringFetch` is what turns them into
 * thrown `CardPolicyDenied` / `PaymentError`.
 */
export function createMooringClient(
  opts: MooringClientOptions,
  box: FailureBox = new FailureBox(),
): x402Client {
  const rpcUrl = getRpcUrl(opts.network, opts.rpcUrl ? { url: opts.rpcUrl } : undefined);
  const passphrase = getNetworkPassphrase(opts.network);
  const scheme = new CardExactStellarScheme({
    card: opts.card,
    agent: opts.agent,
    network: opts.network,
    rpcUrl: opts.rpcUrl,
    // A failure raised inside the scheme (the card refusing the enforcing
    // simulation, or the CAP-71 credential guard) travels out as a thrown
    // error, but it must reach the hooks and the box like every other stage.
    onDenial: (denial) => box.set(denial, opts),
    onPaymentError: (error) => box.set(error, opts),
  });

  const evaluate = async (req: PaymentRequirements): Promise<DenialReason | null> => {
    const [info, merchants] = await Promise.all([
      readCardInfo(rpcUrl, passphrase, opts.card),
      readMerchants(rpcUrl, passphrase, opts.card),
    ]);
    return precheck(
      info,
      merchants,
      { payTo: req.payTo, amount: req.amount, asset: req.asset },
      Math.floor(Date.now() / 1000),
    );
  };

  /**
   * Classifies a refusal that happened *before* anything was submitted.
   *
   * The facilitator does not say whose rule it applied, so the card is asked
   * instead: if the card's own state explains the refusal it is a policy
   * denial, and `simulation_failed` is policy-shaped too (a card denial is a
   * simulation failure — that is the whole of finding the reason on-chain, and
   * a race can produce one the re-run pre-check no longer sees). Every other
   * reason the facilitator can give — a malformed payload, a fee above its
   * ceiling, an expiration too far out — is not the card's verdict and must
   * not be reported as one.
   */
  const classifyRefusal = async (
    stage: DenialStage,
    text: string,
    req: PaymentRequirements,
  ): Promise<PaymentFailure> => {
    const parsed = classifyContractError(text);
    if (parsed && parsed.code in CARD_ERROR_CODES) {
      return new CardPolicyDenied(parsed.reason, stage, {
        contractError: parsed.code,
        detail: text || undefined,
      });
    }
    let reason: DenialReason | null = null;
    try {
      reason = await evaluate(req);
    } catch {
      /* the card could not be read; fall through to the reason string */
    }
    if (reason) return new CardPolicyDenied(reason, stage, { detail: text || undefined });
    if (text.includes("simulation_failed")) {
      return new CardPolicyDenied("unknown", stage, { detail: text || undefined });
    }
    return new PaymentError({ kind: "rejected", detail: text || undefined });
  };

  /**
   * Decides what a failed settlement means, by asking the ledger.
   *
   * A settle failure that carries a transaction hash is *not* evidence the
   * payment did not happen: the facilitator returns the same
   * `settle_exact_stellar_transaction_failed` when its poll times out, and
   * inclusion can follow that answer. So the hash is reconciled before the
   * failure is named — a transaction the ledger accepted is never reported as
   * a policy denial, however the server described it.
   */
  const classifySettleFailure = async (
    settle: Settlement,
    req: PaymentRequirements,
  ): Promise<PaymentFailure> => {
    const reason = settle.errorReason ?? "settle failed";
    const hash = settle.transaction;
    if (!hash) return classifyRefusal("settle", reason, req);

    let outcome;
    try {
      outcome = await reconcileSettlement(rpcUrl, opts.network, hash);
    } catch (err) {
      return new PaymentError({
        kind: "unconfirmed",
        transaction: hash,
        detail: `${reason}; reconciliation failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    if (outcome.status === "SUCCESS") {
      return new PaymentError({
        kind: "unconfirmed",
        transaction: hash,
        detail: "settled on-chain but the server reported failure; reconcile",
      });
    }
    if (outcome.status === "NOT_FOUND") {
      return new PaymentError({
        kind: "unconfirmed",
        transaction: hash,
        detail: `${reason}; not observed on-chain within the reconciliation window`,
      });
    }
    const parsed = cardDenialFromEvents(outcome.events, opts.card);
    return new CardPolicyDenied(parsed?.reason ?? "unknown", "settle", {
      contractError: parsed?.code,
      detail: `${reason} tx=${hash}`,
    });
  };

  const client = x402Client.fromConfig({
    schemes: [{ network: opts.network, client: scheme }],
    // The card enforces limits on-chain; x402's USD-based client caps would only get in the way.
    spendControls: false,
  });

  client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
    if (opts.precheck === false) return;
    let reason: DenialReason | null;
    try {
      reason = await evaluate(selectedRequirements);
    } catch (err) {
      // Fail closed: a card we cannot read is a card we cannot spend from.
      const detail = `pre-check unavailable: ${err instanceof Error ? err.message : String(err)}`;
      box.set(new CardPolicyDenied("unknown", "precheck", { detail }), opts);
      return { abort: true, reason: detail };
    }
    if (reason) {
      box.set(new CardPolicyDenied(reason, "precheck"), opts);
      return { abort: true, reason };
    }
  });

  client.onPaymentResponse(async ({ requirements, settleResponse, paymentRequired, error }) => {
    if (settleResponse && !settleResponse.success) {
      box.set(await classifySettleFailure(settleResponse as Settlement, requirements), opts);
      return;
    }
    if (paymentRequired && !settleResponse) {
      // Verify failed. The facilitator does not say why; ask the card.
      const text = paymentRequired.error ?? error?.message ?? "";
      box.set(await classifyRefusal("verify", text, requirements), opts);
    }
  });

  return client;
}

/**
 * A `fetch` that pays x402-protected requests from the card, and rejects with
 * `CardPolicyDenied` (the card's policy refused) or `PaymentError` (anything
 * else) — never a bare 402 — whenever the payment does not deliver the
 * resource. Failed payments are never retried.
 *
 * Each call builds its own client and failure scope — `x402Client.fromConfig`
 * does no I/O — so concurrent requests through the same returned `fetch` cannot
 * observe each other's failures.
 */
export function createMooringFetch(
  opts: MooringClientOptions & { fetch?: typeof globalThis.fetch },
): typeof globalThis.fetch {
  const transport = opts.fetch ?? globalThis.fetch;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const box = new FailureBox();
    const wrapped = wrapFetchWithPayment(transport, createMooringClient(opts, box));
    try {
      const res = await wrapped(input, init);
      // Verify and settle failures come back as a non-2xx response, not a
      // throw; the hooks have recorded why, so surface it typed.
      if (box.last) throw box.last;
      const settlement = getSettlement(res);
      if (settlement && !settlement.success) {
        // The hooks classify every settlement they see; reaching here means
        // the header said "failed" without the hook firing, so the settlement
        // state is exactly as unknown as the header is unexplained.
        box.set(
          new PaymentError({
            kind: "unconfirmed",
            transaction: settlement.transaction || undefined,
            detail: settlement.errorReason ?? "settle failed",
          }),
          opts,
        );
        throw box.last!;
      }
      if (res.status === 402) {
        // The payment was made and the resource still withheld, with nothing
        // in the response to say what happened to it. `@x402/express` answers
        // exactly this from its settlement path, *after* the facilitator may
        // have submitted — so this is an unknown settlement, not a denial.
        box.set(
          new PaymentError({
            kind: "unconfirmed",
            detail: "402 without PAYMENT-REQUIRED or PAYMENT-RESPONSE; settlement state unknown",
          }),
          opts,
        );
        throw box.last!;
      }
      return res;
    } catch (err) {
      // A pre-check abort reaches us as a generic Error from @x402/fetch.
      if (err instanceof CardPolicyDenied || err instanceof PaymentError) throw err;
      if (box.last) throw box.last;
      throw err;
    }
  }) as typeof globalThis.fetch;
}

/**
 * Decodes the PAYMENT-RESPONSE header of a paid response. Returns `null` when
 * the header is absent or undecodable — a settlement we cannot read is not a
 * failed payment, and must never turn a 200 into an error.
 */
export function getSettlement(res: Response): Settlement | null {
  const header = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
  if (!header) return null;
  try {
    return decodePaymentResponseHeader(header) as Settlement;
  } catch {
    return null;
  }
}
