import type { Keypair } from "@stellar/stellar-sdk";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import type { PaymentRequirements } from "@x402/fetch";
import { getNetworkPassphrase, getRpcUrl } from "@x402/stellar";
import { readCardInfo, readMerchants } from "./card.js";
import { CardPolicyDenied, classifyContractError, type DenialReason } from "./denial.js";
import { precheck } from "./precheck.js";
import { CardExactStellarScheme, type StellarNetwork } from "./scheme.js";

export interface MooringClientOptions {
  card: string;
  agent: Keypair;
  network: StellarNetwork;
  rpcUrl?: string;
  /** Run the local policy pre-check before signing (default true). */
  precheck?: boolean;
  /** Called whenever a payment is denied, at any stage. */
  onDenial?: (denial: CardPolicyDenied) => void;
}

export interface Settlement {
  success: boolean;
  transaction: string;
  network: string;
  payer?: string;
  errorReason?: string;
}

/**
 * Internal: the last denial recorded by the hooks, so the fetch wrapper can
 * rethrow it typed. `@x402/fetch` turns an aborted payment into a generic
 * `Error` and returns verify/settle failures as a plain 402 response, so the
 * hooks are the only place where the reason survives.
 */
class DenialBox {
  last?: CardPolicyDenied;
  set(d: CardPolicyDenied, onDenial?: (d: CardPolicyDenied) => void): void {
    this.last = d;
    onDenial?.(d);
  }
}

/**
 * Builds an x402 client that pays from a Mooring card.
 *
 * The card enforces the budget, allowlist and expiry on-chain; this client
 * mirrors that policy locally so an over-limit payment is refused before the
 * agent key signs anything, and classifies facilitator failures into
 * `CardPolicyDenied`.
 *
 * **One instance is single-flight.** x402's hook contexts carry no request
 * identity, so the denial recorded by one payment cannot be told apart from
 * another's: do not run concurrent payments through the same client. Build one
 * per payment, or use `createMooringFetch`, which does that for you.
 */
export function createMooringClient(
  opts: MooringClientOptions,
  box: DenialBox = new DenialBox(),
): x402Client {
  const rpcUrl = getRpcUrl(opts.network, opts.rpcUrl ? { url: opts.rpcUrl } : undefined);
  const passphrase = getNetworkPassphrase(opts.network);
  const scheme = new CardExactStellarScheme({
    card: opts.card,
    agent: opts.agent,
    network: opts.network,
    rpcUrl: opts.rpcUrl,
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
      box.set(new CardPolicyDenied("unknown", "precheck", { detail }), opts.onDenial);
      return { abort: true, reason: detail };
    }
    if (reason) {
      box.set(new CardPolicyDenied(reason, "precheck"), opts.onDenial);
      return { abort: true, reason };
    }
  });

  client.onPaymentResponse(async ({ requirements, settleResponse, paymentRequired, error }) => {
    if (settleResponse && !settleResponse.success) {
      const parsed = classifyContractError(
        settleResponse.errorMessage ?? settleResponse.errorReason ?? "",
      );
      box.set(
        new CardPolicyDenied(parsed?.reason ?? "unknown", "settle", {
          contractError: parsed?.code,
          detail: `${settleResponse.errorReason ?? "settle failed"} tx=${settleResponse.transaction}`,
        }),
        opts.onDenial,
      );
      return;
    }
    if (paymentRequired && !settleResponse) {
      // Verify failed. The facilitator does not say why; ask the card.
      let reason: DenialReason = "unknown";
      let code: number | undefined;
      try {
        reason = (await evaluate(requirements)) ?? "unknown";
      } catch {
        /* keep unknown */
      }
      const parsed = classifyContractError(paymentRequired.error ?? error?.message ?? "");
      if (parsed) {
        reason = parsed.reason;
        code = parsed.code;
      }
      box.set(
        new CardPolicyDenied(reason, "verify", { contractError: code, detail: paymentRequired.error }),
        opts.onDenial,
      );
    }
  });

  return client;
}

/**
 * A `fetch` that pays x402-protected requests from the card, and rejects with
 * `CardPolicyDenied` (never a bare 402) whenever the payment is denied at any
 * stage. Denied payments are never retried.
 *
 * Each call builds its own client and denial scope — `x402Client.fromConfig`
 * does no I/O — so concurrent requests through the same returned `fetch` cannot
 * observe each other's denials.
 */
export function createMooringFetch(
  opts: MooringClientOptions & { fetch?: typeof globalThis.fetch },
): typeof globalThis.fetch {
  const transport = opts.fetch ?? globalThis.fetch;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const box = new DenialBox();
    const wrapped = wrapFetchWithPayment(transport, createMooringClient(opts, box));
    try {
      const res = await wrapped(input, init);
      // Verify and settle failures come back as a non-2xx response, not a
      // throw; the hooks have recorded why, so surface it typed.
      if (box.last) throw box.last;
      const settlement = getSettlement(res);
      if (settlement && !settlement.success) {
        throw new CardPolicyDenied("unknown", "settle", {
          detail: `${settlement.errorReason ?? "settle failed"} tx=${settlement.transaction}`,
        });
      }
      if (res.status === 402) {
        // The payment was made and still refused, but the response says nothing
        // the hooks could classify.
        throw new CardPolicyDenied("unknown", "verify", {
          detail: "payment rejected (402) without a decodable PAYMENT-REQUIRED header",
        });
      }
      return res;
    } catch (err) {
      // A pre-check abort reaches us as a generic Error from @x402/fetch.
      if (err instanceof CardPolicyDenied) throw err;
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
