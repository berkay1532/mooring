import { rpc, type xdr } from "@stellar/stellar-sdk";
import type { StellarNetwork } from "./scheme.js";

/** What the ledger says about a settlement transaction. */
export type SettlementOutcome =
  | { status: "SUCCESS" }
  | { status: "FAILED"; events: xdr.DiagnosticEvent[] }
  | { status: "NOT_FOUND" };

/** Reconciliation window: ~10 s, one RPC read per second. */
export const RECONCILE_ATTEMPTS = 10;
export const RECONCILE_DELAY_MS = 1000;

/**
 * Asks the network what actually happened to a settlement transaction.
 *
 * The facilitator answers `settle_exact_stellar_transaction_failed` both for a
 * transaction the ledger rejected *and* for one it simply stopped waiting for
 * (its own poll gives up after `maxTimeoutSeconds`), so its "failed" cannot be
 * read as "the payment did not happen" — inclusion can follow the answer. This
 * asks the RPC directly and distinguishes the three real outcomes:
 *
 * - `SUCCESS`   — the payment settled; the card was debited even though the
 *   server reported a failure and withheld the resource.
 * - `FAILED`    — the ledger rejected it; `events` carry the reason, including
 *   the card's own `__check_auth` verdict when that is what refused.
 * - `NOT_FOUND` — still not visible when the window closed; the settlement
 *   state is unknown.
 *
 * An RPC error is treated as "not seen yet", not as an answer: a reconciliation
 * we could not complete must never be reported as a failed payment.
 */
export async function reconcileSettlement(
  rpcUrl: string,
  network: StellarNetwork,
  hash: string,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<SettlementOutcome> {
  const attempts = opts.attempts ?? RECONCILE_ATTEMPTS;
  const delayMs = opts.delayMs ?? RECONCILE_DELAY_MS;
  const server = new rpc.Server(rpcUrl, { allowHttp: network === "stellar:testnet" });

  for (let i = 0; i < attempts; i++) {
    try {
      const tx = await server.getTransaction(hash);
      if (tx.status === "SUCCESS") return { status: "SUCCESS" };
      if (tx.status === "FAILED") return { status: "FAILED", events: tx.diagnosticEventsXdr ?? [] };
    } catch {
      /* not visible yet, or the RPC hiccuped: keep waiting */
    }
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return { status: "NOT_FOUND" };
}
