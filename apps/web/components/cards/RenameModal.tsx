"use client";

import { useEffect, useState } from "react";

import { useCardOp, type OpModalProps } from "@/components/cards/busy";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { TxStatus } from "@/components/ui/TxStatus";
import { buildSetLabel } from "@/lib/chain/card";
import { explorerTxUrl } from "@/lib/chain/rpc";
import { keys } from "@/lib/query/keys";

/** The contract bounds the label at 32 **bytes** of UTF-8, not 32 characters. */
const MAX_LABEL_BYTES = 32;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Renames the card (`set_label`). The label lives on-chain, so this is a
 * real transaction — and its limit is a byte limit: "ç" costs two of the 32
 * bytes, an emoji four, which is why the counter counts bytes (spec §3.3).
 */
export function RenameModal({ open, onClose, address, info, onDone }: OpModalProps) {
  const [name, setName] = useState(info.label);

  // Reset to the on-chain label each time the modal opens — never while it
  // is open, or a background `info()` refetch would overwrite what the owner
  // is typing.
  useEffect(() => {
    if (open) setName(info.label);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const bytes = byteLength(name);
  const valid = bytes >= 1 && bytes <= MAX_LABEL_BYTES;

  const op = useCardOp<string>("rename", (label, wallet) => buildSetLabel(address, label, wallet), {
    invalidates: () => [keys.info(address)],
    onDone: () => {
      onDone("Card renamed");
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Rename card">
      <Field
        label="Card name"
        value={name}
        maxLength={64}
        onChange={(event) => setName(event.target.value)}
        error={bytes > MAX_LABEL_BYTES ? `A card name is at most ${MAX_LABEL_BYTES} bytes of UTF-8.` : undefined}
        hint={bytes === 0 ? "A card name cannot be empty." : undefined}
      />
      <p className={`mt-1.5 font-mono text-xs ${bytes > MAX_LABEL_BYTES ? "text-danger" : "text-text-lo"}`}>
        {bytes}/{MAX_LABEL_BYTES} bytes
      </p>
      <p className="mt-3 text-xs text-text-lo">
        The name is stored on the card itself, so renaming is an on-chain transaction with a small network fee.
      </p>

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
          Close
        </Button>
        <Button onClick={() => void op.run(name)} loading={op.mine} disabled={!valid || op.locked}>
          Rename
        </Button>
      </div>
    </Modal>
  );
}
