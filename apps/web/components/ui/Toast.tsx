"use client";

import { useEffect, useRef } from "react";

export type ToastTone = "default" | "success" | "danger";

export interface ToastProps {
  message: string;
  tone?: ToastTone;
  /** Milliseconds before `onDismiss` fires automatically. Defaults to 4000. */
  duration?: number;
  onDismiss: () => void;
  /**
   * Rendered inside the global toast stack (`TxToastProvider`), which owns
   * the position and the live region — so no fixed placement and no
   * `aria-live` of its own. Defaults to `false` (a standalone, fixed toast).
   */
  inline?: boolean;
  className?: string;
}

const TONE_CLASS: Record<ToastTone, string> = {
  default: "border-text-hi/[0.14] text-text-hi",
  success: "border-seaglass/40 text-seaglass",
  danger: "border-danger/40 text-danger-text",
};

/**
 * A bottom-right, auto-dismissing notice (spec §4 `Toast`). The parent
 * controls presence by mounting/unmounting it.
 *
 * The dismiss timer depends only on `[duration]`, not `onDismiss` — an
 * inline `onDismiss={() => setOpen(false)}` (the common call shape) gets a
 * new identity on every parent re-render, which would restart the clock
 * each time and could leave the toast on screen indefinitely on a page with
 * other ticking state. The latest `onDismiss` is read from a ref instead.
 */
export function Toast({ message, tone = "default", duration = 4000, onDismiss, inline = false, className }: ToastProps) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const timer = window.setTimeout(() => onDismissRef.current(), duration);
    return () => window.clearTimeout(timer);
  }, [duration]);

  return (
    <div
      role="status"
      aria-live={inline ? undefined : "polite"}
      className={`${inline ? "pointer-events-auto" : "fixed bottom-6 right-6 z-50"} rounded-2xl border bg-surface px-5 py-3 font-body text-sm shadow-[0_20px_40px_rgba(0,0,0,.5)] ${TONE_CLASS[tone]} ${className ?? ""}`}
    >
      {message}
    </div>
  );
}
