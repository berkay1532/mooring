"use client";

export type TxState = "idle" | "preparing" | "signing" | "submitted" | "confirmed" | "failed";

export interface TxError {
  /** User-facing sentence, e.g. "Policy rejected". */
  title: string;
  /** Optional longer explanation, with the contract error code in parentheses per spec §4.2. */
  detail?: string;
  /**
   * The label for the next step (e.g. "Fix the policy"). Rendered as a
   * clickable button when `onNext` is given, otherwise as plain text — the
   * caller decides whether there is an action to wire up.
   */
  next?: string;
}

export interface TxStatusProps {
  state: TxState;
  /** The transaction hash, once known (from `submitted` onward). */
  hash?: string;
  error?: TxError;
  /** Explorer URL for `hash`. The link is only rendered when both are present. */
  explorerUrl?: string;
  /** Called when `error.next` is clicked. Omit to render `error.next` as plain text. */
  onNext?: () => void;
  className?: string;
}

const STEPS = [
  { key: "prepared", label: "Prepared" },
  { key: "signature", label: "Signature" },
  { key: "submitted", label: "Submitted" },
  { key: "confirmed", label: "Confirmed" },
] as const;

type StepStatus = "done" | "current" | "pending";

/**
 * Index of the step currently in progress, or -1 when there is no in-flight
 * step to highlight (idle — nothing started yet; failed — we don't know
 * which step aborted, so the timeline is hidden entirely in favour of the
 * failure row below).
 */
function activeIndex(state: TxState): number {
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

function stepStatus(state: TxState, index: number): StepStatus {
  if (state === "confirmed") return "done";
  const active = activeIndex(state);
  if (active === -1) return "pending";
  if (index < active) return "done";
  if (index === active) return "current";
  return "pending";
}

const HEADLINES: Partial<Record<TxState, string>> = {
  preparing: "Preparing the transaction",
  signing: "Waiting for signature in your wallet",
  submitted: "Submitted — waiting for confirmation",
  confirmed: "Confirmed",
};

const HINTS: Partial<Record<TxState, string>> = {
  preparing: "Building and simulating the transaction.",
  signing: "Approve the prompt in your wallet. This step is free.",
  submitted: "Waiting for the network to include the transaction.",
};

const STEP_STATUS_CLASS: Record<StepStatus, string> = {
  done: "border-seaglass text-seaglass",
  current: "border-amber text-text-hi",
  pending: "border-text-hi/10 text-text-lo",
};

const BOX_ANATOMY_CLASS = "flex items-center gap-3.5 rounded-[14px] border bg-bg-raised px-4.5 py-3.5";

/**
 * The one shared write-transaction status component (spec §3.4 / mockup
 * `2026-09-13-wizard-and-tx.html`): a status box (spinner while in flight,
 * a coloured dot once settled) over the four-step Prepared → Signature →
 * Submitted → Confirmed timeline, or a failure row with the translated
 * error and an optional next-step action.
 *
 * Design decision: the four-step timeline is only meaningful while the
 * flow is progressing normally (`preparing` .. `confirmed`) — on `failed`
 * we don't know which step aborted, so the timeline is hidden and the
 * failure row carries the explanation instead (matches the mockup, which
 * renders the rejected-policy example as a standalone status row with no
 * timeline).
 */
export function TxStatus({ state, hash, error, explorerUrl, onNext, className }: TxStatusProps) {
  const inFlight = state === "preparing" || state === "signing" || state === "submitted";
  const showBox = state !== "idle";
  const showTimeline = state !== "idle" && state !== "failed";
  const headline = state === "failed" ? (error?.title ?? "Transaction failed") : HEADLINES[state];

  const boxToneClass =
    state === "failed" ? "border-danger/35" : state === "confirmed" ? "border-seaglass/35" : "border-text-hi/10";

  return (
    <div data-state={state} role="status" aria-live="polite" className={className}>
      {showBox ? (
        <div className={`${BOX_ANATOMY_CLASS} ${boxToneClass}`}>
          {inFlight ? (
            <span
              aria-hidden
              className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber/25 border-t-amber"
            />
          ) : (
            <span
              aria-hidden
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${state === "failed" ? "bg-danger" : "bg-seaglass"}`}
            />
          )}
          <div className="min-w-0">
            <div className="font-body text-sm text-text-hi">{headline}</div>

            {state !== "failed" && HINTS[state] ? <p className="mt-1 text-xs text-text-lo">{HINTS[state]}</p> : null}
            {state === "failed" && error?.detail ? <p className="mt-1 text-xs text-text-lo">{error.detail}</p> : null}

            {hash ? (
              <p className="mt-1 text-xs text-text-lo">
                Ledger tx <span className="font-mono text-text-hi">{hash}</span>
                {explorerUrl ? (
                  <>
                    {" · "}
                    <a
                      href={explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-amber underline-offset-2 hover:underline"
                    >
                      view transaction ↗
                    </a>
                  </>
                ) : null}
              </p>
            ) : null}

            {state === "failed" && error?.next ? (
              onNext ? (
                <button
                  type="button"
                  onClick={onNext}
                  className="mt-1.5 rounded font-mono text-xs text-amber underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
                >
                  {error.next}
                </button>
              ) : (
                <span className="mt-1.5 block font-mono text-xs text-amber">{error.next}</span>
              )
            ) : null}
          </div>
        </div>
      ) : null}

      {showTimeline ? (
        <ol className="mt-3.5 flex gap-0">
          {STEPS.map((step, index) => {
            const status = stepStatus(state, index);
            return (
              <li
                key={step.key}
                data-step={step.key}
                data-step-status={status}
                className={`flex-1 border-t-2 pt-2.5 text-center font-body text-[11px] ${STEP_STATUS_CLASS[status]}`}
              >
                {status === "done" ? "✓ " : ""}
                {step.label}
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
