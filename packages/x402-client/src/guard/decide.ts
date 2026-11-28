import { GuardDenied } from "../denial.js";
import { formatUsdc } from "./config.js";
import type { GuardCaps, GuardTerms } from "./types.js";

/** A card's counters at decision time, in base units. `day` is the UTC date `daily` counts. */
export interface GuardCounters {
  day: string;
  daily: bigint;
  total: bigint;
  /** The sum of the card's open reservations. */
  reserved: bigint;
}

/** How many recent settled reservation ids a guard keeps per card to make `commit` idempotent. */
export const COMMITTED_KEEP = 100;

/** The UTC date (`YYYY-MM-DD`) of an instant. */
export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The guard decision every `Guard` makes, as a pure function: `stopped` →
 * `max_per_tx` → `daily_cap` → `total_cap`, with open reservations counted
 * toward both caps. `stop` is the stop in force for the card, if any.
 */
export function decideGuard(
  t: GuardTerms,
  caps: GuardCaps,
  c: GuardCounters,
  stop: { reason?: string } | undefined,
): GuardDenied | null {
  const amount = BigInt(t.amount);
  const attempted = formatUsdc(amount);
  if (stop) return new GuardDenied("stopped", { card: t.card, attempted, detail: stop.reason });
  const { maxPerTx, dailyCap, totalCap } = caps;
  if (maxPerTx !== undefined && amount > BigInt(maxPerTx)) {
    return new GuardDenied("max_per_tx", { card: t.card, attempted, limit: formatUsdc(maxPerTx) });
  }
  if (dailyCap !== undefined && c.daily + c.reserved + amount > BigInt(dailyCap)) {
    return new GuardDenied("daily_cap", {
      card: t.card,
      attempted,
      limit: formatUsdc(dailyCap),
      detail: `${formatUsdc(c.daily)} USDC spent on ${c.day}, ${formatUsdc(c.reserved)} USDC in flight`,
    });
  }
  if (totalCap !== undefined && c.total + c.reserved + amount > BigInt(totalCap)) {
    return new GuardDenied("total_cap", {
      card: t.card,
      attempted,
      limit: formatUsdc(totalCap),
      detail: `${formatUsdc(c.total)} USDC spent in total, ${formatUsdc(c.reserved)} USDC in flight`,
    });
  }
  return null;
}
