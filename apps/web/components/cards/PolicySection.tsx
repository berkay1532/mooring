"use client";

import { periodLabel } from "@/components/cards/summary";
import { Button } from "@/components/ui/Button";
import type { CardInfo } from "@/lib/chain/card";
import { formatCountdown, formatDuration } from "@/lib/format/time";
import { formatUsdc } from "@/lib/format/usdc";

export interface PolicySectionProps {
  info: CardInfo;
  nowUnix: number;
  onEdit: () => void;
  disabled?: boolean;
}

export const SURFACE_CLASS = "rounded-[14px] border border-text-hi/[0.07] bg-surface px-5 py-[18px]";
export const SECTION_HEAD_CLASS = "flex items-center justify-between gap-3";
export const SECTION_LABEL_CLASS = "font-mono text-[11px] uppercase tracking-[0.16em] text-text-lo";
export const KV_CLASS = "flex items-center justify-between gap-3 border-b border-text-hi/[0.06] py-2.5 text-sm";
export const SMALL_BUTTON_CLASS = "px-3 py-1.5 text-xs";

function expiryDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * The card's policy as the owner set it, plus the live "period resets in …"
 * countdown (mockup's Politika panel). The period boundary is derived the
 * same way the contract derives it: `start + duration`, with elapsed whole
 * periods rolled forward (no carry-over).
 */
export function PolicySection({ info, nowUnix, onEdit, disabled }: PolicySectionProps) {
  const duration = Number(info.policy.period_duration);
  const start = Number(info.period.start);
  const elapsed = Math.max(0, nowUnix - start);
  const periodsPassed = duration > 0 ? Math.floor(elapsed / duration) : 0;
  const resetsAt = duration > 0 ? start + (periodsPassed + 1) * duration : nowUnix;

  return (
    <div className={SURFACE_CLASS}>
      <div className={SECTION_HEAD_CLASS}>
        <span className={SECTION_LABEL_CLASS}>Policy</span>
        <Button variant="ghost" className={SMALL_BUTTON_CLASS} onClick={onEdit} disabled={disabled}>
          Edit policy
        </Button>
      </div>
      <div className={KV_CLASS}>
        <span>Period budget</span>
        <b className="font-medium text-text-hi" title={`${formatUsdc(info.policy.period_amount, { full: true })} USDC`}>
          {formatUsdc(info.policy.period_amount)} USDC / {periodLabel(info.policy.period_duration)}
        </b>
      </div>
      <div className={KV_CLASS}>
        <span>Max per transaction</span>
        <b className="font-medium text-text-hi" title={`${formatUsdc(info.policy.max_per_tx, { full: true })} USDC`}>
          {formatUsdc(info.policy.max_per_tx)} USDC
        </b>
      </div>
      <div className={KV_CLASS}>
        <span>Expires</span>
        <b className="font-medium text-text-hi">
          {expiryDate(Number(info.policy.expiry))} · {formatCountdown(Number(info.policy.expiry), nowUnix)}
        </b>
      </div>
      <div className={`${KV_CLASS} border-b-0`}>
        <span>Period resets in</span>
        <b className="font-medium text-text-hi">{formatDuration(resetsAt - nowUnix)}</b>
      </div>
    </div>
  );
}
