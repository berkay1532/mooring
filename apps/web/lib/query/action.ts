"use client";

import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import type { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { Api } from "@stellar/stellar-sdk/rpc";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

import type { Wallet } from "../chain/card";
import { translateError, type TranslatedError } from "../chain/errors";
import { explorerTxUrl, getRpcServer } from "../chain/rpc";
import { config } from "../config";
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
  /** Called once, after invalidation, when the transaction is confirmed. Skipped if the component has unmounted by then. */
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

/**
 * The title a poll timeout reports. Exported because a caller has to be able
 * to recognise *this* failure without matching on prose: the wizard treats a
 * timed-out `create_card` differently from a plain failure (the transaction
 * may still land, and re-running it with the same salt would collide).
 */
export const NOT_CONFIRMED_TITLE = "Not confirmed yet";

/** Polls `getTransaction` once a second, for up to 60 seconds (per spec §4.2). */
const POLL_INTERVAL_MS = 1_000;
const MAX_POLL_ATTEMPTS = 60;

/**
 * A `setTimeout`-based delay whose pending timer is recorded in `timeoutRef`
 * and whose `resolve` is recorded in `resolveRef`, so an unmount cleanup can
 * both `clearTimeout` the timer (see the `useEffect` in `useContractAction`
 * — otherwise the poll loop would keep a timer alive for up to a minute
 * after the component using it is gone) *and* settle the promise itself.
 * Without the latter, `clearTimeout` alone leaves this `await` — and so the
 * whole `run()` promise, and `inFlightRef` — pending forever after unmount;
 * settling it here lets the poll loop reach its `cancelledRef` check and
 * return, so `run()`'s `finally` resets `inFlightRef`.
 */
function delay(
  ms: number,
  timeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>,
  resolveRef: MutableRefObject<(() => void) | null>,
): Promise<void> {
  return new Promise((resolve) => {
    const settle = () => {
      timeoutRef.current = null;
      resolveRef.current = null;
      resolve();
    };
    resolveRef.current = settle;
    timeoutRef.current = setTimeout(settle, ms);
  });
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
  const { wallet } = useWallet();
  const queryClient = useQueryClient();

  const [state, setState] = useState<ActionState>("idle");
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<TranslatedError | null>(null);

  const inFlightRef = useRef(false);

  // `mountedRef` gates every `setState` call; `cancelledRef` additionally
  // breaks the poll loop and skips `onConfirmed`. Both are set in the effect
  // *body* (not just its cleanup): under React StrictMode (`next dev`),
  // effects run setup -> cleanup -> setup on mount, so a flag only ever
  // written by the cleanup would be left permanently `false` after the
  // second setup — every `run()` would then silently bail out before
  // `wallet.signTransaction` (see the Task 7 review, B1).
  const mountedRef = useRef(true);
  const cancelledRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolveRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    cancelledRef.current = false;
    return () => {
      mountedRef.current = false;
      cancelledRef.current = true;
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      // Settle any delay() the poll loop is currently awaiting, so a
      // cleared timer doesn't leave `run()` (and `inFlightRef`) pending
      // forever — see `delay`'s doc comment.
      resolveRef.current?.();
    };
  }, []);

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
          fail({ title: "Connect a wallet", next: "Connect Freighter to continue." });
          return;
        }
        // The route guard (spec §4.3) blocks every write route unless the
        // wallet's network already matches `config.networkPassphrase`, so
        // signing and re-parsing against `config`'s own value (rather than
        // the wallet-reported one, which can be `null` if `getNetworkDetails`
        // failed) is always the correct network here.
        const passphrase = config.networkPassphrase;

        // --- preparing: simulate/assemble ---------------------------------
        const tx = await buildRef.current(args, wallet);
        if (isAssembledTransaction(tx)) {
          if (!tx.simulation) {
            // The generated bindings already simulate by default
            // (`AssembledTransaction.build`'s `options.simulate` defaults to
            // `true`), so only re-simulate when the caller opted out of that
            // (or handed in a transaction that was never simulated) — avoids
            // a redundant `simulateTransaction` round trip on every write.
            await tx.simulate();
          }
          // Neither `build()`/`simulate()` throws on a *failed* simulation —
          // the SDK stores the error response in `tx.simulation` and leaves
          // `tx.built` as the raw, unassembled transaction (no footprint, no
          // resource fee, no auth). Without this check the hook would send
          // that doomed transaction on to `signing`, so "already simulated"
          // must mean "simulated successfully", not merely "has a
          // `tx.simulation`". `sim.error` carries the same
          // `HostError: Error(Contract, #N)` text (plus diagnostic events)
          // that `translateError` already maps through `CARD_ERRORS`.
          const sim = tx.simulation!;
          if (Api.isSimulationError(sim)) {
            throw new Error(sim.error);
          }
          if (Api.isSimulationRestore(sim)) {
            throw new Error("This card's state needs to be restored before it can be used.");
          }
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
        if (sent.status === "TRY_AGAIN_LATER") {
          // Not queued at all (unlike `PENDING`/`DUPLICATE`) — polling would
          // just see `NOT_FOUND` for a minute and report a misleading
          // "not confirmed yet" against a transaction that never existed.
          fail({
            title: "The network is busy",
            detail: "The transaction could not be queued right now.",
            next: "Try again in a moment.",
          });
          return;
        }

        // --- poll getTransaction, up to 60s ---------------------------------
        let confirmed = false;
        let sawFailure = false;
        for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
          if (cancelledRef.current) break;
          await delay(POLL_INTERVAL_MS, timeoutRef, resolveRef);
          if (cancelledRef.current) break;
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
          if (cancelledRef.current) return; // unmounted mid-poll — nothing left to report
          fail({
            title: NOT_CONFIRMED_TITLE,
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
        if (mountedRef.current) optsRef.current.onConfirmed?.(sent.hash);
      } catch (err) {
        fail(translateError(err));
      } finally {
        inFlightRef.current = false;
      }
    },
    [wallet, queryClient, fail],
  );

  const reset = useCallback(() => {
    if (inFlightRef.current) return;
    setState("idle");
    setHash(null);
    setError(null);
  }, []);

  return { run, state, hash, error, reset };
}
