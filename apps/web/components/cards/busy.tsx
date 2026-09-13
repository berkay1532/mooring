"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { QueryKey } from "@tanstack/react-query";
import type { ReactNode } from "react";

import type { Wallet } from "@/lib/chain/card";
import { useContractAction, type BuiltTransaction, type ContractActionResult } from "@/lib/query/hooks";

interface BusyContextValue {
  /** True while *any* registered action on this card is in flight. */
  busy: boolean;
  report(id: string, active: boolean): void;
}

const BusyContext = createContext<BusyContextValue | null>(null);

/**
 * Per-card write lock (spec §6, "a write in flight disables other writes on
 * the same card"). `useContractAction` only guards its own instance, and the
 * details panel holds a dozen of them (freeze, withdraw, rename, policy,
 * merchants, signer, cancel, fund) — without this, two of them could each
 * open a Freighter prompt against the same card and race each other's
 * sequence number.
 *
 * Keyed by the card address: selecting another card mounts a fresh provider,
 * so a lock never leaks across cards.
 */
export function CardBusyProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<readonly string[]>([]);

  const report = useCallback((id: string, on: boolean) => {
    setActive((prev) => {
      const has = prev.includes(id);
      if (on === has) return prev;
      return on ? [...prev, id] : prev.filter((x) => x !== id);
    });
  }, []);

  const value = useMemo<BusyContextValue>(() => ({ busy: active.length > 0, report }), [active, report]);
  return <BusyContext.Provider value={value}>{children}</BusyContext.Provider>;
}

const NO_PROVIDER: BusyContextValue = { busy: false, report: () => {} };

/**
 * The card's busy flag. Usable without a provider (a modal rendered on its
 * own in a test, or outside the details panel) — it then simply never locks.
 */
export function useCardBusy(): BusyContextValue {
  return useContext(BusyContext) ?? NO_PROVIDER;
}

export interface CardOpOptions<TArgs> {
  invalidates: (args: TArgs) => QueryKey[];
  /**
   * Called a beat after the transaction confirms, so the user sees the
   * "Confirmed" state before the sheet/modal closes and the toast appears.
   */
  onDone?: (hash: string) => void;
}

export interface CardOpResult<TArgs> extends ContractActionResult<TArgs> {
  /** This action itself is in flight. */
  mine: boolean;
  /** Another action on the same card is in flight — disable this trigger. */
  locked: boolean;
}

/** How long the confirmed state stays up before a sheet/modal closes itself. */
const DONE_DELAY_MS = 900;

/**
 * One card write: `useContractAction` plus the per-card busy lock and the
 * "hold the confirmed state for a beat, then close" behaviour every sheet
 * and modal on this screen shares.
 */
export function useCardOp<TArgs>(
  id: string,
  build: (args: TArgs, wallet: Wallet) => Promise<BuiltTransaction>,
  opts: CardOpOptions<TArgs>,
): CardOpResult<TArgs> {
  const doneRef = useRef(opts.onDone);
  doneRef.current = opts.onDone;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const action = useContractAction<TArgs>(build, {
    invalidates: opts.invalidates,
    onConfirmed: (hash) => {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        doneRef.current?.(hash);
      }, DONE_DELAY_MS);
    },
  });

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const { busy, report } = useCardBusy();
  const mine = action.state === "preparing" || action.state === "signing" || action.state === "submitted";

  useEffect(() => {
    report(id, mine);
    return () => report(id, false);
  }, [id, mine, report]);

  return { ...action, mine, locked: busy && !mine };
}

/** The prop shape every owner-operation modal on this screen shares. */
export interface OpModalProps {
  open: boolean;
  onClose: () => void;
  address: string;
  info: import("@/lib/chain/card").CardInfo;
  /** Called after a confirmed write, with the sentence for the toast. */
  onDone: (message: string) => void;
}
