"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { shortAddress } from "@/lib/format/address";
import { MAX_MERCHANTS, addMerchant, type WizardDraft } from "@/lib/wizard/validate";

export interface AgentStepProps {
  draft: WizardDraft;
  patch: (changes: Partial<WizardDraft>) => void;
  /** Agent-key message, already gated on "has the user touched this?". */
  agentError?: string;
  agentValid: boolean;
  onBack: () => void;
  onContinue: () => void;
}

/**
 * Step 2 — who signs and who can be paid (spec §3.3).
 *
 * The agent's **public** key only: Mooring never generates, sees or stores
 * an agent secret, so the owner pastes a key their agent already holds
 * (`mooring keygen` in the CLI makes one). The merchant allowlist is
 * optional here because each merchant is its own on-chain transaction —
 * but an empty allowlist means the card cannot pay anyone at all
 * (`contracts/card/src/allowlist.rs`: an address that is not on the list is
 * rejected with `NotAllowlisted`), which this step says plainly.
 */
export function AgentStep({ draft, patch, agentError, agentValid, onBack, onContinue }: AgentStepProps) {
  const [candidate, setCandidate] = useState("");
  const [merchantError, setMerchantError] = useState<string | undefined>(undefined);

  function add() {
    const result = addMerchant(draft.merchants, candidate);
    setMerchantError(result.error);
    if (!result.error) {
      patch({ merchants: result.merchants });
      setCandidate("");
    }
  }

  function remove(merchant: string) {
    patch({ merchants: draft.merchants.filter((m) => m !== merchant) });
    setMerchantError(undefined);
  }

  return (
    <div>
      <Field
        label="Agent public key"
        value={draft.agentKey}
        onChange={(event) => patch({ agentKey: event.target.value })}
        placeholder="G…"
        unit={agentValid ? "✓" : undefined}
        error={agentError}
        hint="Your agent's Stellar public key. The secret half stays with the agent and never comes near this app."
        inputClassName="font-mono text-xs"
        spellCheck={false}
        autoComplete="off"
      />
      {agentValid ? (
        <p className="mt-1.5 text-xs text-seaglass">✓ Valid key — the card will only accept payments it signs.</p>
      ) : null}
      <p className="mt-1.5 text-xs text-text-lo">
        No key yet? Run <code className="font-mono text-amber">mooring keygen</code> with the Mooring CLI.
      </p>

      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-lo">
            Merchants · {draft.merchants.length} / {MAX_MERCHANTS}
          </span>
          <span className="font-body text-xs text-text-lo">optional</span>
        </div>

        <ul aria-label="Merchants" className="mt-2">
          {draft.merchants.map((merchant) => (
            <li
              key={merchant}
              className="mt-1.5 flex items-center justify-between gap-3 rounded-[10px] border border-text-hi/[0.12] bg-bg-raised px-3.5 py-2.5"
            >
              <span className="min-w-0 truncate font-mono text-xs text-text-hi" title={merchant}>
                {merchant}
              </span>
              <button
                type="button"
                onClick={() => remove(merchant)}
                aria-label={`Remove merchant ${shortAddress(merchant)}`}
                className="shrink-0 rounded font-body text-xs text-danger-text transition hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        <Field
          label="Merchant address"
          value={candidate}
          onChange={(event) => {
            setCandidate(event.target.value);
            setMerchantError(undefined);
          }}
          placeholder="G… or C…"
          error={merchantError}
          hint={`The card can only pay the addresses on this list — at most ${MAX_MERCHANTS}. You can add and remove them later.`}
          inputClassName="font-mono text-xs"
          spellCheck={false}
          autoComplete="off"
        />
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" className="px-3.5 py-1.5 text-xs" onClick={add} disabled={candidate.trim() === ""}>
            + Add merchant
          </Button>
        </div>

        {draft.merchants.length === 0 ? (
          <p className="mt-1 text-xs text-text-lo">
            With an empty list the card cannot pay anyone — every payment is rejected until a merchant is
            added. You can add them here or later from the card.
          </p>
        ) : null}
      </div>

      <div className="mt-6 flex justify-end gap-2.5">
        <Button variant="ghost" onClick={onBack}>
          ← Back
        </Button>
        <Button onClick={onContinue}>Continue →</Button>
      </div>
    </div>
  );
}
