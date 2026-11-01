"use client";

import { useEffect, useRef, useState } from "react";

import { SMALL_BUTTON_CLASS } from "@/components/cards/PolicySection";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatMerchantPrice } from "@/lib/merchants/price";
import { shortAddress } from "@/lib/format/address";
import { networkLabel } from "@/lib/merchants/describe";

/**
 * What the owner is about to approve. A resolved service fills every field; an
 * address typed by hand carries only `payTo` and a short `name`.
 */
export interface ConfirmTarget {
  payTo: string;
  name: string;
  host?: string;
  url?: string;
  amount?: string;
  network?: string;
}

export interface MerchantConfirmModalProps {
  open: boolean;
  merchant: ConfirmTarget | null;
  /** `sign`: a transaction follows; `list`: only added to the wizard's draft. */
  mode: "sign" | "list";
  /** The request arrived through a link; adds a caution sentence. */
  linkOrigin?: boolean;
  /** The confirm is in flight: spinner on the primary, Cancel and Escape inert. */
  confirming?: boolean;
  /** The approval cannot go ahead right now (the resolver is disabled). */
  disabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * The explicit approval step before a merchant is allowed: shows exactly what
 * would be approved (full address included) and requires the owner to tick a
 * responsibility checkbox before the confirm button enables. Mooring never
 * vouches for a service; this is where the owner takes that decision.
 * The checkbox lives in an inner component that exists only while open, so it
 * starts unticked on every opening by construction.
 */
export function MerchantConfirmModal(props: MerchantConfirmModalProps) {
  if (!props.open || !props.merchant) return null;
  return <OpenModal {...props} merchant={props.merchant} />;
}

function OpenModal({
  merchant,
  mode,
  linkOrigin,
  confirming,
  disabled,
  onCancel,
  onConfirm,
}: MerchantConfirmModalProps & { merchant: ConfirmTarget }) {
  const [checked, setChecked] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const byHand = !merchant.host;
  const label = merchant.host ?? shortAddress(merchant.payTo);

  function copy() {
    const p = navigator.clipboard?.writeText(merchant.payTo);
    p?.then(() => {
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  const rows: [string, string][] = byHand
    ? []
    : [
        ["Service", merchant.name],
        ["Host", merchant.host!],
        ["Price", `${formatMerchantPrice(merchant.amount ?? "0")} USDC / request`],
        ["Network", networkLabel(merchant.network ?? "")],
      ];

  return (
    <Modal
      open
      onClose={confirming ? () => {} : onCancel}
      title={mode === "sign" ? `Allow ${label}?` : `Add ${label} to the list?`}
    >
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-text-lo">{term}</dt>
            <dd className="min-w-0 break-words text-text-hi">{value}</dd>
          </div>
        ))}
        <div className="contents">
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
        </div>
      </dl>
      {byHand ? (
        <p className="mt-4 text-xs text-text-hi">
          This address was entered by hand; Mooring has not checked that it accepts x402 payments.
        </p>
      ) : null}
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
          data-autofocus
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
        <Button onClick={onConfirm} loading={confirming} disabled={!checked || disabled}>
          {mode === "sign" ? "Allow and sign" : "Add to list"}
        </Button>
      </div>
    </Modal>
  );
}
