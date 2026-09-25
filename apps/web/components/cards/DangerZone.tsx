"use client";

export interface DangerZoneProps {
  onCancel: () => void;
  /** Already cancelled on-chain — there is nothing left to cancel. */
  cancelled?: boolean;
  disabled?: boolean;
  /** Shown only for cards added by address: drops it from this browser's list. */
  onRemove?: () => void;
}

/**
 * The single danger line under the details panel (the mockup's danger-zone
 * row). Cancelling is permanent and sweeps the balance back to the owner, so
 * it never sits next to the ordinary actions.
 */
export function DangerZone({ onCancel, cancelled, disabled, onRemove }: DangerZoneProps) {
  return (
    <div className="mt-[18px] flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[11px] uppercase tracking-[0.16em] text-danger-text">
      <span>Danger zone ·</span>
      <button
        type="button"
        onClick={onCancel}
        disabled={disabled || cancelled}
        className="rounded underline underline-offset-2 transition hover:brightness-125 disabled:no-underline disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
      >
        {cancelled ? "card cancelled" : "cancel the card and send its balance to your wallet"}
      </button>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="rounded text-text-lo underline underline-offset-2 transition hover:text-text-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
        >
          remove from this browser
        </button>
      ) : null}
    </div>
  );
}
