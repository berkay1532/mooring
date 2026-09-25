"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { verifyOwnedCard } from "@/lib/chain/card";
import { addCard } from "@/lib/prefs";

export interface AddCardModalProps {
  open: boolean;
  onClose: () => void;
  owner: string;
  /** Called with the address once it is verified and stored. */
  onAdded: (address: string) => void;
}

/**
 * Adds a card the app cannot discover on its own.
 *
 * Discovery walks the factory's salt counter (0, 1, 2, …), so a card created
 * with a custom salt — the CLI's default, and how the live testnet card was
 * made — is invisible to it. Pasting the address here verifies it really is
 * a card owned by this wallet and then keeps it in this browser's list.
 */
export function AddCardModal({ open, onClose, owner, onAdded }: AddCardModalProps) {
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (open) {
      setAddress("");
      setError(null);
      setChecking(false);
    }
  }, [open]);

  async function add() {
    const value = address.trim();
    setChecking(true);
    setError(null);
    try {
      await verifyOwnedCard(value, owner);
      addCard(owner, value);
      onAdded(value);
      onClose();
    } catch (err) {
      setError(describe(err));
    } finally {
      setChecking(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add an existing card">
      <p className="mt-2 text-sm text-text-lo">
        Cards created with a custom salt — for example from the <span className="font-mono text-xs">mooring</span> CLI —
        are not discovered automatically. Paste the card&apos;s contract address to keep it on this dashboard.
      </p>

      <Field
        label="Card address"
        value={address}
        onChange={(event) => setAddress(event.target.value)}
        placeholder="C…"
        error={error ?? undefined}
        hint="Only cards owned by the connected wallet can be added."
      />

      <div className="mt-5 flex justify-end gap-2.5">
        <Button variant="ghost" onClick={onClose} disabled={checking}>
          Close
        </Button>
        <Button onClick={() => void add()} loading={checking} disabled={address.trim() === ""}>
          Add card
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Turns a `verifyOwnedCard` rejection into one sentence the owner can act
 * on. Anything that is not a strkey problem or an ownership mismatch means
 * the address did not answer `info()` like a Mooring card.
 */
function describe(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/belongs to another owner/i.test(message)) {
    return "This card belongs to another owner, so this wallet cannot manage it.";
  }
  if (/not a valid Stellar contract address/i.test(message)) {
    return "That is not a contract address — a card address starts with C.";
  }
  return "This address is not a Mooring card (we could not read its card info).";
}
