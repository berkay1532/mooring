"use client";

import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Toggle } from "@/components/ui/Toggle";
import { MAX_LABEL_BYTES, MIN_CUSTOM_PERIOD_SECS, type WizardDraft } from "@/lib/wizard/validate";

const UNIT_OPTIONS = [
  { value: "hour", label: "hour" },
  { value: "day", label: "day" },
  { value: "week", label: "week" },
  { value: "custom", label: "custom" },
] as const;

const EXPIRY_OPTIONS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "date", label: "pick a date" },
] as const;

/** A resolved expiry as a plain English date, e.g. "12 Oct 2026". */
export function formatDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export interface PolicyStepProps {
  draft: WizardDraft;
  patch: (changes: Partial<WizardDraft>) => void;
  /** Label byte count for the live counter. */
  labelBytes: number;
  labelError?: string;
  /** Per-field policy messages, already gated on "has the user touched this?". */
  errors: { budget?: string; perTx?: string; period?: string; expiry?: string };
  /** The resolved expiry, for the "expires on …" line under the presets. */
  expiryUnix?: number;
  onCancel: () => void;
  onContinue: () => void;
}

/**
 * Step 1 — what the card is allowed to spend (spec §3.3): its on-chain
 * name, the periodic budget and its period, the per-transaction cap, and
 * the expiry. Every rule here is the contract's own, checked client-side so
 * an `InvalidPolicy` never reaches a signature.
 */
export function PolicyStep({
  draft,
  patch,
  labelBytes,
  labelError,
  errors,
  expiryUnix,
  onCancel,
  onContinue,
}: PolicyStepProps) {
  return (
    <div>
      <Field
        label="Card name"
        value={draft.label}
        onChange={(event) => patch({ label: event.target.value })}
        placeholder="inference-agent"
        error={labelError}
        hint={`${labelBytes} / ${MAX_LABEL_BYTES} bytes · stored on the card itself, on chain — you can rename it later`}
        maxLength={64}
      />

      <Field
        label="Period budget"
        value={draft.budget}
        inputMode="decimal"
        unit="USDC"
        placeholder="50"
        onChange={(event) => patch({ budget: event.target.value })}
        error={errors.budget}
      />
      <Toggle
        className="mt-2"
        shape="segment"
        aria-label="Period unit"
        options={UNIT_OPTIONS}
        value={draft.unit}
        onChange={(value) => patch({ unit: value })}
      />
      {draft.unit === "custom" ? (
        <Field
          label="Period length"
          value={draft.customSeconds}
          inputMode="numeric"
          unit="seconds"
          placeholder="3600"
          onChange={(event) => patch({ customSeconds: event.target.value })}
          error={errors.period}
          hint={`At least ${MIN_CUSTOM_PERIOD_SECS} seconds.`}
        />
      ) : (
        <p className="mt-1.5 text-xs text-text-lo">
          The budget resets every {draft.unit}. Nothing carries over into the next period.
        </p>
      )}

      <Field
        label="Max per transaction"
        value={draft.perTx}
        inputMode="decimal"
        unit="USDC"
        placeholder="10"
        onChange={(event) => patch({ perTx: event.target.value })}
        error={errors.perTx}
        hint="Typically the most a single API call can cost. It cannot be larger than the period budget."
      />

      <p className="mt-3.5 font-body text-xs text-text-lo">Expires</p>
      <Toggle
        className="mt-1.5"
        shape="segment"
        aria-label="Expiry"
        options={EXPIRY_OPTIONS}
        value={draft.expiryPreset}
        onChange={(value) => patch({ expiryPreset: value })}
      />
      {draft.expiryPreset === "date" ? (
        <Field
          label="Expiry date"
          type="date"
          value={draft.expiryDate}
          onChange={(event) => patch({ expiryDate: event.target.value })}
          error={errors.expiry}
        />
      ) : (
        <p className="mt-1.5 text-xs text-text-lo">
          {expiryUnix ? `After that the card stops paying — ${formatDate(expiryUnix)}.` : null}
        </p>
      )}
      {draft.expiryPreset !== "date" && errors.expiry ? (
        <p className="mt-1.5 text-xs text-danger">{errors.expiry}</p>
      ) : null}

      <div className="mt-6 flex justify-end gap-2.5">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onContinue}>Continue →</Button>
      </div>
    </div>
  );
}
