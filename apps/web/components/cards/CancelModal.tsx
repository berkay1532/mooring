"use client";

import { useEffect, useState } from "react";

import { useCardOp, type OpModalProps } from "@/components/cards/busy";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { TxStatus } from "@/components/ui/TxStatus";
import { buildCancel } from "@/lib/chain/card";
import { explorerTxUrl } from "@/lib/chain/rpc";
import { formatUsdc } from "@/lib/format/usdc";
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

  const op = useCardOp<void>("cancel", (_args, wallet) => buildCancel(address, wallet), {
    invalidates: () => [keys.info(address), keys.cards(info.owner)],
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

      <TxStatus
        className="mt-4"
        state={op.state}
        hash={op.hash ?? undefined}
        error={op.error ?? undefined}
        explorerUrl={op.hash ? explorerTxUrl(op.hash) : undefined}
      />

      <div className="mt-5 flex justify-end gap-2.5">
        <Button variant="ghost" onClick={onClose} disabled={op.mine}>
          Keep the card
        </Button>
        <Button variant="danger" onClick={() => void op.run()} loading={op.mine} disabled={!confirmed || op.locked}>
          Cancel this card
        </Button>
      </div>
    </Modal>
  );
}
