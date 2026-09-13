import { humanizeEvents, type xdr } from "@stellar/stellar-sdk";

export type DenialReason =
  | "frozen" | "cancelled" | "expired" | "not_allowlisted" | "over_per_tx_cap" | "over_budget"
  | "wrong_token" | "insufficient_balance" | "bad_signature" | "wrong_context" | "unknown";

/**
 * Where a payment was denied.
 *
 * - `precheck`  — the local policy mirror, before anything is signed.
 * - `simulate`  — the card's `__check_auth`, in the enforcing simulation the
 *   client runs after signing and before handing the payload to a facilitator.
 * - `verify`    — the facilitator refused the payload.
 * - `settle`    — the settlement transaction failed on-chain.
 */
export type DenialStage = "precheck" | "simulate" | "verify" | "settle";

/** Card contract error codes that mean "policy denied". */
export const CARD_ERROR_CODES: Record<number, DenialReason> = {
  1: "bad_signature",
  2: "wrong_context",
  3: "frozen",
  4: "cancelled",
  5: "expired",
  6: "not_allowlisted",
  7: "over_per_tx_cap",
  8: "over_budget",
};

/**
 * Every contract error the card can raise (`CardError`, codes 1..13), with a
 * short user-facing sentence for each. This is the full table: unlike
 * `CARD_ERROR_CODES` (1..8, payment denials only), it also covers the owner
 * operations the web app surfaces (`set_policy`, `set_label`, allowlist
 * management, freeze/cancel/withdraw) so their errors can be shown directly
 * without a separate mapping.
 */
export const CARD_ERRORS: Record<number, string> = {
  1: "The signature is not valid for this card.",
  2: "This action is not the one payment the card's agent key is allowed to sign.",
  3: "This card is frozen.",
  4: "This card has been cancelled.",
  5: "This card has expired.",
  6: "This merchant is not on the card's allowlist.",
  7: "This payment is over the card's per-transaction cap.",
  8: "This would put the card over its budget for the current period.",
  9: "The amount must be a positive number.",
  10: "The card's merchant allowlist is full.",
  11: "That policy is not valid (check the budget, cap and expiry values).",
  12: "This action is not allowed in the card's current state.",
  13: "That label is not valid (it must be 1 to 32 bytes).",
};

const CONTRACT_ERROR = /Error\(Contract, #(\d+)\)/;

/** Parses a Soroban `Error(Contract, #N)` from an error/diagnostic string. */
export function classifyContractError(text: string): { code: number; reason: DenialReason } | null {
  const m = CONTRACT_ERROR.exec(text);
  if (!m) return null;
  const code = Number(m[1]);
  return { code, reason: CARD_ERROR_CODES[code] ?? "unknown" };
}

/** The host's phrase that attributes an authorization failure to an account. */
const AUTH_FAILURE = "failed account authentication with error";

/**
 * Reads the card's own `__check_auth` verdict out of a transaction's diagnostic
 * events.
 *
 * The card's address alone is not evidence: it appears in the `transfer`
 * arguments of every diagnostic this transaction can produce, and the token's
 * own error codes overlap the card's 1-8 range — a SAC balance error would be
 * read as a policy decision. What identifies an auth failure is the host's
 * event, which names the failing account and its error together:
 *
 *   ["failed account authentication with error", <card>, Error(Contract, #N)]
 *
 * so the reason is taken from that event and nowhere else. Anything that does
 * not match returns `null`, and the caller reports `unknown`.
 */
export function cardDenialFromEvents(
  events: readonly xdr.DiagnosticEvent[],
  card: string,
): { code: number; reason: DenialReason } | null {
  for (const e of humanizeEvents([...events])) {
    const data = e.data;
    if (!Array.isArray(data) || data.length < 3) continue;
    if (data[0] !== AUTH_FAILURE || data[1] !== card) continue;
    const err = data[2] as { type?: string; code?: number } | undefined;
    if (err?.type !== "contract" || typeof err.code !== "number") continue;
    return { code: err.code, reason: CARD_ERROR_CODES[err.code] ?? "unknown" };
  }
  return null;
}

export class CardPolicyDenied extends Error {
  readonly reason: DenialReason;
  readonly stage: DenialStage;
  readonly contractError?: number;
  readonly detail?: string;

  constructor(reason: DenialReason, stage: DenialStage, opts: { contractError?: number; detail?: string } = {}) {
    super(`card policy denied (${reason}) at ${stage}${opts.contractError ? ` [contract error #${opts.contractError}]` : ""}${opts.detail ? `: ${opts.detail}` : ""}`);
    this.name = "CardPolicyDenied";
    this.reason = reason;
    this.stage = stage;
    this.contractError = opts.contractError;
    this.detail = opts.detail;
  }
}

/**
 * Why a payment did not deliver the resource, when the card's policy is *not*
 * the reason. `CardPolicyDenied` means exactly one thing — the card refused —
 * so everything else lands here:
 *
 * - `rejected`    — the facilitator (or the transport) refused the payment
 *   before anything was submitted: a malformed payload, a fee above the
 *   facilitator's ceiling, an expiration it will not accept, a 5xx. Nothing
 *   was spent.
 * - `unconfirmed` — the settlement state is unknown or contradictory: the
 *   server reported a failure for a transaction the ledger accepted, or the
 *   transaction was never observed. The card may have been debited; reconcile
 *   `transaction` against the network before retrying.
 */
export class PaymentError extends Error {
  readonly kind: "rejected" | "unconfirmed";
  readonly transaction?: string;
  readonly detail?: string;

  constructor(opts: { kind: "rejected" | "unconfirmed"; transaction?: string; detail?: string }) {
    super(
      `payment ${opts.kind}${opts.transaction ? ` (tx ${opts.transaction})` : ""}${opts.detail ? `: ${opts.detail}` : ""}`,
    );
    this.name = "PaymentError";
    this.kind = opts.kind;
    this.transaction = opts.transaction;
    this.detail = opts.detail;
  }
}
