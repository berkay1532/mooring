import {
  CARD_ERROR_CODES,
  CardPolicyDenied,
  classifyContractError,
  type DenialReason,
  type DenialStage,
} from "./denial.js";

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
  return cardDenialFromText(text, "simulate", { card, merchant, appUrl });
}

/** Who a denial read from text is about: the card, the merchant's terms, the app for allow links. */
export interface TextDenialContext {
  card: string;
  merchant: SimDenialMerchant;
  appUrl?: string;
  /** The denial's `detail` (default: the text's first line). */
  detail?: string;
}

/**
 * The card's `__check_auth` verdict named in a host diagnostic, wherever the
 * diagnostic was relayed from: only the host's auth-failure phrase naming
 * this card, followed by a card error code (1..8), counts. `null` otherwise.
 */
export function cardAuthFailure(text: string, card: string): { code: number; reason: DenialReason } | null {
  const fragment = new RegExp(
    `failed account authentication with error"?,\\s*${card}\\s*,[^\\]]*`,
  ).exec(text);
  if (!fragment) return null;
  const parsed = classifyContractError(fragment[0]);
  if (!parsed || !(parsed.code in CARD_ERROR_CODES)) return null;
  return parsed;
}

/** A `CardPolicyDenied` at `stage` when `text` carries the card's own auth failure (see `cardAuthFailure`), else `null`. */
export function cardDenialFromText(
  text: string,
  stage: DenialStage,
  ctx: TextDenialContext,
): CardPolicyDenied | null {
  const parsed = cardAuthFailure(text, ctx.card);
  if (!parsed) return null;
  return new CardPolicyDenied(parsed.reason, stage, {
    contractError: parsed.code,
    detail: ctx.detail ?? text.split("\n")[0],
    merchant: {
      payTo: ctx.merchant.payTo,
      amount: ctx.merchant.amount,
      network: ctx.merchant.network,
      ...(ctx.merchant.url ? { url: ctx.merchant.url } : {}),
    },
    card: ctx.card,
    appUrl: ctx.appUrl,
  });
}

/** What an mppx seller's problem `detail` starts with when it refused a credential at verification. */
export const SELLER_REFUSAL_MARKER = "Payment verification failed";

/**
 * A seller's verification refusal of a paid MPP request, read from the full
 * refusal text: a card denial at stage `verify` when the seller relayed the
 * card's own `__check_auth` failure (it keeps the simulation's host
 * diagnostic), else `null` — also when the text carries no verification
 * marker at all.
 */
export function classifySellerRefusal(text: string, ctx: TextDenialContext): CardPolicyDenied | null {
  if (!text.includes(SELLER_REFUSAL_MARKER)) return null;
  return cardDenialFromText(text, "verify", ctx);
}
