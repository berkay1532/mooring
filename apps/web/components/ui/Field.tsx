"use client";

import { useId } from "react";
import type { InputHTMLAttributes } from "react";

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  hint?: string;
  error?: string;
  /** A short suffix shown inside the input box, e.g. "USDC" (mockup's `.in .unit`). */
  unit?: string;
  id?: string;
  className?: string;
  inputClassName?: string;
}

/** A labelled input in the mockup's dark input-box style, with a hint or an error. */
export function Field({
  label,
  hint,
  error,
  unit,
  id,
  className,
  inputClassName,
  ...props
}: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={className}>
      <label htmlFor={inputId} className="mt-3.5 block font-body text-xs text-text-lo">
        {label}
      </label>
      <div
        className={`mt-1.5 flex items-center justify-between rounded-[10px] border bg-bg-raised px-3.5 py-2.5 ${
          error ? "border-danger/60" : "border-text-hi/[0.12]"
        }`}
      >
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`w-full min-w-0 bg-transparent font-body text-sm text-text-hi outline-none placeholder:text-text-lo/60 ${inputClassName ?? ""}`}
          {...props}
        />
        {unit ? <span className="ml-2 shrink-0 font-mono text-xs text-text-lo">{unit}</span> : null}
      </div>
      {error ? (
        <p id={errorId} className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-text-lo">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
