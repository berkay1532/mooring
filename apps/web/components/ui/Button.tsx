"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "ghost" | "danger";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  /** Visual style — the amber pill, a bordered ghost pill, or a danger-bordered pill. Defaults to `"primary"`. */
  variant?: ButtonVariant;
  /** Shows a spinner, disables the button, and sets `aria-busy`. */
  loading?: boolean;
  children: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-amber text-bg-deep font-bold hover:brightness-110",
  ghost: "border border-text-hi/[0.18] text-text-hi hover:border-text-hi/40",
  danger: "border border-danger/40 text-danger hover:bg-danger/10",
};

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2 focus-visible:ring-offset-bg-deep";

/**
 * The app's one button primitive (mockup's `.btn`/`.ghost` pills): three
 * variants, always `type="button"` (this app never submits a native form),
 * `disabled` + `aria-busy` while `loading`.
 */
export function Button({ variant = "primary", loading, disabled, className, children, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-[18px] py-2.5 font-body text-[13px] transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASS[variant]} ${FOCUS_RING} ${className ?? ""}`}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current/30 border-t-current"
        />
      ) : null}
      {children}
    </button>
  );
}
