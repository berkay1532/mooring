import type { CardInfo } from "./card.js";
import type { DenialReason } from "./denial.js";

export interface PaymentTerms {
  payTo: string;
  amount: string; // base units
  asset: string;  // token contract address
}

/**
 * Local mirror of the card's on-chain policy, evaluated before signing so the agent
 * never submits a payment the card will reject. Order matches the contract.
 */
export function precheck(info: CardInfo, merchants: string[], req: PaymentTerms, nowSeconds: number): DenialReason | null {
  const amount = BigInt(req.amount);
  if (req.asset !== info.token) return "wrong_token";
  if (info.state === 1) return "frozen";
  if (info.state === 2) return "cancelled";
  if (BigInt(nowSeconds) >= info.policy.expiry) return "expired";
  if (!merchants.includes(req.payTo)) return "not_allowlisted";
  if (amount > info.policy.max_per_tx) return "over_per_tx_cap";
  if (amount > info.remaining) return "over_budget";
  if (amount > info.balance) return "insufficient_balance";
  return null;
}
