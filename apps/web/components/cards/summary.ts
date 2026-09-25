"use client";

import { Buffer } from "buffer";

import { StrKey } from "@stellar/stellar-sdk";
import { useQueries } from "@tanstack/react-query";

import { readInfo, type CardInfo } from "@/lib/chain/card";
import { formatUsdc } from "@/lib/format/usdc";
import { keys } from "@/lib/query/keys";

/** The face a card shows: its on-chain state, with expiry folded in. */
export type CardFaceState = "active" | "frozen" | "expired" | "cancelled";

/** One card address plus its `info()` read, as the screen consumes it. */
export interface CardSummary {
  address: string;
  info?: CardInfo;
  error: unknown;
  loading: boolean;
}

/**
 * `document.visibilityState` guard for the 10 s poll (spec §4.1), mirroring
 * `lib/query/hooks.ts` — a hidden tab stops polling every card on the screen.
 */
function isTabVisible(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "visible";
}

/**
 * The four card faces. `state` is the contract's lifecycle (Active/Frozen/
 * Cancelled); a policy expiry in the past is shown as its own face because
 * it is what actually stops the agent paying, even though the contract still
 * reports the card as Active.
 */
export function faceState(info: CardInfo, nowUnix: number): CardFaceState {
  if (info.state === 2) return "cancelled";
  if (info.state === 1) return "frozen";
  if (Number(info.policy.expiry) <= nowUnix) return "expired";
  return "active";
}

/** How often the whole dashboard re-reads every card (see the note below). */
const SUMMARY_REFETCH_MS = 30_000;

/**
 * Reads `info()` for every address at once. Deliberately uses the same query
 * keys and the same `readInfo` fetcher as `useCardInfo`, so the carousel, the
 * list and the details panel share one cache entry per card and every write's
 * `invalidates(keys.info(address))` refreshes all three.
 *
 * Interval: 30 s here, against `useCardInfo`'s 10 s for the *selected* card.
 * Each `readInfo` is one `simulateTransaction`, so an N-card dashboard at
 * 10 s would sustain N/10 requests per second per open tab — enough to meet
 * the public testnet RPC's rate limits on a large dashboard. The selected
 * card still refreshes every 10 s because its own observer asks for that on
 * the same key, and every write invalidates immediately either way.
 */
export function useCardSummaries(addresses: readonly string[]): CardSummary[] {
  return useQueries({
    queries: addresses.map((address) => ({
      queryKey: keys.info(address),
      queryFn: () => readInfo(address),
      refetchInterval: () => (isTabVisible() ? SUMMARY_REFETCH_MS : false),
    })),
    combine: (results) =>
      results.map((result, i) => ({
        address: addresses[i],
        info: result.data,
        error: result.error,
        loading: result.isLoading,
      })),
  });
}

export interface CardTotals {
  count: number;
  /** Sum of every readable card's USDC balance, in base units. */
  balance: bigint;
  /** Sum of every readable card's spend in its current period, in base units. */
  spent: bigint;
}

export function totals(summaries: readonly CardSummary[]): CardTotals {
  let balance = 0n;
  let spent = 0n;
  for (const s of summaries) {
    if (!s.info) continue;
    balance += s.info.balance;
    spent += s.info.period.spent;
  }
  return { count: summaries.length, balance, spent };
}

/**
 * The exact base-unit amount as a decimal string for an input box: full
 * 7-decimal precision (never the rounded 2-decimal display), with trailing
 * zeros trimmed so "Max" on an 11 USDC balance reads `11`, not `11.0000000`.
 */
export function exactAmount(base: bigint): string {
  const full = formatUsdc(base, { full: true });
  if (!full.includes(".")) return full;
  return full.replace(/0+$/, "").replace(/\.$/, "");
}

/** A period duration as a short unit phrase: "day", "hour", "week", or a duration. */
export function periodLabel(seconds: bigint): string {
  switch (seconds) {
    case 3_600n:
      return "hour";
    case 86_400n:
      return "day";
    case 604_800n:
      return "week";
    default:
      return `${seconds} s`;
  }
}

/**
 * The agent signer (raw ed25519 public key bytes, as `info()` returns it) as
 * the `G…` strkey the owner pasted in. Returns `undefined` rather than
 * throwing if the bytes are not a valid key.
 */
export function signerStrkey(signer: Uint8Array | undefined): string | undefined {
  if (!signer) return undefined;
  try {
    return StrKey.encodeEd25519PublicKey(Buffer.from(signer));
  } catch {
    return undefined;
  }
}
