import type { GuardDenied } from "../denial.js";

/** What a payment would spend, as the guard sees it. `amount` is in USDC base units (7 decimals). */
export interface GuardTerms {
  card: string;
  payTo: string;
  /** Base units. */
  amount: string;
  asset: string;
  network: string;
  url?: string;
}

/** An amount held against a card's caps while its payment is in flight. */
export interface Reservation {
  id: string;
  card: string;
  /** Base units. */
  amount: string;
}

/** Local caps, in USDC base units. An absent cap does not limit. */
export interface GuardCaps {
  dailyCap?: string;
  totalCap?: string;
  maxPerTx?: string;
}

/** Local caps as configured, in decimal USDC (`"1.5"`). See `parseGuardConfig`. */
export interface GuardConfig {
  dailyCap?: string;
  totalCap?: string;
  maxPerTx?: string;
}

/** A card's guard state. Amounts are base units; `day` is the UTC date `daily` counts. */
export interface GuardSnapshot {
  day: string;
  daily: string;
  total: string;
  reserved: string;
  caps: GuardCaps;
  stopped: boolean;
}

/**
 * Agent-side safety rails, decided before the agent key signs anything.
 *
 * Decision order: `stopped` → `max_per_tx` → `daily_cap` → `total_cap`, with
 * open reservations counted toward both caps. `check()` returns the refusal
 * without reserving; `reserve()` throws it. Every reservation is closed with
 * `commit()`: a `settled` one counts toward the caps, `denied` / `failed`
 * release it.
 */
export interface Guard {
  check(t: GuardTerms): Promise<GuardDenied | null>;
  /** Throws `GuardDenied`. */
  reserve(t: GuardTerms): Promise<Reservation>;
  commit(r: Reservation, outcome: "settled" | "denied" | "failed"): Promise<void>;
  /** Without a card: stops every card. */
  stop(reason?: string, card?: string): Promise<void>;
  /** Without a card: lifts the global stop (card-scoped stops stay). */
  resume(card?: string): Promise<void>;
  /** True when a global stop or this card's stop is set. */
  isStopped(card: string): Promise<boolean>;
  snapshot(card: string): Promise<GuardSnapshot>;
}
