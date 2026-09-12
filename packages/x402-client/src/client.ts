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
    const reason = await evaluate(selectedRequirements);
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
 */
export function createMooringFetch(
  opts: MooringClientOptions & { fetch?: typeof globalThis.fetch },
): typeof globalThis.fetch {
  const box = new DenialBox();
  const client = createMooringClient(opts, box);
  const wrapped = wrapFetchWithPayment(opts.fetch ?? globalThis.fetch, client);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    box.last = undefined;
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
      return res;
    } catch (err) {
      // A pre-check abort reaches us as a generic Error from @x402/fetch.
      if (err instanceof CardPolicyDenied) throw err;
      if (box.last) throw box.last;
      throw err;
    }
  }) as typeof globalThis.fetch;
}

/** Decodes the PAYMENT-RESPONSE header of a paid response, if present. */
export function getSettlement(res: Response): Settlement | null {
  const header = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
  if (!header) return null;
  return decodePaymentResponseHeader(header) as Settlement;
}
