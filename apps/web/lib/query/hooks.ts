"use client";

import { useInfiniteQuery, useQuery, type UseInfiniteQueryResult, type UseQueryResult } from "@tanstack/react-query";

import { readBalance, readInfo, readMerchants, type CardInfo } from "../chain/card";
import { discoverCards } from "../chain/discover";
import { getRpcServer } from "../chain/rpc";
import { readContractWasmHash } from "../chain/verify";
import { fetchActivity, fetchIndexedCards, fetchIndexedMerchants, type ActivityResponse, type MerchantsResponse } from "../indexer/client";
import { getAddedCards } from "../prefs";
import { config } from "../config";
import { keys } from "./keys";

export { NOT_CONFIRMED_TITLE, useContractAction } from "./action";
export type {
  ActionState,
  BuiltTransaction,
  ContractActionOptions,
  ContractActionResult,
  TxDetails,
} from "./action";

/**
 * `document.visibilityState` guard for the 10 s poll interval (spec §4.1):
 * a hidden tab stops polling rather than burning RPC calls no one can see.
 * Safe outside the browser (SSR) — `document` is undefined there, so this
 * just reads as "not visible", and the query itself only ever runs client-side.
 */
function isTabVisible(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "visible";
}

/** How `useCards` found the list; exposed for tests and the empty-state copy. */
export type CardsSource = "indexer" | "probe";

/**
 * Lists `owner`'s cards, indexer first: `GET /api/cards?owner=` returns every
 * card the factory created for this owner from any client (CLI included), plus
 * manually tracked ones. When the indexer is unavailable (no database, network
 * error) the salt probe (`discoverCards`) takes over, exactly as before. Either
 * way, manually-added addresses from `lib/prefs.ts` are appended, de-duplicated.
 * A probe failure still propagates as the query's `error` — this never turns a
 * discovery failure into an empty "no cards" result.
 */
export async function loadCards(
  ownerAddress: string,
  deps: {
    indexed?: typeof fetchIndexedCards;
    probe?: typeof discoverCards;
  } = {},
): Promise<{ cards: string[]; source: CardsSource }> {
  const indexed = await (deps.indexed ?? fetchIndexedCards)(ownerAddress);
  let discovered: string[];
  let source: CardsSource;
  if (indexed) {
    discovered = indexed.cards.map((c) => c.card);
    source = "indexer";
  } else {
    discovered = await (deps.probe ?? discoverCards)(ownerAddress, {
      rpc: getRpcServer(),
      factory: config.factory,
      passphrase: config.networkPassphrase,
    });
    source = "probe";
  }
  const seen = new Set(discovered);
  const merged = discovered.slice();
  for (const address of getAddedCards(ownerAddress)) {
    if (!seen.has(address)) {
      seen.add(address);
      merged.push(address);
    }
  }
  return { cards: merged, source };
}

export function useCards(owner: string | null | undefined): UseQueryResult<string[]> {
  return useQuery({
    queryKey: keys.cards(owner ?? ""),
    enabled: owner != null,
    refetchInterval: 30_000,
    queryFn: async () => (await loadCards(owner as string)).cards,
  });
}

/** A card's indexed activity, newest first, 25 per page. `null` pages mean the indexer is off. */
export function useActivity(address: string | null | undefined): UseInfiniteQueryResult<{ pages: (ActivityResponse | null)[] }> {
  return useInfiniteQuery({
    queryKey: keys.activity(address ?? ""),
    enabled: address != null,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchActivity(address as string, pageParam),
    getNextPageParam: (last) => last?.nextCursor ?? undefined,
    refetchInterval: () => (isTabVisible() ? 30_000 : false),
  });
}

/** The indexer's view of a card's merchants (verified labels included); `null` when it is off. */
export function useIndexedMerchants(address: string | null | undefined): UseQueryResult<MerchantsResponse | null> {
  return useQuery({
    queryKey: keys.indexedMerchants(address ?? ""),
    enabled: address != null,
    queryFn: () => fetchIndexedMerchants(address as string),
    staleTime: 30_000,
  });
}

/**
 * Whether the contract at `address` runs the Mooring card code (its instance's
 * WASM hash is `config.cardWasmHash`). Anything the contract itself answers —
 * `info().owner` above all — is only meaningful once this is `true`. An RPC
 * failure is a query `error`, never `false`.
 */
export function useIsMooringCard(address: string | null | undefined): UseQueryResult<boolean> {
  return useQuery({
    queryKey: keys.cardCode(address ?? ""),
    enabled: address != null,
    queryFn: async () =>
      (await readContractWasmHash(getRpcServer(), address as string)) === config.cardWasmHash,
    staleTime: Infinity,
  });
}

/** A single card's `info()` — periodic budget, balance, state, and so on. */
export function useCardInfo(address: string | null | undefined): UseQueryResult<CardInfo> {
  return useQuery({
    queryKey: keys.info(address ?? ""),
    enabled: address != null,
    queryFn: () => readInfo(address as string),
    refetchInterval: () => (isTabVisible() ? 10_000 : false),
  });
}

/**
 * A USDC (SAC) balance for any address — in practice the connected owner's
 * own wallet, for the Fund sheet's quick picks and as the withdraw/cancel
 * trustline probe (the SAC rejects `balance` for an account with no
 * trustline, so a query `error` mentioning a trustline *is* the missing
 * trustline). A card's own balance is not read here: it already arrives
 * inside `useCardInfo`'s `info()`.
 *
 * `enabled` is how the callers stop it polling when nobody is looking: every
 * consumer is a modal or sheet that stays mounted while closed, so without it
 * a closed Fund/Withdraw/Cancel dialog would keep reading the owner's balance
 * every 10 s for as long as the dashboard is open.
 */
export function useUsdcBalance(
  address: string | null | undefined,
  opts: { enabled?: boolean } = {},
): UseQueryResult<bigint> {
  const enabled = (opts.enabled ?? true) && address != null;
  return useQuery({
    queryKey: keys.balance(address ?? ""),
    enabled,
    queryFn: () => readBalance(address as string),
    // A failed trustline probe must not be retried four times before the
    // Fund sheet can explain itself.
    retry: false,
    refetchInterval: () => (enabled && isTabVisible() ? 10_000 : false),
  });
}

/** A single card's merchant allowlist. */
export function useMerchants(address: string | null | undefined): UseQueryResult<string[]> {
  return useQuery({
    queryKey: keys.merchants(address ?? ""),
    enabled: address != null,
    queryFn: () => readMerchants(address as string),
    refetchInterval: () => (isTabVisible() ? 10_000 : false),
  });
}
