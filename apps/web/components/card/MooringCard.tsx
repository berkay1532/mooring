"use client";

import { useMemo } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

import { Logo } from "@/components/layout/Logo";
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
  /** Number of allowlisted merchants, drawn in the footer (`—` when unknown). */
  allowCount?: number;
  /** The agent signer address, drawn shortened in the footer (`—` when unknown). */
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

// Lowercase here, uppercased by CSS: the DOM text stays readable and the
// pill matches the landing card's mono caps.
const STATUS_TEXT: Record<MooringCardState, string> = {
  active: "active",
  frozen: "frozen",
  expired: "expired",
  cancelled: "cancelled",
  draft: "draft",
};

/** Status dot: amber glow when active, seaglass when frozen, an unlit text-lo dot otherwise. */
const STATUS_DOT: Record<MooringCardState, string> = {
  active: "bg-amber shadow-[0_0_6px_var(--color-amber)]",
  frozen: "bg-seaglass shadow-[0_0_6px_var(--color-seaglass)]",
  expired: "bg-text-lo",
  cancelled: "bg-text-lo",
  draft: "bg-text-lo",
};

/** Pointer tilt is capped at 4 degrees of rotation on each axis (spec §5). */
const MAX_TILT_DEG = 4;

/** Amber normally; frozen swaps the ambient ring/glow tint to seaglass (spec §5: "desaturated, seaglass glow"). */
function ringRgb(state: MooringCardState): string {
  return state === "frozen" ? "127,184,168" : "242,180,74";
}

/** The landing card's shadow, shared by both full faces; the state ring/glow is appended per state. */
const LANDING_SHADOW = "0 30px 80px -20px rgba(0,0,0,.85), inset 0 1px 0 rgba(242,238,228,.08)";

/**
 * The layered "physical object" shadow stack, split per size, led by the
 * landing card's shadow: `carousel` adds the inset bottom edge, the 2/12px
 * drop shadows and the ambient ring+glow; `preview` uses the lighter stack
 * (no inset-bottom, no 2px layer, no glow, ring at
 * `.2` alpha — not the carousel's `.25`/`.5`). Expired/cancelled/draft cards
 * drop the ring and glow entirely ("dimmed, no glow" / a dashed border
 * instead of a shadow ring). The ring/glow tint follows {@link ringRgb}.
 */
function cardShadow(size: MooringCardSize, state: MooringCardState, selected: boolean): string {
  if (size === "thumb") {
    return "0 4px 10px rgba(0,0,0,.4)";
  }

  const rgb = ringRgb(state);
  const noGlow = state === "expired" || state === "cancelled" || state === "draft";

  if (size === "preview") {
    const layers = [LANDING_SHADOW, "0 12px 24px rgba(0,0,0,.45)"];
    if (noGlow) return layers.join(", ");
    layers.push(`0 0 0 1px rgba(${rgb},.2)`);
    return layers.join(", ");
  }

  const layers = [LANDING_SHADOW, "inset 0 -1px 0 rgba(0,0,0,.5)", "0 2px 4px rgba(0,0,0,.35)", "0 12px 24px rgba(0,0,0,.45)"];
  if (noGlow) return layers.join(", ");
  layers.push(selected ? `0 0 0 1px rgba(${rgb},.5)` : `0 0 0 1px rgba(${rgb},.25)`, `0 0 60px rgba(${rgb},.12)`);
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
  allowCount,
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
  // Only gates whether the pointer handlers are attached — never the
  // `transform`/`transformStyle` inline styles themselves (see `baseStyle`
  // below), so SSR (no `window`, `reducedMotion` = false) and a
  // reduced-motion client always agree on the rendered style attribute and
  // React never warns about a hydration mismatch.
  const reducedMotion =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
  const tiltEnabled = isFullFace && tilt && !reducedMotion;

  // `nowUnix` is injectable because `Date.now()` differs between the server
  // render and the first client render: a card rendered on the server would
  // hydrate with a countdown computed a few hundred milliseconds earlier. The
  // pages that render cards pass a value frozen on the client (the wizard's
  // `nowUnix`, the dashboard's ticking `now`); the fallback below is only for
  // a standalone render, where the countdown is coarse enough (minutes, then
  // days) that the difference is invisible.
  const now = nowUnix ?? Math.floor(Date.now() / 1000);
  const expiresText = expiry === undefined ? "—" : formatCountdown(expiry, now);

  // Budget semantics (spec + controller ruling): the line shows what's left
  // this period (`periodAmount - spent`, clamped at 0), not what's spent —
  // "40.00 / 50.00" reads as "40 left of a 50 budget". The bar still fills
  // with the *spent* fraction (10 spent of 50 -> a 20% bar).
  const remaining = useMemo(() => {
    if (periodAmount === undefined) return undefined;
    const r = periodAmount - (spent ?? 0n);
    return r < 0n ? 0n : r;
  }, [spent, periodAmount]);

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
    const relX = clamp((event.clientX - rect.left) / width - 0.5, -0.5, 0.5);
    const relY = clamp((event.clientY - rect.top) / height - 0.5, -0.5, 0.5);
    el.style.setProperty("--tilt-x", `${(-relY * MAX_TILT_DEG * 2).toFixed(2)}deg`);
    el.style.setProperty("--tilt-y", `${(relX * MAX_TILT_DEG * 2).toFixed(2)}deg`);
  }

  function handlePointerLeave(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.style.setProperty("--tilt-x", "0deg");
    event.currentTarget.style.setProperty("--tilt-y", "0deg");
  }

  const desaturated = state === "frozen";
  const dimmed = state === "expired" || state === "cancelled";

  const baseStyle: CSSProperties = {
    width: dims.width,
    height: dims.height,
    borderRadius: dims.radius,
    background: "linear-gradient(135deg,#16283f 0%,#0d1b2e 45%,#070f1c 100%)",
    border: state === "draft" ? "1px dashed rgba(242,238,228,.3)" : "1px solid rgba(242,238,228,.15)",
    boxShadow: cardShadow(size, state, selected),
    opacity: dimmed ? 0.55 : 1,
    filter: desaturated ? "saturate(0.35) brightness(0.85)" : undefined,
    // Constant across renders/environments (depends only on `size`, a prop —
    // never on `reducedMotion`, which differs between SSR and a
    // reduced-motion client): keeps hydration stable. `perspective()` makes
    // rotateX/rotateY read as a tilt rather than a skew when this card
    // isn't inside a carousel stage that already supplies one (the wizard's
    // standalone `preview`).
    transform: isFullFace ? "perspective(1200px) rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg))" : undefined,
    transition: "transform 150ms ease-out",
    transformStyle: isFullFace ? "preserve-3d" : undefined,
  };

  const rootAttrs = {
    "data-selected": selected ? "true" : "false",
    "data-state": state,
    "data-size": size,
    "aria-label": `${label} card, ${state}`,
  } as const;

  if (!isFullFace) {
    return (
      <div
        {...rootAttrs}
        role="img"
        className={`relative shrink-0 overflow-hidden ${className ?? ""}`}
        style={baseStyle}
      >
        <span
          aria-hidden
          className="absolute right-[5px] top-[5px] h-[6px] w-[9px] rounded-[2px]"
          style={{ background: desaturated || dimmed ? "rgba(242,238,228,.4)" : "#f2b44a" }}
        />
      </div>
    );
  }

  const isCarousel = size === "carousel";
  const balanceSizeClass = isCarousel ? "text-[44px]" : "text-[40px]";
  // Vertical rhythm: the faces are fixed-height flex columns (carousel content
  // box 250 − 2×20 padding − 2 border = 208px; preview 226 − 2×16 − 2 = 192px).
  // The footer rides the baseline via `mt-auto`; the balance gap tightens on
  // the shorter preview face.
  const balanceGapClass = isCarousel ? "mt-3" : "mt-2";
  const footerGapClass = isCarousel ? "pt-3" : "pt-2";
  const paddingClass = isCarousel ? "px-6 py-5" : "px-6 py-4";
  const budgetText = periodAmount === undefined ? "no budget set" : `${formatUsdc(remaining ?? 0n)} / ${formatUsdc(periodAmount)}`;
  const spentText = `${formatUsdc(spent ?? 0n)} spent`;
  const signerText = signer ? shortAddress(signer) : "—";

  return (
    <div
      {...rootAttrs}
      role="group"
      onPointerMove={tiltEnabled ? handlePointerMove : undefined}
      onPointerLeave={tiltEnabled ? handlePointerLeave : undefined}
      className={`relative flex shrink-0 flex-col overflow-hidden text-left ${paddingClass} ${className ?? ""}`}
      style={baseStyle}
    >
      {/* light sweep */}
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-y-1/2 left-[18%] w-[34%] rotate-[18deg] bg-gradient-to-r from-transparent via-text-hi/[0.05] to-transparent"
      />
      {/* amber corner glow */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-[16%] -top-[32%] h-[70%] w-[55%] rounded-full bg-amber/10 blur-2xl"
        style={{ display: dimmed ? "none" : undefined }}
      />
      {/* subtle mooring-line texture */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04] [background:repeating-linear-gradient(104deg,transparent_0,transparent_10px,var(--color-seaglass)_10px,transparent_11px)]"
      />

      {/* top: emblem + wordmark | status */}
      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-amber/40 bg-amber/10 shadow-[inset_0_1px_2px_rgba(0,0,0,0.5),0_1px_0_rgba(242,238,228,0.1)]">
            <Logo size={17} />
          </span>
          <span className="font-display text-xl leading-6 tracking-[0.08em] text-text-hi">MOORING</span>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-text-hi/10 bg-bg-deep/50 px-2.5 py-1 font-mono text-[10px] uppercase leading-[12px] tracking-[0.25em] text-text-lo">
          <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[state]}`} />
          <span data-testid="status">{STATUS_TEXT[state]}</span>
        </span>
      </div>
      <div data-testid="footer-label" className="relative mt-1 min-w-0 truncate font-body text-[12px] leading-[16px] text-text-lo" title={label}>
        {label}
      </div>

      {/* middle: balance */}
      <div className={`relative ${balanceGapClass}`}>
        <div className="font-mono text-[10px] uppercase leading-[12px] tracking-[0.3em] text-text-lo/80">balance</div>
        <div data-testid="balance" className={`mt-1 font-display leading-none text-text-hi ${balanceSizeClass}`}>
          {balance === undefined ? "—" : formatUsdc(balance)} <span className="font-display text-[15px] text-seaglass">USDC</span>
        </div>
      </div>

      {/* bottom: budget line + bar, then the on-chain identity rows */}
      <div data-part="footer" className={`relative mt-auto ${footerGapClass}`}>
        <div className="flex items-baseline justify-between gap-3 font-mono text-[10px] uppercase leading-[14px] text-text-lo">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 tracking-[0.2em]">
              budget ·{" "}
              <span
                data-testid="budget-remaining"
                title={periodAmount !== undefined && !isCarousel ? "left this period" : undefined}
              >
                {budgetText}
              </span>
            </span>
            {periodAmount !== undefined && isCarousel ? (
              <span className="min-w-0 truncate font-body text-[10px] normal-case tracking-normal text-text-lo">
                left this period
              </span>
            ) : null}
          </span>
          <span className="min-w-0 truncate normal-case text-text-lo">{spentText}</span>
        </div>
        <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-text-hi/10">
          <div
            data-testid="budget-bar-fill"
            className="h-full rounded-full bg-gradient-to-r from-seaglass to-amber"
            style={{ width: `${budgetPct}%` }}
          />
        </div>

        <div className="mt-2 font-mono text-[10px] uppercase leading-[14px] text-text-lo">
          <div className="flex justify-between gap-3">
            <span data-testid="footer-address" className="text-seaglass" title={address}>
              {address ? shortAddress(address) : "—"}
            </span>
            <span className="tracking-[0.1em]">allowlist · {allowCount === undefined ? "—" : allowCount}</span>
          </div>
          <div className="mt-0.5 flex justify-between gap-3">
            <span className="flex min-w-0 items-baseline tracking-[0.05em]">
              <span className="min-w-0 truncate">
                signer · <span title={signer}>{signerText}</span>
              </span>
              <span className="mx-1.5 shrink-0 text-text-lo/40">·</span>
              <span data-testid="budget-expiry" className="shrink-0">
                expires {expiresText}
              </span>
            </span>
            <span className="shrink-0 tracking-[0.15em] text-text-lo">stellar</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
