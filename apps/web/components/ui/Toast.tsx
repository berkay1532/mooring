"use client";

import { useEffect } from "react";

export type ToastTone = "default" | "success" | "danger";

export interface ToastProps {
  message: string;
  tone?: ToastTone;
  /** Milliseconds before `onDismiss` fires automatically. Defaults to 4000. */
  duration?: number;
  onDismiss: () => void;
  className?: string;
}

const TONE_CLASS: Record<ToastTone, string> = {
  default: "border-text-hi/[0.14] text-text-hi",
  success: "border-seaglass/40 text-seaglass",
  danger: "border-danger/40 text-danger",
};

/** A bottom-right, auto-dismissing notice (spec §4 `Toast`). The parent controls presence by mounting/unmounting it. */
export function Toast({ message, tone = "default", duration = 4000, onDismiss, className }: ToastProps) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [onDismiss, duration]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-6 right-6 z-50 rounded-2xl border bg-surface px-5 py-3 font-body text-sm shadow-[0_20px_40px_rgba(0,0,0,.5)] ${TONE_CLASS[tone]} ${className ?? ""}`}
    >
      {message}
    </div>
  );
}
