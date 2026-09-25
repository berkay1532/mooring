"use client";

import type { ReactNode } from "react";

import { Stat } from "@/components/ui/Stat";
import type { CardInfo } from "@/lib/chain/card";
import { formatCountdown } from "@/lib/format/time";
import { formatUsdc } from "@/lib/format/usdc";

export interface StatRowProps {
  info: CardInfo;
  nowUnix: number;
  /** The primary actions (Fund, Freeze/Unfreeze, Withdraw), rendered right-aligned. */
  actions?: ReactNode;
}

/**
 * The four headline numbers of the selected card with the primary actions
 * beside them (mockup's `.head` + `.stat` row). Every USDC figure carries
 * its exact 7-decimal value in a `title`, per spec §5.
 */
export function StatRow({ info, nowUnix, actions }: StatRowProps) {
  const full = (v: bigint) => `${formatUsdc(v, { full: true })} USDC`;
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-wrap gap-7">
        <Stat label="balance" value={<span title={full(info.balance)}>{formatUsdc(info.balance)}</span>} />
        <Stat
          label="remaining this period"
          value={<span title={full(info.remaining)}>{formatUsdc(info.remaining)}</span>}
        />
        <Stat label="per tx" value={<span title={full(info.policy.max_per_tx)}>{formatUsdc(info.policy.max_per_tx)}</span>} />
        <Stat label="expires" value={formatCountdown(Number(info.policy.expiry), nowUnix)} />
      </div>
      {actions ? <div className="flex flex-wrap gap-2.5">{actions}</div> : null}
    </div>
  );
}
