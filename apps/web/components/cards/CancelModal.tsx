"use client";

import { useEffect, useState } from "react";

import { useCardOp, type OpModalProps } from "@/components/cards/busy";
import { TRUSTLINE_MISSING_COPY, trustlineStatus } from "@/components/cards/trustline";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { TxStatus } from "@/components/ui/TxStatus";
import { buildCancel } from "@/lib/chain/card";
import { explorerTxUrl } from "@/lib/chain/rpc";
import { formatUsdc } from "@/lib/format/usdc";
import { useUsdcBalance } from "@/lib/query/hooks";
import { keys } from "@/lib/query/keys";

const CONFIRM_WORD = "cancel";

/**
 * Cancels the card (`cancel`): permanent, and it sweeps the whole balance
 * back to the owner in the same transaction. Typing the word is the guard —
 * there is no undo, and the agent's payments stop for good.
 */
export function CancelModal({ open, onClose, address, info, onDone }: OpModalProps) {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  // Cancel sweeps the balance to the owner in the same transaction, so it
  // needs the owner's USDC trustline exactly as withdraw does (spec §3.4) —
  // same probe, same explanation, rather than only saying so in prose.
  const balanceQuery = useUsdcBalance(info.owner, { enabled: open });
  const trustline = trustlineStatus(balanceQuery.error, balanceQuery.data !== undefined, balanceQuery.isLoading);
  const blocked = trustline === "missing" && info.balance > 0n;

  const op = useCardOp<void>("cancel", (_args, wallet) => buildCancel(address, wallet), {
    // The sweep moves the card's whole balance into the owner's wallet, so
    // the owner's own USDC balance (the Fund sheet's quick picks, the
    // withdraw/cancel trustline probe) is stale too — fund and withdraw
    // already invalidate it.
    invalidates: () => [keys.info(address), keys.cards(info.owner), keys.balance(info.owner)],
    onDone: () => {
      onDone("Card cancelled");
      onClose();
    },
  });

  const confirmed = typed.trim().toLowerCase() === CONFIRM_WORD;

  return (
    <Modal open={open} onClose={onClose} title="Cancel this card">
      <p className="mt-2 text-sm text-text-lo">
        Cancelling is permanent. The card stops authorizing payments for good and its balance —{" "}
        <span className="text-text-hi" title={`${formatUsdc(info.balance, { full: true })} USDC`}>
          {formatUsdc(info.balance)} USDC
        </span>{" "}
        — is sent back to your wallet in the same transaction. Your wallet must hold the USDC asset to receive it.
      </p>

      <Field
        label={`Type ${CONFIRM_WORD} to confirm`}
        value={typed}
        autoComplete="off"
        onChange={(event) => setTyped(event.target.value)}
        placeholder={CONFIRM_WORD}
      />

      {blocked ? (
        <p className="mt-3 rounded-[14px] border border-amber/30 bg-bg-raised px-4 py-3 text-xs text-text-lo">
          {TRUSTLINE_MISSING_COPY}
        </p>
      ) : null}

      <TxStatus
        className="mt-4"
        state={op.state}
        hash={op.hash ?? undefined}
        error={op.error ?? undefined}
        explorerUrl={op.hash ? explorerTxUrl(op.hash) : undefined}
        details={op.details ?? undefined}
      />

      <div className="mt-5 flex justify-end gap-2.5">
        <Button variant="ghost" onClick={onClose} disabled={op.mine}>
          Keep the card
        </Button>
        <Button variant="danger" onClick={() => void op.run()} loading={op.mine} disabled={!confirmed || op.locked || blocked}>
          Cancel this card
        </Button>
      </div>
    </Modal>
  );
}
