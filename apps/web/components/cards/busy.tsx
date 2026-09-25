"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { QueryKey } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useTxToast } from "@/components/ui/TxToast";
import type { Wallet } from "@/lib/chain/card";
import { explorerTxUrl } from "@/lib/chain/rpc";
import {
  useContractAction,
  type ActionState,
  type BuiltTransaction,
  type ContractActionResult,
} from "@/lib/query/hooks";

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
   * What the transaction does, for its toast ("Freeze inference-agent",
   * "Fund 12.50 USDC"). Evaluated once per run, with that run's arguments.
   */
  label: string | ((args: TArgs) => string);
  /**
   * Called a beat after the transaction confirms (a sheet/modal closes
   * itself here). The confirmation itself is on the transaction's toast.
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
 * One card write: `useContractAction` plus the per-card busy lock, the
 * transaction's toast (progress, §7 details, confirmation or error — see
 * `useTxToast`), and the "hold the confirmed state for a beat, then close"
 * behaviour every sheet and modal on this screen shares.
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

  // Each run gets its own toast, labelled from that run's arguments, so it
  // keeps describing what was actually signed.
  const toast = useTxToast(action, { explorerUrl: explorerTxUrl });
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const actionRun = action.run;
  const begin = toast.begin;
  const run = useCallback(
    (args: TArgs) => {
      const { label } = optsRef.current;
      begin(typeof label === "function" ? label(args) : label);
      return actionRun(args);
    },
    [actionRun, begin],
  );

  const { busy, report } = useCardBusy();
  const mine = action.state === "preparing" || action.state === "signing" || action.state === "submitted";

  useEffect(() => {
    report(id, mine);
    return () => report(id, false);
  }, [id, mine, report]);

  return { ...action, run, mine, locked: busy && !mine };
}

/**
 * A primary button's text while its transaction is in flight — the
 * progress itself is on the toast, the button just says what it waits for.
 */
export function opButtonLabel(state: ActionState, idle: string): string {
  switch (state) {
    case "preparing":
      return "Preparing…";
    case "signing":
      return "Waiting for signature…";
    case "submitted":
      return "Submitting…";
    default:
      return idle;
  }
}

/** The prop shape every owner-operation modal on this screen shares. */
export interface OpModalProps {
  open: boolean;
  onClose: () => void;
  address: string;
  info: import("@/lib/chain/card").CardInfo;
}
