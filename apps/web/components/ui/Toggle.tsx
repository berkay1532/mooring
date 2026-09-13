"use client";

import { useRef } from "react";
import type { KeyboardEvent } from "react";

export interface ToggleOption<T extends string = string> {
  value: T;
  label: string;
}

export type ToggleShape = "pill" | "segment";

export interface ToggleProps<T extends string = string> {
  options: readonly ToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /**
   * `"pill"` (default) for the mockup's fully-rounded `.toggle` (cards
   * header, Cards/List); `"segment"` for the 10px-radius `.seg` (wizard
   * period-unit picker, Fund sheet tabs).
   */
  shape?: ToggleShape;
  className?: string;
  "aria-label"?: string;
}

/**
 * A segmented control (mockup's `.toggle`/`.seg`), rendered as an ARIA
 * `radiogroup` with roving-tabindex arrow-key navigation (Left/Right/Up/Down
 * move and select with wraparound; Home/End jump to the first/last option).
 * Controlled: the caller owns `value` and updates it from `onChange`.
 */
export function Toggle<T extends string = string>({
  options,
  value,
  onChange,
  shape = "pill",
  className,
  ...aria
}: ToggleProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null);

  function selectByIndex(index: number) {
    const wrapped = (index + options.length) % options.length;
    const option = options[wrapped];
    onChange(option.value);
    const radios = groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    radios?.[wrapped]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      selectByIndex(index + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      selectByIndex(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectByIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      selectByIndex(options.length - 1);
    }
  }

  const containerRadius = shape === "segment" ? "rounded-[10px]" : "rounded-full";
  const buttonPaddingY = shape === "segment" ? "py-2" : "py-1.5";

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      {...aria}
      className={`inline-flex overflow-hidden border border-text-hi/[0.14] ${containerRadius} ${className ?? ""}`}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`px-3.5 ${buttonPaddingY} font-body text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber ${
              selected ? "bg-surface text-text-hi" : "text-text-lo hover:text-text-hi"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
