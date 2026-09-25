"use client";

import { MooringCard } from "@/components/card/MooringCard";

export interface PreviewCardProps {
  /** The label as typed. Empty shows a placeholder rather than a blank line. */
  label: string;
  /** Period budget in base units, once it parses. */
  budgetBase?: bigint;
  /** Expiry in Unix seconds, once it resolves. */
  expiryUnix?: number;
  merchantCount: number;
  /** The agent's `G…` key, once it is valid. */
  signer?: string;
  /** The address the card will be deployed at, once discovery has answered. */
  address?: string;
  nowUnix: number;
  className?: string;
}

/**
 * The wizard's live preview (mockup's left column): the same
 * {@link MooringCard} face the dashboard shows, in the `draft` state —
 * dashed border, no glow, "○ draft" — and updating as the form is typed.
 *
 * A draft has spent nothing yet, so the budget line reads
 * `budget / budget` with an empty bar, and the balance is 0 until the card
 * is funded.
 */
export function PreviewCard({
  label,
  budgetBase,
  expiryUnix,
  merchantCount,
  signer,
  address,
  nowUnix,
  className,
}: PreviewCardProps) {
  return (
    <div className={`shrink-0 ${className ?? ""}`}>
      <MooringCard
        size="preview"
        state="draft"
        label={label.trim() || "unnamed card"}
        balance={0n}
        spent={0n}
        periodAmount={budgetBase}
        expiry={expiryUnix}
        allowCount={merchantCount}
        signer={signer}
        address={address}
        nowUnix={nowUnix}
      />
      <p className="mt-3 max-w-[380px] text-xs text-text-lo">
        The preview updates as you type. The name is stored on the card itself, on chain, and you can
        rename it later.
      </p>
    </div>
  );
}
