"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import { MooringCard } from "@/components/card/MooringCard";
import { faceState, signerStrkey, type CardSummary } from "@/components/cards/summary";

export interface CardCarouselProps {
  items: readonly CardSummary[];
  selected: string | null;
  onSelect: (address: string) => void;
  /** Injectable "now" (Unix seconds) for the expiry countdowns. */
  nowUnix?: number;
}

/**
 * The mockup's `.card3` slot transforms (`2026-09-13-cards-carousel-f2.html`):
 * the selected card is raised toward the viewer, its neighbours recede and
 * rotate away in perspective, and the second ring fades out.
 */
function slideStyle(offset: number, reduced: boolean): CSSProperties {
  if (reduced) return { transition: "none" };

  const base: CSSProperties = { transition: "transform 200ms cubic-bezier(.2,.8,.2,1), opacity 200ms ease" };
  const abs = Math.abs(offset);
  const sign = offset < 0 ? -1 : 1;

  if (offset === 0) return { ...base, transform: "translateZ(60px)", zIndex: 3, opacity: 1 };
  if (abs === 1) {
    return {
      ...base,
      transform: `translateX(${sign * 360}px) translateZ(-160px) rotateY(${-sign * 28}deg) scale(0.86)`,
      zIndex: 2,
      opacity: 0.55,
      filter: "brightness(.8)",
      boxShadow: "0 20px 40px rgba(0,0,0,.5)",
    };
  }
  return {
    ...base,
    transform: `translateX(${sign * 640}px) translateZ(-300px) rotateY(${-sign * 34}deg) scale(0.7)`,
    zIndex: 1,
    opacity: 0.25,
    filter: "brightness(.7)",
  };
}

const ARROW_CLASS =
  "absolute top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-text-hi/[0.14] bg-bg-raised/60 font-body text-text-hi transition hover:border-amber/50 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber";

/**
 * The centred 3D card stage (design spec §3.2 / §5): the selected card front
 * and centre, neighbours receding in perspective, a dashed "+ new card" slot
 * last. Arrows, dots, ← →, and swipe all move the selection; every transform
 * is dropped under `prefers-reduced-motion`, where only the selected card is
 * shown (the list view is the fuller accessible alternative).
 */
export function CardCarousel({ items, selected, onSelect, nowUnix }: CardCarouselProps) {
  const router = useRouter();
  const newSlot = items.length; // the "+ new card" slot sits after the last card
  const [index, setIndex] = useState(() => {
    const i = items.findIndex((item) => item.address === selected);
    return i >= 0 ? i : 0;
  });

  // Follow an external selection change (list view, "add existing card",
  // a card removed). Deliberately keyed on `selected` only: keying on
  // `items` too would yank the stage back off the "+ new card" slot on
  // every 10 s refetch.
  useEffect(() => {
    const i = items.findIndex((item) => item.address === selected);
    if (i >= 0) setIndex(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // Read after mount so SSR and the first client render agree (no hydration
  // mismatch); a later change of the OS preference is picked up live.
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(newSlot, next));
      setIndex(clamped);
      const item = items[clamped];
      if (item) onSelect(item.address);
    },
    [items, newSlot, onSelect],
  );

  const openWizard = useCallback(() => router.push("/cards/new"), [router]);

  /**
   * Arrow keys act only while focus is inside the stage (the handler is on
   * the stage element, which is itself focusable): a listener on `window`
   * would move the carousel while the owner is tabbing through the details
   * panel far below it.
   */
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;

    if (event.key === "ArrowRight") {
      event.preventDefault();
      goTo(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      goTo(index - 1);
    } else if (event.key === "Enter" && index === newSlot && tag !== "BUTTON" && tag !== "A") {
      // Enter on a focused control belongs to that control, not the stage.
      event.preventDefault();
      openWizard();
    }
  }

  // --- swipe ---------------------------------------------------------------
  const dragStart = useRef<number | null>(null);
  // A mouse drag is followed by a synthetic `click` on the card that was
  // pressed, whose handler would select that card again and undo the swipe
  // (touch browsers suppress it past the tap slop; mice do not). This flag
  // swallows exactly that one click.
  const dragged = useRef(false);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    dragStart.current = event.clientX;
    dragged.current = false;
  }
  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const start = dragStart.current;
    dragStart.current = null;
    if (start === null) return;
    const delta = event.clientX - start;
    if (Math.abs(delta) < 50) return;
    dragged.current = true;
    goTo(index + (delta < 0 ? 1 : -1));
  }

  function selectSlide(target: number) {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    goTo(target);
  }

  const now = nowUnix ?? Math.floor(Date.now() / 1000);

  return (
    <div className="relative">
      <div
        role="region"
        aria-roledescription="carousel"
        aria-label="Your cards"
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="relative flex h-[330px] items-center justify-center overflow-hidden [perspective:1400px] focus-visible:outline-none"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-[26px] left-[20%] right-[20%] h-[70px] blur-[14px]"
          style={{ background: "radial-gradient(ellipse at center, rgba(242,180,74,.16), transparent 65%)" }}
        />

        {/* `preserve-3d` keeps the stage's perspective applying to the slides
            inside this (responsive) scale wrapper — without it they are
            grandchildren of the perspective element and flatten out. */}
        <div className="relative scale-[0.62] [transform-style:preserve-3d] sm:scale-[0.8] lg:scale-100">
          {items.map((item, i) => {
            const offset = i - index;
            const hidden = Math.abs(offset) > 2 || (reduced && offset !== 0);
            return (
              <div
                key={item.address}
                data-slide-offset={offset}
                style={slideStyle(offset, reduced)}
                className={`absolute left-1/2 top-1/2 -ml-[210px] -mt-[125px] ${hidden ? "hidden" : ""}`}
              >
                <button
                  type="button"
                  tabIndex={offset === 0 ? 0 : -1}
                  onClick={() => selectSlide(i)}
                  className="block rounded-[20px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-4 focus-visible:ring-offset-bg-deep"
                >
                  <MooringCard
                    size="carousel"
                    state={item.info ? faceState(item.info, now) : "draft"}
                    label={item.info?.label ?? "…"}
                    address={item.address}
                    balance={item.info?.balance}
                    spent={item.info?.period.spent}
                    periodAmount={item.info?.policy.period_amount}
                    expiry={item.info ? Number(item.info.policy.expiry) : undefined}
                    allowCount={item.info?.allow_count}
                    signer={signerStrkey(item.info?.signer)}
                    selected={offset === 0}
                    tilt={offset === 0}
                    nowUnix={now}
                  />
                </button>
              </div>
            );
          })}

          <div
            data-slide-offset={newSlot - index}
            style={slideStyle(newSlot - index, reduced)}
            className={`absolute left-1/2 top-1/2 -ml-[210px] -mt-[125px] ${
              Math.abs(newSlot - index) > 2 || (reduced && newSlot !== index) ? "hidden" : ""
            }`}
          >
            <button
              type="button"
              onClick={openWizard}
              tabIndex={newSlot === index ? 0 : -1}
              className="flex h-[250px] w-[420px] items-center justify-center rounded-[20px] border border-dashed border-text-hi/30 font-display text-[40px] text-text-hi transition hover:border-amber/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
            >
              <span aria-hidden>+</span>
              <span className="sr-only">New card</span>
            </button>
          </div>
        </div>

        <button type="button" aria-label="Previous card" className={`${ARROW_CLASS} left-0`} onClick={() => goTo(index - 1)} disabled={index === 0}>
          <span aria-hidden>‹</span>
        </button>
        <button type="button" aria-label="Next card" className={`${ARROW_CLASS} right-0`} onClick={() => goTo(index + 1)} disabled={index === newSlot}>
          <span aria-hidden>›</span>
        </button>
      </div>

      <div className="mt-0.5 flex justify-center gap-1.5">
        {items.map((item, i) => (
          <button
            key={item.address}
            type="button"
            aria-label={`Go to ${item.info?.label ?? item.address}`}
            aria-current={i === index}
            onClick={() => goTo(i)}
            className={`h-1.5 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber ${
              i === index ? "w-5 bg-amber" : "w-1.5 bg-text-hi/20 hover:bg-text-hi/40"
            }`}
          />
        ))}
        <button
          type="button"
          aria-label="Jump to the create-card slot"
          aria-current={index === newSlot}
          onClick={() => setIndex(newSlot)}
          className={`h-1.5 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber ${
            index === newSlot ? "w-5 bg-amber" : "w-1.5 bg-text-hi/20 hover:bg-text-hi/40"
          }`}
        />
      </div>
    </div>
  );
}
