import { CARD_ERROR_CODES, CardPolicyDenied, classifyContractError } from "./denial.js";

/** The merchant terms a denial carries. */
export interface SimDenialMerchant {
  payTo: string;
  amount: string;
  network: string;
  url?: string;
}

/**
 * Turns a failed enforcing simulation into a typed denial when it was the
 * card's `__check_auth` that said no.
 *
 * The card's address alone is not evidence: it appears in the `transfer`
 * arguments of every diagnostic this transaction can produce, and the token's
 * own error codes overlap the card's 1–8 range — a SAC balance error would be
 * read as a policy decision. What identifies an auth failure is the host's
 * phrase, which names the failing account and its error together:
 *
 *   ["failed account authentication with error", <card>, Error(Contract, #N)]
 *
 * so the reason is taken from that fragment and nowhere else. Anything that
 * does not match returns `null` and stays an ordinary error.
 */
export function denialFromCard(
  err: unknown,
  card: string,
  merchant: SimDenialMerchant,
  appUrl?: string,
): CardPolicyDenied | null {
  const text = err instanceof Error ? err.message : String(err);
  const fragment = new RegExp(
    `failed account authentication with error"?,\\s*${card}\\s*,[^\\]]*`,
  ).exec(text);
  if (!fragment) return null;
  const parsed = classifyContractError(fragment[0]);
  if (!parsed || !(parsed.code in CARD_ERROR_CODES)) return null;
  return new CardPolicyDenied(parsed.reason, "simulate", {
    contractError: parsed.code,
    detail: text.split("\n")[0],
    merchant: {
      payTo: merchant.payTo,
      amount: merchant.amount,
      network: merchant.network,
      ...(merchant.url ? { url: merchant.url } : {}),
    },
    card,
    appUrl,
  });
}
