import type { ReactNode } from "react";

export type PillTone = "active" | "frozen" | "expired" | "cancelled";

export interface PillProps {
  tone: PillTone;
  children: ReactNode;
  className?: string;
}

const TONE_CLASS: Record<PillTone, string> = {
  active: "bg-seaglass/15 text-seaglass",
  frozen: "bg-text-lo/15 text-text-lo",
  expired: "bg-danger/15 text-danger",
  cancelled: "bg-danger/10 text-danger/70",
};

/** A small status pill (mockup's `.pill.act`/`.frz`/`.exp`) for list rows and headers. */
export function Pill({ tone, children, className }: PillProps) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 font-body text-[11px] leading-normal ${TONE_CLASS[tone]} ${className ?? ""}`}
    >
      {children}
    </span>
  );
}
