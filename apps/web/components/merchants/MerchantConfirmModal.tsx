"use client";

import { useEffect, useRef, useState } from "react";

import { SMALL_BUTTON_CLASS } from "@/components/cards/PolicySection";
import type { ResolvedMerchant } from "@/components/merchants/MerchantResolver";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatMerchantPrice } from "@/lib/merchants/price";
import { networkLabel } from "@/lib/merchants/describe";

export interface MerchantConfirmModalProps {
  open: boolean;
  merchant: ResolvedMerchant | null;
  /** `sign`: a transaction follows; `list`: only added to the wizard's draft. */
  mode: "sign" | "list";
  /** The request arrived through a link; adds a caution sentence. */
  linkOrigin?: boolean;
  confirming?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * The explicit approval step before a merchant is allowed: shows exactly what
 * would be approved (full address included) and requires the owner to tick a
 * responsibility checkbox before the confirm button enables. Mooring never
 * vouches for a service; this is where the owner takes that decision.
 */
export function MerchantConfirmModal({ open, merchant, mode, linkOrigin, confirming, onCancel, onConfirm }: MerchantConfirmModalProps) {
  const [checked, setChecked] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  // Every opening starts unchecked, so a tick never carries over to a later service.
  useEffect(() => {
    if (open) setChecked(false);
  }, [open, merchant?.payTo]);

  if (!merchant) return null;

  function copy() {
    const p = navigator.clipboard?.writeText(merchant!.payTo);
    p?.then(() => {
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  const rows: [string, string][] = [
    ["Service", merchant.name],
    ["Host", merchant.host],
    ["Price", `${formatMerchantPrice(merchant.amount)} USDC / request`],
    ["Network", networkLabel(merchant.network)],
  ];

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={mode === "sign" ? `Allow ${merchant.host}?` : `Add ${merchant.host} to the list?`}
    >
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-text-lo">{term}</dt>
            <dd className="min-w-0 break-words text-text-hi">{value}</dd>
          </div>
        ))}
        <dt className="text-text-lo">Receiving address</dt>
        <dd className="min-w-0">
          <span className="break-all font-mono text-xs text-text-hi">{merchant.payTo}</span>
          <span className="mt-1 flex items-center gap-2">
            <Button variant="ghost" className={SMALL_BUTTON_CLASS} aria-label="Copy address" onClick={copy}>
              Copy
            </Button>
            <span role="status" className="text-xs text-text-lo">
              {copied ? "Copied" : ""}
            </span>
          </span>
        </dd>
      </dl>
      {linkOrigin ? (
        <p className="mt-4 text-xs text-text-hi">
          This request came from a link. Make sure it is a service your agent is meant to use.
        </p>
      ) : null}
      <p className="mt-4 text-base text-text-hi">
        Mooring only checked that this service accepts payments from this card&apos;s network and token. It does not vouch for the service. Allowing it lets your agent pay it up to the card&apos;s limits — whether to trust it is your decision.
      </p>
      <p className="mt-3 text-sm text-text-lo">
        You are allowing every payment to this address within the card&apos;s limits, not just this URL.
      </p>
      <label className="mt-4 flex items-start gap-2.5 text-sm text-text-hi">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-amber"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        <span>I understand Mooring has not vetted this service and I take responsibility for allowing it.</span>
      </label>
      <div className="mt-5 flex justify-end gap-2.5">
        <Button variant="ghost" onClick={onCancel} disabled={confirming}>
          Cancel
        </Button>
        <Button onClick={onConfirm} loading={confirming} disabled={!checked}>
          {mode === "sign" ? "Allow and sign" : "Add to list"}
        </Button>
      </div>
    </Modal>
  );
}
