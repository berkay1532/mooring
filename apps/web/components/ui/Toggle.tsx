"use client";

import { useRef } from "react";
import type { KeyboardEvent } from "react";

export interface ToggleOption<T extends string = string> {
  value: T;
  label: string;
}

export interface ToggleProps<T extends string = string> {
  options: readonly ToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  "aria-label"?: string;
}

/**
 * A segmented control (mockup's `.toggle`/`.seg`), rendered as an ARIA
 * `radiogroup` with roving-tabindex arrow-key navigation. Controlled: the
 * caller owns `value` and updates it from `onChange`.
 */
export function Toggle<T extends string = string>({
  options,
  value,
  onChange,
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
    }
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      {...aria}
      className={`inline-flex rounded-full border border-text-hi/[0.14] p-0.5 ${className ?? ""}`}
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
            className={`rounded-full px-3.5 py-1.5 font-body text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber ${
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
