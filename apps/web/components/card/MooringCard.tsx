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
  /**
   * Accepted for callers that have them, but not drawn: the face follows the
   * mockup's two footer rows (budget line + bar, then label · address), and
   * a third row does not fit the fixed card height. The details panel's
   * Merchants and Agent sections show both.
   */
  allowCount?: number;
  /** See {@link MooringCardProps.allowCount}. */
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

/** Amber normally; frozen swaps the ambient ring/glow tint to seaglass (spec §5: "desaturated, seaglass glow"). */
function ringRgb(state: MooringCardState): string {
  return state === "frozen" ? "127,184,168" : "242,180,74";
}

/**
 * The mockup's layered "physical object" shadow stack, split per size:
 * `carousel` carries the full stack (inset top/bottom highlight, the 2/12/40px
 * drop shadows, and the ambient ring+glow); `preview` uses the lighter stack
 * from the wizard mockup (no inset-bottom, no 2px layer, no glow, ring at
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
    const layers = ["inset 0 1px 0 rgba(242,238,228,.14)", "0 12px 24px rgba(0,0,0,.45)", "0 40px 80px rgba(0,0,0,.55)"];
    if (noGlow) return layers.join(", ");
    layers.push(`0 0 0 1px rgba(${rgb},.2)`);
    return layers.join(", ");
  }

  const layers = [
    "inset 0 1px 0 rgba(242,238,228,.14)",
    "inset 0 -1px 0 rgba(0,0,0,.5)",
    "0 2px 4px rgba(0,0,0,.35)",
    "0 12px 24px rgba(0,0,0,.45)",
    "0 40px 80px rgba(0,0,0,.55)",
  ];
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
  // Vertical rhythm (mockups `cards-carousel-f2` and `wizard-and-tx`): the
  // status line sits right under the wordmark, the "balance" label 34px
  // below it, and the footer (budget line + bar, then label · address) sits
  // on the card's baseline via `mt-auto`, at least 18px under the balance.
  // Every text line has a fixed 14px line box (24px for the wordmark) so the
  // stack is exactly as tall as the carousel face's content box (250 − 2×22
  // padding − 2×1 border = 204px). The preview face is 24px shorter, so its
  // balance gap tightens to 20px and its footer gap to 12px.
  const balanceGapClass = isCarousel ? "mt-[34px]" : "mt-5";
  const footerGapClass = isCarousel ? "pt-[18px]" : "pt-3";
  const budgetText =
    periodAmount === undefined ? "no budget set" : `${formatUsdc(remaining ?? 0n)} / ${formatUsdc(periodAmount)}`;

  return (
    <div
      {...rootAttrs}
      role="group"
      onPointerMove={tiltEnabled ? handlePointerMove : undefined}
      onPointerLeave={tiltEnabled ? handlePointerLeave : undefined}
      className={`relative flex shrink-0 flex-col overflow-hidden px-[26px] py-[22px] text-left ${className ?? ""}`}
      style={baseStyle}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-[70%] -left-[10%] -right-[10%] h-[90%]"
        style={{
          background: dimmed ? "none" : `radial-gradient(ellipse at center, ${glowTone}, transparent 60%)`,
        }}
      />
      {/* Diagonal sheen — mockup `.card3::after`, which paints *over* the
          card's text (`z-index` above the content, never interactive). */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "linear-gradient(115deg, rgba(255,255,255,.10) 0%, rgba(255,255,255,0) 35%, rgba(255,255,255,0) 60%, rgba(242,180,74,.06) 100%)",
        }}
      />
      <span
        aria-hidden
        className="absolute right-6 top-6 h-[26px] w-[38px] rounded-[7px]"
        style={{
          background: "linear-gradient(135deg, #f7d089, #c98a2a)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,.5), 0 2px 4px rgba(0,0,0,.4)",
        }}
      />

      <div className="font-display text-xl leading-6 tracking-[0.08em] text-text-hi">MOORING</div>
      <div
        data-testid="status"
        className={`font-mono text-[11px] uppercase leading-[14px] tracking-[0.16em] ${STATUS_TONE[state]}`}
      >
        {STATUS_TEXT[state]}
      </div>

      <div
        className={`${balanceGapClass} font-mono text-[11px] uppercase leading-[14px] tracking-[0.16em] text-text-lo`}
      >
        balance
      </div>
      <div data-testid="balance" className={`font-display leading-none text-text-hi ${balanceSizeClass}`}>
        {balance === undefined ? "—" : formatUsdc(balance)} <span className="font-display text-[15px] text-text-lo">USDC</span>
      </div>

      <div data-part="footer" className={`mt-auto ${footerGapClass}`}>
        <div className="flex items-baseline justify-between gap-3 font-mono text-[11px] uppercase leading-[14px] tracking-[0.16em] text-text-lo">
          <span className="flex min-w-0 items-baseline gap-2">
            <span
              data-testid="budget-remaining"
              className="shrink-0"
              title={periodAmount !== undefined && !isCarousel ? "left this period" : undefined}
            >
              {budgetText}
            </span>
            {periodAmount !== undefined && isCarousel ? (
              <span className="min-w-0 truncate font-body text-[10px] normal-case tracking-normal text-text-lo/70">
                left this period
              </span>
            ) : null}
          </span>
          <span data-testid="budget-expiry" className="shrink-0">
            expires {expiresText}
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-text-hi/[0.08]">
          <div data-testid="budget-bar-fill" className="h-full rounded-full bg-seaglass" style={{ width: `${budgetPct}%` }} />
        </div>

        <div className="mt-3.5 flex items-baseline justify-between gap-3 font-mono text-[12px] leading-[14px] text-text-hi">
          <span data-testid="footer-label" className="min-w-0 truncate" title={label}>
            {label}
          </span>
          <span data-testid="footer-address" className="shrink-0" title={address}>
            {address ? shortAddress(address) : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
