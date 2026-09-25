"use client";

import { StrKey } from "@stellar/stellar-sdk";
import { useState } from "react";

import { opButtonLabel, useCardOp } from "@/components/cards/busy";
import {
  KV_CLASS,
  SECTION_HEAD_CLASS,
  SECTION_LABEL_CLASS,
  SMALL_BUTTON_CLASS,
  SURFACE_CLASS,
} from "@/components/cards/PolicySection";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { buildAddMerchant, buildRemoveMerchant } from "@/lib/chain/card";
import { shortAddress } from "@/lib/format/address";
import { keys } from "@/lib/query/keys";

/** The contract's `MAX_ALLOWLIST` (contracts/card/src/lib.rs). */
const MAX_MERCHANTS = 32;

export interface MerchantsSectionProps {
  address: string;
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

function isValidMerchant(value: string): boolean {
  return StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value);
}

/**
 * The merchant allowlist: who the card is allowed to pay. Adding and
 * removing are both owner transactions, so each reports its progress on a
 * toast (see `useCardOp`) and participates in the per-card busy lock.
 */
export function MerchantsSection({ address, merchants, loading, disabled }: MerchantsSectionProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const invalidates = () => [keys.merchants(address), keys.info(address)];

  const add = useCardOp<string>("merchant-add", (merchant, wallet) => buildAddMerchant(address, merchant, wallet), {
    invalidates,
    label: (merchant) => `Add merchant ${shortAddress(merchant)}`,
    onDone: () => {
      setDraft("");
      setAdding(false);
    },
  });
  const remove = useCardOp<string>(
    "merchant-remove",
    (merchant, wallet) => buildRemoveMerchant(address, merchant, wallet),
    { invalidates, label: (merchant) => `Remove merchant ${shortAddress(merchant)}` },
  );

  const full = merchants.length >= MAX_MERCHANTS;
  const duplicate = merchants.includes(draft.trim());
  const draftValid = isValidMerchant(draft.trim()) && !duplicate;
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

      {merchants.map((merchant) => (
        <div key={merchant} className={KV_CLASS}>
          <span className="min-w-0 truncate font-mono text-xs text-text-hi" title={merchant}>
            {merchant}
          </span>
          <button
            type="button"
            onClick={() => void remove.run(merchant)}
            disabled={busy || remove.mine || add.mine}
            className="shrink-0 rounded font-body text-xs text-danger-text transition hover:brightness-125 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
          >
            <span aria-hidden>Remove</span>
            <span className="sr-only">Remove merchant {shortAddress(merchant)}</span>
          </button>
        </div>
      ))}

      {adding ? (
        <div className="mt-1">
          <Field
            label="Merchant address"
            value={draft}
            disabled={add.mine}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="G… or C…"
            error={draft && !draftValid ? (duplicate ? "This merchant is already allowed." : "Enter a Stellar address (G… or C…).") : undefined}
            hint="The card can only pay the addresses on this list."
          />
          <div className="mt-3 flex justify-end">
            <Button
              className={SMALL_BUTTON_CLASS}
              onClick={() => void add.run(draft.trim())}
              loading={add.mine}
              disabled={!draftValid || busy || full}
            >
              {opButtonLabel(add.state, "Add merchant")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
