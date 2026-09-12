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

const CONTRACT_ERROR = /Error\(Contract, #(\d+)\)/;

/** Parses a Soroban `Error(Contract, #N)` from an error/diagnostic string. */
export function classifyContractError(text: string): { code: number; reason: DenialReason } | null {
  const m = CONTRACT_ERROR.exec(text);
  if (!m) return null;
  const code = Number(m[1]);
  return { code, reason: CARD_ERROR_CODES[code] ?? "unknown" };
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
