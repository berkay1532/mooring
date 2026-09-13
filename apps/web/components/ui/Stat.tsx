import type { ReactNode } from "react";

export interface StatProps {
  label: string;
  value: ReactNode;
  className?: string;
}

/** A mono label over a big serif value (mockup's `.stat div b`) — balance, remaining, per-tx, expires. */
export function Stat({ label, value, className }: StatProps) {
  return (
    <div className={className}>
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-lo">{label}</span>
      <b className="mt-0.5 block font-display text-2xl font-normal leading-none text-text-hi">{value}</b>
    </div>
  );
}
