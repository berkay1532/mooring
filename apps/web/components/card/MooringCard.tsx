"use client";

import { useMemo } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

import { shortAddress } from "@/lib/format/address";
import { formatCountdown } from "@/lib/format/time";
import { formatUsdc } from "@/lib/format/usdc";

export type MooringCardSize = "carousel" | "preview" | "thumb";
export type MooringCardState = "active" | "frozen" | "expired" | "cancelled" | "draft";

export interface MooringCardProps {
  size: MooringCardSize;
  state: MooringCardState;
  /** The on-chain card label, owner-chosen at creation (spec §2, `set_label`). */
  label: string;
  address?: string;
  balance?: bigint;
  spent?: bigint;
  periodAmount?: bigint;
  /** Unix seconds. */
  expiry?: number;
  allowCount?: number;
  signer?: string;
  selected?: boolean;
  /** Set to `false` to disable the pointer tilt regardless of size/motion preference. Defaults to `true`. */
  tilt?: boolean;
  /** Injectable "now" (Unix seconds) for the expiry countdown — defaults to the real clock, overridable in tests. */
  nowUnix?: number;
  className?: string;
}

const DIMENSIONS: Record<MooringCardSize, { width: number; height: number; radius: number }> = {
  carousel: { width: 420, height: 250, radius: 20 },
  preview: { width: 380, height: 226, radius: 20 },
  thumb: { width: 44, height: 28, radius: 6 },
};

const STATUS_TEXT: Record<MooringCardState, string> = {
  active: "● active",
  frozen: "❄ frozen",
  expired: "○ expired",
  cancelled: "— cancelled",
  draft: "○ draft",
};

const STATUS_TONE: Record<MooringCardState, string> = {
  active: "text-seaglass",
  frozen: "text-seaglass",
  expired: "text-text-lo",
  cancelled: "text-text-lo",
  draft: "text-text-lo",
};

/** Pointer tilt is capped at 4 degrees of rotation on each axis (spec §5). */
const MAX_TILT_DEG = 4;

/**
 * The mockup's layered "physical object" shadow stack. Expired/cancelled
 * cards drop the amber ring and ambient glow entirely ("dimmed, no glow");
 * a draft card (not yet created on-chain) gets a dashed border instead of a
 * shadow ring; everything else carries the ambient amber ring, brightened
 * to the "selected" alpha when `selected` is true.
 */
function cardShadow(size: MooringCardSize, state: MooringCardState, selected: boolean): string {
  if (size === "thumb") {
    return "0 4px 10px rgba(0,0,0,.4)";
  }

  const layers = [
    "inset 0 1px 0 rgba(242,238,228,.14)",
    "inset 0 -1px 0 rgba(0,0,0,.5)",
    size === "carousel" ? "0 2px 4px rgba(0,0,0,.35)" : null,
    "0 12px 24px rgba(0,0,0,.45)",
    "0 40px 80px rgba(0,0,0,.55)",
  ].filter((layer): layer is string => layer !== null);

  if (state === "expired" || state === "cancelled" || state === "draft") {
    return layers.join(", ");
  }

  layers.push(selected ? "0 0 0 1px rgba(242,180,74,.5)" : "0 0 0 1px rgba(242,180,74,.25)", "0 0 60px rgba(242,180,74,.12)");
  return layers.join(", ");
}

/**
 * The card face used across the carousel (`carousel`), the wizard's live
 * preview (`preview`), and list-row thumbnails (`thumb`) — one component,
 * three sizes, five states (spec §5, mockup
 * `2026-09-13-cards-carousel-f2.html`). `thumb` renders only the small
 * decorative face (no text, no tilt), matching the mockup's `.mini` list
 * thumbnail.
 */
export function MooringCard({
  size,
  state,
  label,
  address,
  balance,
  spent,
  periodAmount,
  expiry,
  allowCount = 0,
  signer,
  selected = false,
  tilt = true,
  nowUnix,
  className,
}: MooringCardProps) {
  const dims = DIMENSIONS[size];
  const isFullFace = size !== "thumb";

  // Recomputed on every render rather than cached in state: `matchMedia`
  // reads are cheap, and this keeps the check trivially testable by
  // stubbing `window.matchMedia` before render (no need to flush effects).
  const reducedMotion =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
  const tiltEnabled = isFullFace && tilt && !reducedMotion;

  const now = nowUnix ?? Math.floor(Date.now() / 1000);
  const expiresText = expiry === undefined ? "—" : formatCountdown(expiry, now);

  const budgetPct = useMemo(() => {
    if (periodAmount === undefined || periodAmount <= 0n) return 0;
    const spentBase = spent ?? 0n;
    const permille = (spentBase * 10_000n) / periodAmount;
    return Math.max(0, Math.min(100, Number(permille) / 100));
  }, [spent, periodAmount]);

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    const width = rect.width || 1;
    const height = rect.height || 1;
    const relX = (event.clientX - rect.left) / width - 0.5;
    const relY = (event.clientY - rect.top) / height - 0.5;
    el.style.setProperty("--tilt-x", `${(-relY * MAX_TILT_DEG * 2).toFixed(2)}deg`);
    el.style.setProperty("--tilt-y", `${(relX * MAX_TILT_DEG * 2).toFixed(2)}deg`);
  }

  function handlePointerLeave(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.style.setProperty("--tilt-x", "0deg");
    event.currentTarget.style.setProperty("--tilt-y", "0deg");
  }

  const desaturated = state === "frozen";
  const dimmed = state === "expired" || state === "cancelled";
  const glowTone = state === "frozen" ? "rgba(127,184,168,.26)" : "rgba(242,180,74,.26)";

  const baseStyle: CSSProperties = {
    width: dims.width,
    height: dims.height,
    borderRadius: dims.radius,
    background: "linear-gradient(135deg,#17304a 0%,#0e1d30 55%,#0a1522 100%)",
    border: state === "draft" ? "1px dashed rgba(242,238,228,.3)" : "1px solid rgba(242,238,228,.16)",
    boxShadow: cardShadow(size, state, selected),
    opacity: dimmed ? 0.55 : 1,
    filter: desaturated ? "saturate(0.35) brightness(0.85)" : undefined,
    transform: tiltEnabled ? "rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg))" : undefined,
    transition: "transform 150ms ease-out",
    transformStyle: tiltEnabled ? "preserve-3d" : undefined,
  };

  const rootAttrs = {
    "data-selected": selected ? "true" : "false",
    "data-state": state,
    "data-size": size,
    "aria-label": `${label} card, ${state}`,
  } as const;

  if (!isFullFace) {
    return (
      <div {...rootAttrs} className={`relative shrink-0 overflow-hidden ${className ?? ""}`} style={baseStyle}>
        <span
          aria-hidden
          className="absolute right-[5px] top-[5px] h-[6px] w-[9px] rounded-[2px]"
          style={{ background: desaturated || dimmed ? "rgba(242,238,228,.4)" : "#f2b44a" }}
        />
      </div>
    );
  }

  const balanceSizeClass = size === "carousel" ? "text-[44px]" : "text-[40px]";

  return (
    <div
      {...rootAttrs}
      role="group"
      onPointerMove={tiltEnabled ? handlePointerMove : undefined}
      onPointerLeave={tiltEnabled ? handlePointerLeave : undefined}
      className={`relative shrink-0 overflow-hidden px-[26px] py-[22px] ${className ?? ""}`}
      style={baseStyle}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-[70%] -left-[10%] -right-[10%] h-[90%]"
        style={{
          background: dimmed ? "none" : `radial-gradient(ellipse at center, ${glowTone}, transparent 60%)`,
        }}
      />
      <span
        aria-hidden
        className="absolute right-6 top-6 h-[26px] w-[38px] rounded-[7px]"
        style={{ background: "linear-gradient(135deg, #f7d089, #c98a2a)" }}
      />

      <div className="font-display text-xl tracking-[0.08em] text-text-hi">MOORING</div>
      <div data-testid="status" className={`mt-2 font-mono text-[11px] uppercase tracking-[0.16em] ${STATUS_TONE[state]}`}>
        {STATUS_TEXT[state]}
      </div>

      <div className="mt-8 font-mono text-[11px] uppercase tracking-[0.16em] text-text-lo">balance</div>
      <div data-testid="balance" className={`font-display leading-none text-text-hi ${balanceSizeClass}`}>
        {balance === undefined ? "—" : formatUsdc(balance)} <span className="font-body text-[15px] text-text-lo">USDC</span>
      </div>

      <div className="mt-4 flex items-baseline justify-between font-mono text-[11px] uppercase tracking-[0.16em] text-text-lo">
        <span data-testid="budget-spent">
          {periodAmount === undefined ? "no budget set" : `${formatUsdc(spent ?? 0n)} / ${formatUsdc(periodAmount)}`}
        </span>
        <span data-testid="budget-expiry">expires {expiresText}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-text-hi/[0.08]">
        <div className="h-full rounded-full bg-seaglass" style={{ width: `${budgetPct}%` }} />
      </div>

      <div className="mt-4 flex items-baseline justify-between font-mono text-[11px] uppercase tracking-[0.16em] text-text-lo">
        <span data-testid="allow-count">
          {allowCount} merchant{allowCount === 1 ? "" : "s"}
        </span>
        <span data-testid="footer-signer">signer {signer ? shortAddress(signer) : "—"}</span>
      </div>
      <div className="mt-2 flex items-baseline justify-between font-mono text-[11px] text-text-lo">
        <span data-testid="footer-label" className="normal-case text-text-hi">
          {label}
        </span>
        <span data-testid="footer-address" className="normal-case text-text-hi">
          {address ? shortAddress(address) : "—"}
        </span>
      </div>
    </div>
  );
}
