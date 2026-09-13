"use client";

import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import type { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Wallet } from "../chain/card";
import { translateError, type TranslatedError } from "../chain/errors";
import { explorerTxUrl, getRpcServer } from "../chain/rpc";
import { useWallet } from "../wallet/context";

/**
 * The state machine `useContractAction` drives, per spec §4.2:
 *
 * ```text
 * idle -> preparing -> signing -> submitted -> confirmed
 *                                            \-> failed
 * ```
 *
 * `preparing`, `signing` and `submitted` can each end in `failed` instead of
 * advancing (a simulation error, a declined/failed signature, a rejected
 * submission, an on-chain failure, or a poll timeout).
 */
export type ActionState = "idle" | "preparing" | "signing" | "submitted" | "confirmed" | "failed";

/** Either shape a write builder in `lib/chain/card.ts` can return. */
export type BuiltTransaction = AssembledTransaction<unknown> | Transaction;

export interface ContractActionOptions<TArgs> {
  /** Query keys to invalidate once the transaction is confirmed on-chain. */
  invalidates: (args: TArgs) => QueryKey[];
  /** Called once, after invalidation, when the transaction is confirmed. */
  onConfirmed?: (hash: string) => void;
}

export interface ContractActionResult<TArgs> {
  /** Starts the action. A no-op while one is already in flight. */
  run(args: TArgs): Promise<void>;
  state: ActionState;
  /** The submitted transaction's hash, once known. Kept through `failed` so a timed-out or failed action can still be looked up. */
  hash: string | null;
  error: TranslatedError | null;
  /** Returns to `idle`, clearing `hash` and `error`. */
  reset(): void;
}

/** Polls `getTransaction` once a second, for up to 60 seconds (per spec §4.2). */
const POLL_INTERVAL_MS = 1_000;
const MAX_POLL_ATTEMPTS = 60;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Distinguishes the two shapes a write builder can hand back: a generated
 * binding's `AssembledTransaction` (has `.simulate`/`.built`) or a plain,
 * already-prepared `Transaction` (`buildFundTransfer`, the one write path
 * built by hand rather than through the bindings — see `lib/chain/card.ts`).
 * Duck-typed, not `instanceof`, so tests can hand in a plain fake without
 * constructing the real (network-calling) `AssembledTransaction` class.
 */
export function isAssembledTransaction(tx: BuiltTransaction): tx is AssembledTransaction<unknown> {
  return typeof (tx as { simulate?: unknown }).simulate === "function";
}

/** Best-effort human message for a `sendTransaction` `ERROR` response. */
function describeSendError(res: { status: string; errorResult?: unknown }): string {
  try {
    const inner = (res.errorResult as { result?: () => { switch?: () => { name: string } } } | undefined)
      ?.result?.()
      ?.switch?.();
    if (inner?.name) return `Transaction submission failed: ${inner.name}`;
  } catch {
    // fall through to the generic message below
  }
  return `Transaction submission failed (${res.status})`;
}

/** Best-effort human message for a `getTransaction` `FAILED` response. */
function describeFailedTx(res: { resultXdr?: unknown }): string {
  try {
    const inner = (res.resultXdr as { result?: () => { switch?: () => { name: string } } } | undefined)
      ?.result?.()
      ?.switch?.();
    if (inner?.name) return `HostError: ${inner.name}`;
  } catch {
    // fall through
  }
  return "Transaction failed";
}

/**
 * Drives one Soroban write through simulate -> sign -> submit -> poll,
 * exposing the state machine from spec §4.2. `build` is called with the
 * connected wallet (from `useWallet()`), so callers never have to thread it
 * through themselves.
 *
 * Concurrency: this hook refuses a second `run()` while one is already in
 * flight (a per-instance guard) — a caller renders one instance per
 * card/action pair, which is what makes that a per-card guard in practice.
 * The brief's two-field `opts` (`invalidates`, `onConfirmed`) intentionally
 * carries no address/lock key, so a *cross-instance* lock (e.g. freeze and
 * withdraw on the same card, each its own hook instance) is out of scope
 * here; see the task report for the reasoning.
 */
export function useContractAction<TArgs>(
  build: (args: TArgs, wallet: Wallet) => Promise<BuiltTransaction>,
  opts: ContractActionOptions<TArgs>,
): ContractActionResult<TArgs> {
  const { wallet, networkPassphrase } = useWallet();
  const queryClient = useQueryClient();

  const [state, setState] = useState<ActionState>("idle");
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<TranslatedError | null>(null);

  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // Keep the latest `opts`/`build` without making `run`'s identity depend on
  // callers passing stable references (`invalidates`/`onConfirmed` are
  // typically inline closures).
  const buildRef = useRef(build);
  buildRef.current = build;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const fail = useCallback((translated: TranslatedError) => {
    if (!mountedRef.current) return;
    setError(translated);
    setState("failed");
  }, []);

  const run = useCallback(
    async (args: TArgs) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      if (mountedRef.current) {
        setError(null);
        setHash(null);
        setState("preparing");
      }

      try {
        if (!wallet) {
          fail(translateError(new Error("Connect a wallet to continue.")));
          return;
        }
        const passphrase = networkPassphrase ?? "";

        // --- preparing: simulate/assemble ---------------------------------
        const tx = await buildRef.current(args, wallet);
        if (isAssembledTransaction(tx)) {
          await tx.simulate();
        }
        if (!mountedRef.current) return;

        // --- signing --------------------------------------------------------
        setState("signing");
        const unsignedXdr = isAssembledTransaction(tx) ? tx.built!.toXDR() : tx.toXDR();
        let signedTxXdr: string;
        try {
          const signed = await wallet.signTransaction(unsignedXdr, { networkPassphrase: passphrase });
          signedTxXdr = signed.signedTxXdr;
        } catch (err) {
          fail(translateError(err));
          return;
        }
        if (!mountedRef.current) return;

        // --- submitted --------------------------------------------------------
        setState("submitted");
        const rpc = getRpcServer();
        const signedTx = TransactionBuilder.fromXDR(signedTxXdr, passphrase) as Transaction;
        const sent = await rpc.sendTransaction(signedTx);

        if (sent.hash && mountedRef.current) setHash(sent.hash);

        if (sent.status === "ERROR") {
          fail(translateError(new Error(describeSendError(sent))));
          return;
        }

        // --- poll getTransaction, up to 60s ---------------------------------
        let confirmed = false;
        let sawFailure = false;
        for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
          await delay(POLL_INTERVAL_MS);
          const got = await rpc.getTransaction(sent.hash);
          if (got.status === "SUCCESS") {
            confirmed = true;
            break;
          }
          if (got.status === "FAILED") {
            sawFailure = true;
            fail(translateError(new Error(describeFailedTx(got))));
            break;
          }
          // NOT_FOUND: keep polling.
        }

        if (sawFailure) return;
        if (!confirmed) {
          fail({
            title: "Not confirmed yet",
            detail: "The transaction is still pending after 60 seconds.",
            next: `Check its status on the explorer: ${explorerTxUrl(sent.hash)}`,
          });
          return;
        }

        // --- confirmed --------------------------------------------------------
        if (mountedRef.current) setState("confirmed");
        for (const key of optsRef.current.invalidates(args)) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
        optsRef.current.onConfirmed?.(sent.hash);
      } catch (err) {
        fail(translateError(err));
      } finally {
        inFlightRef.current = false;
      }
    },
    [wallet, networkPassphrase, queryClient, fail],
  );

  const reset = useCallback(() => {
    if (inFlightRef.current) return;
    setState("idle");
    setHash(null);
    setError(null);
  }, []);

  return { run, state, hash, error, reset };
}
