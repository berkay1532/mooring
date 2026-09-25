"use client";

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

import { dialogFocusables, isTopDialog, popDialog, pushDialog, trapTab } from "./dialogStack";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

/**
 * A centered confirmation dialog (Edit policy, Rotate signer, typed Cancel
 * confirmation). Same Escape / focus-trap / scroll-lock / focus-restore
 * behaviour as {@link Sheet}, laid out as a centered card instead of a
 * side panel — including keying the open/close effect on `[open]` only
 * (not `onClose`, see {@link Sheet}'s doc comment) and only reacting to
 * Escape while this is the top-most open dialog (`dialogStack`), so a
 * `Modal` stacked on a `Sheet` doesn't close both at once.
 */
export function Modal({ open, onClose, title, children, className }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    // The panel element is registered with the dialog: `dialogStack` uses it
    // to resolve which dialog is really in front when two open in the same
    // commit (a nested dialog registers before its parent).
    const dialogToken = pushDialog(panelRef.current);
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    (panel ? (dialogFocusables(panel).find((el) => panel.contains(el)) ?? panel) : null)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!isTopDialog(dialogToken)) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key === "Tab") {
        trapTab(event, panel, dialogToken);
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
    <div className="fixed inset-0 z-40 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-bg-deep/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={`relative z-10 w-full max-w-md rounded-2xl border border-text-hi/[0.12] bg-surface p-6 shadow-[0_40px_80px_rgba(0,0,0,.6)] ${className ?? ""}`}
      >
        {title ? (
          <h2 id={titleId} className="font-display text-xl text-text-hi">
            {title}
          </h2>
        ) : null}
        {children}
      </div>
    </div>
  );
}
