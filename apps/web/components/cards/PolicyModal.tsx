"use client";

import { useEffect, useMemo, useState } from "react";

import { useCardOp, type OpModalProps } from "@/components/cards/busy";
import { exactAmount } from "@/components/cards/summary";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";
import { TxStatus } from "@/components/ui/TxStatus";
import { buildSetPolicy, type Card } from "@/lib/chain/card";
import { explorerTxUrl } from "@/lib/chain/rpc";
import { parseUsdc } from "@/lib/format/usdc";
import { keys } from "@/lib/query/keys";

type PeriodUnit = "hour" | "day" | "week" | "custom";

const UNIT_SECONDS: Record<Exclude<PeriodUnit, "custom">, bigint> = {
  hour: 3_600n,
  day: 86_400n,
  week: 604_800n,
};

const UNIT_OPTIONS = [
  { value: "hour", label: "hour" },
  { value: "day", label: "day" },
  { value: "week", label: "week" },
  { value: "custom", label: "custom" },
] as const;

function unitOf(duration: bigint): PeriodUnit {
  if (duration === UNIT_SECONDS.hour) return "hour";
  if (duration === UNIT_SECONDS.day) return "day";
  if (duration === UNIT_SECONDS.week) return "week";
  return "custom";
}

/** `YYYY-MM-DD` in the viewer's own timezone, for an `<input type="date">`. */
function dateInputValue(unix: number): string {
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface PolicyModalProps extends OpModalProps {
  nowUnix: number;
}

/**
 * Edits the spending policy (`set_policy`), mirroring the contract's own
 * validation client-side (contracts/card/src/policy.rs: positive budget and
 * cap, cap ≤ budget, non-zero period, expiry in the future) so an
 * `InvalidPolicy` is caught before anything is signed (spec §6).
 */
export function PolicyModal({ open, onClose, address, info, nowUnix, onDone }: PolicyModalProps) {
  const [amount, setAmount] = useState(() => exactAmount(info.policy.period_amount));
  const [perTx, setPerTx] = useState(() => exactAmount(info.policy.max_per_tx));
  const [unit, setUnit] = useState<PeriodUnit>(() => unitOf(info.policy.period_duration));
  const [custom, setCustom] = useState(() => String(info.policy.period_duration));
  const [expiry, setExpiry] = useState(() => dateInputValue(Number(info.policy.expiry)));

  useEffect(() => {
    if (!open) return;
    setAmount(exactAmount(info.policy.period_amount));
    setPerTx(exactAmount(info.policy.max_per_tx));
    setUnit(unitOf(info.policy.period_duration));
    setCustom(String(info.policy.period_duration));
    setExpiry(dateInputValue(Number(info.policy.expiry)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const parsed = useMemo(() => {
    const periodAmount = parseUsdc(amount.trim());
    const maxPerTx = parseUsdc(perTx.trim());
    const duration = unit === "custom" ? toDuration(custom) : UNIT_SECONDS[unit];
    // An unchanged date keeps the exact on-chain expiry; a changed one lands
    // at the end of the chosen day in the owner's own timezone.
    const unchangedDate = expiry === dateInputValue(Number(info.policy.expiry));
    const expirySeconds = unchangedDate
      ? Number(info.policy.expiry)
      : Math.floor(new Date(`${expiry}T23:59:59`).getTime() / 1000);
    return { periodAmount, maxPerTx, duration, expirySeconds };
  }, [amount, perTx, unit, custom, expiry, info.policy.expiry]);

  const amountError =
    parsed.periodAmount === null || parsed.periodAmount <= 0n ? "Enter a budget greater than 0." : undefined;
  const perTxError =
    parsed.maxPerTx === null || parsed.maxPerTx <= 0n
      ? "Enter a cap greater than 0."
      : parsed.periodAmount !== null && parsed.maxPerTx > parsed.periodAmount
        ? "The per-transaction cap cannot be larger than the period budget."
        : undefined;
  const durationError = parsed.duration === null || parsed.duration <= 0n ? "Enter a period of at least 1 second." : undefined;
  const expiryError =
    !Number.isFinite(parsed.expirySeconds) || parsed.expirySeconds <= nowUnix ? "Pick a date in the future." : undefined;

  const valid = !amountError && !perTxError && !durationError && !expiryError;

  const op = useCardOp<Card.Policy>("policy", (policy, wallet) => buildSetPolicy(address, policy, wallet), {
    invalidates: () => [keys.info(address)],
    onDone: () => {
      onDone("Policy updated");
      onClose();
    },
  });

  function save() {
    if (!valid) return;
    void op.run({
      period_amount: parsed.periodAmount as bigint,
      max_per_tx: parsed.maxPerTx as bigint,
      period_duration: parsed.duration as bigint,
      expiry: BigInt(parsed.expirySeconds),
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit policy">
      <Field
        label="Period budget"
        value={amount}
        inputMode="decimal"
        unit="USDC"
        onChange={(event) => setAmount(event.target.value)}
        error={amount ? amountError : undefined}
      />
      <Toggle
        className="mt-2"
        shape="segment"
        aria-label="Period length"
        options={UNIT_OPTIONS}
        value={unit}
        onChange={(value) => setUnit(value as PeriodUnit)}
      />
      {unit === "custom" ? (
        <Field
          label="Period length"
          value={custom}
          inputMode="numeric"
          unit="seconds"
          onChange={(event) => setCustom(event.target.value)}
          error={durationError}
        />
      ) : null}

      <Field
        label="Max per transaction"
        value={perTx}
        inputMode="decimal"
        unit="USDC"
        onChange={(event) => setPerTx(event.target.value)}
        error={perTx ? perTxError : undefined}
        hint="Typically the most a single API call can cost."
      />
      <Field
        label="Expires"
        type="date"
        value={expiry}
        onChange={(event) => setExpiry(event.target.value)}
        error={expiryError}
      />

      <p className="mt-3 text-xs text-text-lo">
        What the card has already spent in the current period is kept, and the period restarts now.
      </p>

      <TxStatus
        className="mt-4"
        state={op.state}
        hash={op.hash ?? undefined}
        error={op.error ?? undefined}
        explorerUrl={op.hash ? explorerTxUrl(op.hash) : undefined}
      />

      <div className="mt-5 flex justify-end gap-2.5">
        <Button variant="ghost" onClick={onClose} disabled={op.mine}>
          Close
        </Button>
        <Button onClick={save} loading={op.mine} disabled={!valid || op.locked}>
          Save policy
        </Button>
      </div>
    </Modal>
  );
}

function toDuration(value: string): bigint | null {
  if (!/^\d+$/.test(value.trim())) return null;
  return BigInt(value.trim());
}
