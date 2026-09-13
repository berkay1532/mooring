import type { QueryKey } from "@tanstack/react-query";

/**
 * A typed factory for every React Query key this app uses. Centralizing
 * these means a write's `invalidates(args)` (see `useContractAction` in
 * `./action.ts`) and a hook's own `queryKey` always agree on shape, and a
 * rename only touches this file.
 */
export const keys = {
  /** An owner's card list (discovered + added). */
  cards: (owner: string): QueryKey => ["cards", owner],
  /** A single card's `info()` read. */
  info: (address: string): QueryKey => ["card", address, "info"],
  /** A single card's `merchants()` allowlist read. */
  merchants: (address: string): QueryKey => ["card", address, "merchants"],
  /**
   * A USDC (SAC) balance read for any address. Used for the *owner's*
   * wallet balance (the Fund sheet's quick picks, the withdraw/cancel
   * trustline check) — a card's own balance already comes back inside
   * `info()`, so it is keyed by `info`, not here.
   */
  balance: (address: string): QueryKey => ["balance", address],
};
