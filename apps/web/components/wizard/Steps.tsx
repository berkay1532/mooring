"use client";

export const STEP_TITLES = ["Policy", "Agent & merchants", "Confirm"] as const;

export interface StepsProps {
  /** 0-based index of the step on screen. */
  current: number;
  /** The furthest step reached so far — later chips stay disabled. */
  maxReached: number;
  onGo: (step: number) => void;
  className?: string;
}

/**
 * The wizard's step chips (mockup `.steps`): the current step is the amber
 * pill, completed steps are seaglass and clickable, and anything not yet
 * reached is disabled — a chip is a shortcut back, never a way to skip
 * validation.
 */
export function Steps({ current, maxReached, onGo, className }: StepsProps) {
  return (
    <nav aria-label="New card steps" className={`flex flex-wrap items-center gap-2.5 ${className ?? ""}`}>
      {STEP_TITLES.map((title, index) => {
        const done = index < current;
        const active = index === current;
        const reachable = index <= maxReached;
        const tone = active
          ? "border-amber bg-amber font-bold text-bg-deep"
          : done
            ? "border-seaglass/40 text-seaglass hover:border-seaglass"
            : "border-text-hi/[0.12] text-text-lo";
        return (
          <button
            key={title}
            type="button"
            disabled={!reachable || active}
            aria-current={active ? "step" : undefined}
            onClick={() => onGo(index)}
            className={`rounded-full border px-3 py-1.5 font-body text-xs transition disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber ${tone}`}
          >
            {done ? `✓ ${title}` : `${index + 1} · ${title}`}
          </button>
        );
      })}
    </nav>
  );
}
