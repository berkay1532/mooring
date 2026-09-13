"use client";

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

import { isTopDialog, popDialog, pushDialog } from "./dialogStack";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A floating panel offset from the top-right (mockup's `.sheet`), used for
 * Fund/Edit-policy flows: backdrop click and Escape close it (Escape only
 * when this is the top-most open dialog — see `dialogStack`), Tab is
 * trapped inside while open, body scroll is locked, and focus returns to
 * whatever opened it on close.
 *
 * The open/close effect depends only on `[open]`, not `onClose` — every
 * caller passes an inline `onClose={() => setX(false)}`, so keying on its
 * identity would tear the effect down and re-run it (re-registering the
 * keydown listener, re-focusing the first focusable element) on every
 * parent re-render while open, stealing focus from a controlled input
 * inside the panel. The latest `onClose` is read from a ref instead.
 */
export function Sheet({ open, onClose, title, children, className }: SheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const dialogToken = pushDialog();
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    const focusable = () => Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);
    (focusable()[0] ?? panel)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!isTopDialog(dialogToken)) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key === "Tab") {
        const items = focusable();
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus?.();
      popDialog(dialogToken);
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-bg-deep/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={`fixed inset-x-4 top-4 z-50 w-auto max-h-[calc(100vh-32px)] overflow-y-auto rounded-[18px] border border-text-hi/[0.12] bg-surface p-[22px] shadow-[0_40px_80px_rgba(0,0,0,.6)] min-[480px]:inset-x-auto min-[480px]:left-auto min-[480px]:right-[32px] min-[480px]:top-[26px] min-[480px]:w-[380px] ${className ?? ""}`}
      >
        {title ? (
          <h2 id={titleId} className="font-display text-xl text-text-hi">
            {title}
          </h2>
        ) : null}
        {children}
      </div>
    </>
  );
}
