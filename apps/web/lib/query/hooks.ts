"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { readInfo, readMerchants, type CardInfo } from "../chain/card";
import { discoverCards } from "../chain/discover";
import { getRpcServer } from "../chain/rpc";
import { getAddedCards } from "../prefs";
import { config } from "../config";
import { keys } from "./keys";

export { useContractAction } from "./action";
export type { ActionState, BuiltTransaction, ContractActionOptions, ContractActionResult } from "./action";

/**
 * `document.visibilityState` guard for the 10 s poll interval (spec §4.1):
 * a hidden tab stops polling rather than burning RPC calls no one can see.
 * Safe outside the browser (SSR) — `document` is undefined there, so this
 * just reads as "not visible", and the query itself only ever runs client-side.
 */
function isTabVisible(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "visible";
}

/**
 * `owner`'s cards: everything `discoverCards` finds, followed by any
 * manually-added addresses (see `lib/prefs.ts`) that discovery didn't
 * already surface, de-duplicated. Discovery failures (a network error, a
 * malformed RPC response) propagate as the query's `error` — this never
 * swallows a discovery failure into an empty "no cards" result.
 */
export function useCards(owner: string | null | undefined): UseQueryResult<string[]> {
  return useQuery({
    queryKey: keys.cards(owner ?? ""),
    enabled: owner != null,
    refetchInterval: 30_000,
    queryFn: async () => {
      const ownerAddress = owner as string;
      const discovered = await discoverCards(ownerAddress, {
        rpc: getRpcServer(),
        factory: config.factory,
        passphrase: config.networkPassphrase,
      });
      const added = getAddedCards(ownerAddress);
      const seen = new Set(discovered);
      const merged = discovered.slice();
      for (const address of added) {
        if (!seen.has(address)) {
          seen.add(address);
          merged.push(address);
        }
      }
      return merged;
    },
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

/** A single card's merchant allowlist. */
export function useMerchants(address: string | null | undefined): UseQueryResult<string[]> {
  return useQuery({
    queryKey: keys.merchants(address ?? ""),
    enabled: address != null,
    queryFn: () => readMerchants(address as string),
    refetchInterval: () => (isTabVisible() ? 10_000 : false),
  });
}
