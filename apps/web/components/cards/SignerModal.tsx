"use client";

import { Buffer } from "buffer";

import { StrKey } from "@stellar/stellar-sdk";
import { useEffect, useState } from "react";

import { useCardOp, type OpModalProps } from "@/components/cards/busy";
import { signerStrkey } from "@/components/cards/summary";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { TxStatus } from "@/components/ui/TxStatus";
import { buildSetSigner } from "@/lib/chain/card";
import { explorerTxUrl } from "@/lib/chain/rpc";
import { shortAddress } from "@/lib/format/address";
import { keys } from "@/lib/query/keys";

/**
 * Rotates the agent key (`set_signer`). Two steps on purpose (spec §3.4):
 * the old key stops validating the moment this confirms, so an agent still
 * running on it starts failing immediately — the owner has to acknowledge
 * that before the wallet opens.
 */
export function SignerModal({ open, onClose, address, info, onDone }: OpModalProps) {
  const [key, setKey] = useState("");
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (open) {
      setKey("");
      setConfirming(false);
    }
  }, [open]);

  const trimmed = key.trim();
  const valid = StrKey.isValidEd25519PublicKey(trimmed);
  const current = signerStrkey(info.signer);

  const op = useCardOp<string>(
    "signer",
    (next, wallet) => buildSetSigner(address, Buffer.from(StrKey.decodeEd25519PublicKey(next)), wallet),
    {
      invalidates: () => [keys.info(address)],
      onDone: () => {
        onDone("Signer rotated");
        onClose();
      },
    },
  );

  return (
    <Modal open={open} onClose={onClose} title="Change signer">
      <p className="mt-2 text-sm text-text-lo">
        Current signer <span className="font-mono text-xs text-text-hi">{current ? shortAddress(current) : "—"}</span>.
        Paste the agent&apos;s new Stellar public key — the app never sees its secret.
      </p>

      <Field
        label="Agent public key"
        value={key}
        onChange={(event) => {
          setKey(event.target.value);
          setConfirming(false);
        }}
        placeholder="G…"
        error={trimmed && !valid ? "That is not a Stellar public key (G…)." : undefined}
        hint="No key yet? Generate one with `mooring keygen`."
      />

      {confirming ? (
        <p className="mt-3 rounded-[14px] border border-danger/35 bg-bg-raised px-4 py-3 text-xs text-text-lo">
          The current key stops working immediately — any agent still signing with it will be rejected. Update the
          agent&apos;s configuration before you confirm.
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
          Close
        </Button>
        {confirming ? (
          <Button variant="danger" onClick={() => void op.run(trimmed)} loading={op.mine} disabled={!valid || op.locked}>
            Rotate the signer
          </Button>
        ) : (
          <Button onClick={() => setConfirming(true)} disabled={!valid || op.locked}>
            Continue
          </Button>
        )}
      </div>
    </Modal>
  );
}
