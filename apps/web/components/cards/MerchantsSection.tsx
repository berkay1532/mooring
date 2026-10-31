"use client";

import { useEffect, useRef, useState } from "react";

import { useCardOp } from "@/components/cards/busy";
import {
  KV_CLASS,
  SECTION_HEAD_CLASS,
  SECTION_LABEL_CLASS,
  SMALL_BUTTON_CLASS,
  SURFACE_CLASS,
} from "@/components/cards/PolicySection";
import { MerchantIdentity } from "@/components/merchants/MerchantIdentity";
import { MerchantResolver, type ResolvedMerchant } from "@/components/merchants/MerchantResolver";
import { Button } from "@/components/ui/Button";
import { buildAddMerchant, buildRemoveMerchant } from "@/lib/chain/card";
import { shortAddress } from "@/lib/format/address";
import { getMerchantLabels, removeMerchantLabel, setMerchantLabel, type MerchantLabel } from "@/lib/prefs";
import { keys } from "@/lib/query/keys";

/** The contract's `MAX_ALLOWLIST` (contracts/card/src/lib.rs). */
const MAX_MERCHANTS = 32;

export interface MerchantsSectionProps {
  address: string;
  /** The connected owner; per-device merchant names are stored under it. */
  owner: string | null;
  merchants: readonly string[];
  loading?: boolean;
  /**
   * The panel's own write gate — another action on this card is in flight,
   * the card is cancelled, or its `info()` read is failing ("writes are
   * paused"). The allowlist obeys the same rule as every other control, or
   * the panel would promise something it does not keep.
   */
  disabled?: boolean;
}

/**
 * The merchant allowlist: who the card is allowed to pay. Adding and
 * removing are both owner transactions, so each reports its progress on a
 * toast (see `useCardOp`) and participates in the per-card busy lock.
 * Merchants are added by service URL; the name the owner approved is kept on
 * this device and shown above the address.
 */
export function MerchantsSection({ address, owner, merchants, loading, disabled }: MerchantsSectionProps) {
  const [adding, setAdding] = useState(false);
  const [labels, setLabels] = useState<Record<string, MerchantLabel>>({});
  const pendingLabel = useRef<ResolvedMerchant | null>(null);
  const removing = useRef<string | null>(null);

  useEffect(() => {
    setLabels(owner ? getMerchantLabels(owner, address) : {});
  }, [owner, address]);

  const invalidates = () => [keys.merchants(address), keys.info(address)];

  const add = useCardOp<string>("merchant-add", (merchant, wallet) => buildAddMerchant(address, merchant, wallet), {
    invalidates,
    label: (merchant) => `Add merchant ${shortAddress(merchant)}`,
    onDone: () => {
      const pending = pendingLabel.current;
      pendingLabel.current = null;
      if (pending && owner) {
        setMerchantLabel(owner, address, pending.payTo, { name: pending.name, url: pending.url });
        setLabels(getMerchantLabels(owner, address));
      }
      setAdding(false);
    },
  });
  const remove = useCardOp<string>(
    "merchant-remove",
    (merchant, wallet) => buildRemoveMerchant(address, merchant, wallet),
    {
      invalidates,
      label: (merchant) => `Remove merchant ${shortAddress(merchant)}`,
      onDone: () => {
        const gone = removing.current;
        removing.current = null;
        if (gone && owner) {
          removeMerchantLabel(owner, address, gone);
          setLabels(getMerchantLabels(owner, address));
        }
      },
    },
  );

  // A failed add is reported on its toast; drop the label so a later
  // confirmation cannot store it.
  useEffect(() => {
    if (add.state === "failed") pendingLabel.current = null;
  }, [add.state]);

  const full = merchants.length >= MAX_MERCHANTS;
  const busy = Boolean(disabled) || add.locked || remove.locked;

  return (
    <div className={SURFACE_CLASS}>
      <div className={SECTION_HEAD_CLASS}>
        <span className={SECTION_LABEL_CLASS}>
          Merchants · {merchants.length} / {MAX_MERCHANTS}
        </span>
        <Button
          variant="ghost"
          className={SMALL_BUTTON_CLASS}
          onClick={() => setAdding((v) => !v)}
          disabled={busy || add.mine || remove.mine || full}
          title={full ? `A card can hold at most ${MAX_MERCHANTS} merchants` : undefined}
        >
          {adding ? "Close" : "+ Add"}
        </Button>
      </div>

      {merchants.length === 0 && !loading ? (
        <p className="py-3 text-sm text-text-lo">
          No merchants yet — the card cannot pay anyone until you add one.
        </p>
      ) : null}

      {merchants.map((merchant) => {
        const label = labels[merchant];
        return (
          <div key={merchant} className={KV_CLASS}>
            <MerchantIdentity address={merchant} label={label} />
            <button
              type="button"
              onClick={() => {
                removing.current = merchant;
                void remove.run(merchant);
              }}
              disabled={busy || remove.mine || add.mine}
              className="shrink-0 rounded font-body text-xs text-danger-text transition hover:brightness-125 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
            >
              <span aria-hidden>Remove</span>
              <span className="sr-only">Remove merchant {shortAddress(merchant)}</span>
            </button>
          </div>
        );
      })}

      {adding ? (
        <div className="mt-1">
          <MerchantResolver
            existing={merchants}
            confirmLabel={(host) => `Allow ${host}`}
            onConfirm={async (m) => {
              pendingLabel.current = m;
              await add.run(m.payTo);
            }}
            onAddByAddress={(a) => {
              pendingLabel.current = null;
              void add.run(a);
            }}
            confirming={add.mine}
            disabled={busy || full}
          />
        </div>
      ) : null}
    </div>
  );
}
