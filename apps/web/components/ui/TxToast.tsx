"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Toast, type ToastTone } from "./Toast";

export type TxState = "idle" | "preparing" | "signing" | "submitted" | "confirmed" | "failed";

export interface TxError {
  /** User-facing sentence, e.g. "Policy rejected". */
  title: string;
  /** Optional longer explanation, with the contract error code in parentheses per spec §4.2. */
  detail?: string;
  /** What to do next (e.g. "Fix the policy"). */
  next?: string;
}

/**
 * What the owner is about to sign (spec §7): the invoked contract and
 * function, its arguments in readable form, and the raw envelope XDR. Mirrors
 * `TxDetails` from `lib/query/action.ts`, kept structural so this component
 * stays independent of the chain layer.
 */
export interface TxDetailsProps {
  contract: string;
  fn: string;
  args: Array<{ name: string; value: string }>;
  xdr: string;
}

/** One write transaction as the toast stack shows it. */
export interface TxToastData {
  /** What the transaction does, e.g. "Freeze inference-agent" or "Fund 1.00 USDC". */
  label: string;
  state: Exclude<TxState, "idle">;
  hash?: string;
  error?: TxError;
  details?: TxDetailsProps;
  /** Explorer URL for `hash`. */
  explorerUrl?: string;
}

/** How long a confirmed transaction's toast stays up (a failed one stays until closed). */
export const CONFIRMED_DISMISS_MS = 10_000;
/** How long a plain notice ("Card added") stays up. */
export const NOTICE_DISMISS_MS = 4_000;

const STEPS = [
  { key: "prepared", label: "Prepared" },
  { key: "signature", label: "Signature" },
  { key: "submitted", label: "Submitted" },
  { key: "confirmed", label: "Confirmed" },
] as const;

type StepStatus = "done" | "current" | "pending";

function activeIndex(state: TxToastData["state"]): number {
  switch (state) {
    case "preparing":
      return 0;
    case "signing":
      return 1;
    case "submitted":
      return 2;
    default:
      return -1;
  }
}

function stepStatus(state: TxToastData["state"], index: number): StepStatus {
  if (state === "confirmed") return "done";
  const active = activeIndex(state);
  if (index < active) return "done";
  if (index === active) return "current";
  return "pending";
}

const HEADLINES: Record<"preparing" | "signing" | "submitted", string> = {
  preparing: "Preparing the transaction",
  signing: "Waiting for signature in your wallet",
  submitted: "Submitted — waiting for confirmation",
};

const DOT_CLASS: Record<StepStatus, string> = {
  done: "border-seaglass bg-seaglass text-bg-deep",
  current: "border-amber bg-amber/20 text-amber",
  pending: "border-text-hi/20 text-transparent",
};

/** `abcd1234…wxyz5678` — enough to recognise a hash, with the full value in a tooltip. */
export function shortHash(hash: string): string {
  return hash.length > 20 ? `${hash.slice(0, 8)}…${hash.slice(-8)}` : hash;
}

/**
 * The §7 disclosure — contract, function, arguments and the raw envelope
 * with a copy button — revealed inside the toast by its "Details" toggle.
 */
function TxDetailsPanel({ details, id }: { details: TxDetailsProps; id: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(details.xdr);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // A clipboard the browser refuses is not an error worth showing: the
      // XDR is on screen and selectable either way.
    }
  }

  return (
    <div id={id} data-testid="tx-details" className="mt-2.5 rounded-[12px] border border-text-hi/[0.07] bg-bg-raised px-3.5 py-2.5">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {details.contract ? (
          <>
            <dt className="font-mono text-text-lo">contract</dt>
            <dd className="min-w-0 break-all font-mono text-text-hi">{details.contract}</dd>
          </>
        ) : null}
        {details.fn ? (
          <>
            <dt className="font-mono text-text-lo">function</dt>
            <dd className="min-w-0 break-all font-mono text-text-hi">{details.fn}</dd>
          </>
        ) : null}
        {details.args.map((arg, index) => (
          <div key={`${arg.name}-${index}`} className="contents">
            <dt className="font-mono text-text-lo">{arg.name}</dt>
            <dd className="min-w-0 break-all font-mono text-text-hi">{arg.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-lo">envelope xdr</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded font-mono text-[11px] text-amber underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-text-lo">
        {details.xdr}
      </pre>
    </div>
  );
}

export interface TxToastProps {
  toast: TxToastData;
  onDismiss: () => void;
  className?: string;
}

/**
 * One write transaction, as a toast (spec §3.4 / §7). In flight it shows
 * the four-step Prepared → Signature → Submitted → Confirmed progress as
 * compact dots with the current step named; confirmed it shows the hash and
 * an explorer link and dismisses itself after {@link CONFIRMED_DISMISS_MS}
 * (not while its details are open); failed it shows the translated error
 * and stays until closed. A collapsed "Details" toggle reveals exactly what
 * the wallet is being handed — it is on screen from `preparing`, before the
 * wallet prompt, so the pre-signature disclosure survives.
 */
export function TxToast({ toast, onDismiss, className }: TxToastProps) {
  const { label, state, hash, error, details, explorerUrl } = toast;
  const [open, setOpen] = useState(false);
  const detailsId = useId();

  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  useEffect(() => {
    if (state !== "confirmed" || open) return;
    const timer = window.setTimeout(() => onDismissRef.current(), CONFIRMED_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [state, open]);

  const inFlight = state === "preparing" || state === "signing" || state === "submitted";
  const failed = state === "failed";
  const tone = failed ? "border-danger/40" : state === "confirmed" ? "border-seaglass/40" : "border-text-hi/[0.14]";
  const current = activeIndex(state);

  return (
    <div
      role={failed ? "alert" : "status"}
      data-state={state}
      data-testid="tx-toast"
      className={`pointer-events-auto w-full rounded-2xl border bg-surface px-4 py-3.5 font-body text-sm shadow-[0_20px_40px_rgba(0,0,0,.5)] ${tone} ${className ?? ""}`}
    >
      <div className="flex items-start gap-3">
        {inFlight ? (
          <span aria-hidden className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber/25 border-t-amber" />
        ) : (
          <span
            aria-hidden
            className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${failed ? "bg-danger" : "bg-seaglass"}`}
          />
        )}

        <div className="min-w-0 flex-1">
          {failed ? (
            <>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-lo">{label}</p>
              <p className="mt-0.5 text-text-hi">{error?.title ?? "Transaction failed"}</p>
              {error?.detail ? <p className="mt-1 text-xs text-text-lo">{error.detail}</p> : null}
              {error?.next ? <p className="mt-1 text-xs text-amber">{error.next}</p> : null}
            </>
          ) : (
            <>
              <p className="text-text-hi">{label}</p>
              <p className={`mt-0.5 text-xs ${state === "confirmed" ? "text-seaglass" : "text-text-lo"}`}>
                {state === "confirmed" ? "Confirmed" : HEADLINES[state]}
              </p>
              <ol aria-label="Progress" className="mt-2 flex items-center gap-1.5">
                {STEPS.map((step, index) => {
                  const status = stepStatus(state, index);
                  return (
                    <li
                      key={step.key}
                      data-step={step.key}
                      data-step-status={status}
                      title={step.label}
                      className="flex items-center gap-1.5"
                    >
                      <span
                        aria-hidden
                        className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[9px] leading-none ${DOT_CLASS[status]}`}
                      >
                        {status === "done" ? "✓" : ""}
                      </span>
                      <span className="sr-only">
                        {step.label}: {status}
                      </span>
                      {index === current ? (
                        <span aria-hidden className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-hi">
                          {step.label}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </>
          )}

          {hash ? (
            <p className="mt-1.5 text-xs text-text-lo">
              <span className="font-mono text-text-hi" title={hash}>
                {shortHash(hash)}
              </span>
              {explorerUrl ? (
                <>
                  {" · "}
                  <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-amber underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
                  >
                    view transaction ↗
                  </a>
                </>
              ) : null}
            </p>
          ) : null}

          {details ? (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={detailsId}
              onClick={() => setOpen((v) => !v)}
              className="mt-1.5 rounded font-mono text-[11px] uppercase tracking-[0.16em] text-text-lo transition hover:text-text-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
            >
              Details {open ? "▾" : "▸"}
            </button>
          ) : null}
          {details && open ? <TxDetailsPanel details={details} id={detailsId} /> : null}
        </div>

        {inFlight ? null : (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="-mr-1 -mt-1 shrink-0 rounded px-1.5 py-0.5 text-text-lo transition hover:text-text-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
          >
            <span aria-hidden>×</span>
          </button>
        )}
      </div>
    </div>
  );
}

// --- the global stack ---------------------------------------------------------

type Entry =
  | { kind: "tx"; id: string; data: TxToastData }
  | { kind: "notice"; id: string; message: string; tone: ToastTone };

export interface TxToastsApi {
  /** Adds or updates the toast for one transaction run. */
  upsert(id: string, data: TxToastData): void;
  /** Shows a plain notice ("Card added") in the same stack. */
  notify(message: string, tone?: ToastTone): void;
  dismiss(id: string): void;
}

const TxToastContext = createContext<TxToastsApi | null>(null);

/** The stack's size cap — see `trim` for what may be evicted to keep it. */
export const MAX_TOASTS = 5;

let nextId = 0;
function newId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

/**
 * The app's one notification stack, bottom-right: every write transaction's
 * progress, confirmation or failure, plus plain notices. Lives in
 * `app/providers.tsx`, above the routes, so a toast survives navigation
 * (the new-card wizard's last confirmation is still on screen on `/cards`).
 */
export function TxToastProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);

  const upsert = useCallback((id: string, data: TxToastData) => {
    setEntries((prev) => {
      const i = prev.findIndex((e) => e.id === id);
      if (i === -1) return trim([...prev, { kind: "tx", id, data }]);
      const next = prev.slice();
      next[i] = { kind: "tx", id, data };
      return next;
    });
  }, []);

  const notify = useCallback((message: string, tone: ToastTone = "success") => {
    setEntries((prev) => trim([...prev, { kind: "notice", id: newId("notice"), message, tone }]));
  }, []);

  const dismiss = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const api = useMemo<TxToastsApi>(() => ({ upsert, notify, dismiss }), [upsert, notify, dismiss]);

  return (
    <TxToastContext.Provider value={api}>
      {children}
      <div
        data-toast-region=""
        aria-live="polite"
        className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-[min(360px,calc(100vw-32px))] flex-col gap-2.5 max-sm:bottom-4 max-sm:right-4"
      >
        {entries.map((entry) =>
          entry.kind === "tx" ? (
            <TxToast key={entry.id} toast={entry.data} onDismiss={() => dismiss(entry.id)} />
          ) : (
            <Toast
              key={entry.id}
              inline
              message={entry.message}
              tone={entry.tone}
              duration={NOTICE_DISMISS_MS}
              onDismiss={() => dismiss(entry.id)}
            />
          ),
        )}
      </div>
    </TxToastContext.Provider>
  );
}

/**
 * Keeps the stack at {@link MAX_TOASTS}: evicts the oldest notice first, then
 * the oldest confirmed toast. In-flight toasts are never evicted, and neither
 * is a failure — it stays until the owner closes it, so a stack made only of
 * those may grow past the cap rather than drop one.
 */
function trim(entries: Entry[]): Entry[] {
  let next = entries;
  for (const evictable of [isNotice, isConfirmed]) {
    while (next.length > MAX_TOASTS) {
      const i = next.findIndex(evictable);
      if (i === -1) break;
      next = [...next.slice(0, i), ...next.slice(i + 1)];
    }
  }
  return next;
}

function isNotice(entry: Entry): boolean {
  return entry.kind === "notice";
}

function isConfirmed(entry: Entry): boolean {
  return entry.kind === "tx" && entry.data.state === "confirmed";
}

const NO_PROVIDER: TxToastsApi = { upsert: () => {}, notify: () => {}, dismiss: () => {} };

/** The toast stack. Usable without a provider (a component rendered alone in a test) — it then shows nothing. */
export function useTxToasts(): TxToastsApi {
  return useContext(TxToastContext) ?? NO_PROVIDER;
}

/** The slice of `useContractAction`'s result a toast follows. */
export interface TrackedAction {
  state: TxState;
  hash: string | null;
  error: TxError | null;
  details: TxDetailsProps | null;
}

export interface UseTxToastOptions {
  /**
   * The fallback description, for a run started without {@link TxToastHandle.begin}.
   * Read once, when that run starts.
   */
  label?: string | (() => string);
  explorerUrl?: (hash: string) => string;
}

export interface TxToastHandle {
  /**
   * Call right before `action.run(...)`: the next run gets its own toast,
   * described by `label` ("Freeze inference-agent", "Fund … with 12.50
   * USDC"). Fixed for that run, so the toast keeps describing what was
   * signed after the card flips state. Ignored while a run is in flight
   * (`run()` itself refuses a second one).
   */
  begin(label: string): void;
}

function isInFlight(state: TxState): boolean {
  return state === "preparing" || state === "signing" || state === "submitted";
}

/**
 * Mirrors one `useContractAction` instance into the toast stack: each run
 * gets its own toast, updated as the state machine advances. A run starts
 * at {@link TxToastHandle.begin} or, failing that, at any entry into
 * `preparing`. `reset()` back to `idle` leaves the toast alone.
 *
 * If the component holding the action unmounts mid-flight, the hook stops
 * hearing about the transaction — the toast then says so instead of spinning
 * forever, and points at the explorer when the hash is already known.
 */
export function useTxToast(action: TrackedAction, opts: UseTxToastOptions = {}): TxToastHandle {
  const { upsert } = useTxToasts();
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const runRef = useRef<{ id: string; label: string } | null>(null);
  const pendingRef = useRef<{ id: string; label: string } | null>(null);
  const prevStateRef = useRef<TxState>("idle");
  const lastRef = useRef<TxToastData | null>(null);
  // Bumped by `begin()`, so a new run is picked up even when its states are
  // batched into one render that looks identical to the last run's.
  const [seq, setSeq] = useState(0);

  const { state, hash, error, details } = action;
  const stateRef = useRef(state);
  stateRef.current = state;

  const begin = useCallback((label: string) => {
    if (isInFlight(stateRef.current)) return;
    pendingRef.current = { id: newId("tx"), label };
    setSeq((n) => n + 1);
  }, []);

  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (state === "idle") {
      if (!pendingRef.current) {
        runRef.current = null;
        lastRef.current = null;
      }
      return;
    }
    if (pendingRef.current) {
      runRef.current = pendingRef.current;
      pendingRef.current = null;
    } else if (runRef.current === null || (state === "preparing" && prev !== "preparing")) {
      const { label = "Transaction" } = optsRef.current;
      runRef.current = { id: newId("tx"), label: typeof label === "function" ? label() : label };
    }
    const data: TxToastData = {
      label: runRef.current.label,
      state,
      hash: hash ?? undefined,
      error: error ?? undefined,
      details: details ?? undefined,
      explorerUrl: hash ? optsRef.current.explorerUrl?.(hash) : undefined,
    };
    lastRef.current = data;
    upsert(runRef.current.id, data);
  }, [state, hash, error, details, seq, upsert]);

  useEffect(
    () => () => {
      const run = runRef.current;
      const last = lastRef.current;
      if (!run || !last || !isInFlight(last.state)) return;
      upsert(run.id, {
        ...last,
        state: "failed",
        error: {
          title: "No longer following this transaction",
          detail: "You left the screen before it confirmed — it may still land.",
          next: last.hash ? "Check its status on the explorer." : undefined,
        },
      });
    },
    [upsert],
  );

  return useMemo(() => ({ begin }), [begin]);
}
