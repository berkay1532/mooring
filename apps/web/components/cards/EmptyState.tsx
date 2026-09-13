"use client";

import { MooringCard } from "@/components/card/MooringCard";
import { Button } from "@/components/ui/Button";

export interface EmptyStateProps {
  onCreate: () => void;
  onAddExisting: () => void;
}

/**
 * Shown when the connected wallet has no cards on this dashboard (spec
 * §3.2). Add-by-address is given equal weight to creating one: a card made
 * with a custom salt (the CLI's default) is not discoverable, so an owner
 * who already has one would otherwise be told, wrongly, that they have none.
 */
export function EmptyState({ onCreate, onAddExisting }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-6 py-14 text-center">
      <div className="opacity-40">
        <MooringCard size="preview" state="draft" label="your first card" tilt={false} />
      </div>
      <div>
        <h2 className="font-display text-2xl text-text-hi">Create your first card</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-text-lo">
          A card is a Soroban account that holds USDC and lets one agent spend it — inside a budget, a merchant
          allowlist and an expiry you set. The funds stay under your wallet&apos;s control.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2.5">
        <Button onClick={onCreate}>+ New card</Button>
        <Button variant="ghost" onClick={onAddExisting}>
          Add existing card
        </Button>
      </div>
      <p className="max-w-md text-xs text-text-lo">
        Already created a card with the <span className="font-mono">mooring</span> CLI? Cards made with a custom salt
        are not discovered automatically — add it by address.
      </p>
    </div>
  );
}
