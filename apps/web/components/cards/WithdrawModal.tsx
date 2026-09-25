"use client";

import { useEffect, useState } from "react";

import { opButtonLabel, useCardOp, type OpModalProps } from "@/components/cards/busy";
import { exactAmount } from "@/components/cards/summary";
import { TRUSTLINE_MISSING_COPY, TRUSTLINE_UNKNOWN_COPY, trustlineStatus } from "@/components/cards/trustline";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { buildWithdraw } from "@/lib/chain/card";
import { formatUsdc, parseUsdc } from "@/lib/format/usdc";
import { useUsdcBalance } from "@/lib/query/hooks";
import { keys } from "@/lib/query/keys";

export interface WithdrawModalProps extends OpModalProps {
  owner: string;
}

/**
 * Moves USDC from the card back to the owner's wallet (`withdraw`).
 *
 * Every amount comparison here is in base units: "Max" fills the input from
 * the exact `bigint` balance (7 decimals, trailing zeros trimmed) and the
 * sufficiency check is `parseUsdc(input) <= info.balance`. Round-tripping
 * through the 2-decimal display would let a card holding 11.0000001 refuse
 * its own balance — or offer 11.00 it cannot pay.
 */
export function WithdrawModal({ open, onClose, address, info, owner }: WithdrawModalProps) {
  const [amount, setAmount] = useState("");
  useEffect(() => {
    if (open) setAmount("");
  }, [open]);

  const balanceQuery = useUsdcBalance(owner, { enabled: open });
  const trustline = trustlineStatus(balanceQuery.error, balanceQuery.data !== undefined, balanceQuery.isLoading);

  const parsed = parseUsdc(amount.trim());
  const tooMuch = parsed !== null && parsed > info.balance;
  const error =
    amount.trim() === ""
      ? undefined
      : parsed === null
        ? "Enter an amount like 12.50 (up to 7 decimals)."
        : parsed <= 0n
          ? "Enter an amount greater than 0."
          : tooMuch
            ? `That is more than the card holds (${formatUsdc(info.balance, { full: true })} USDC).`
            : undefined;

  const op = useCardOp<bigint>("withdraw", (value, wallet) => buildWithdraw(address, value, wallet), {
    invalidates: () => [keys.info(address), keys.balance(owner)],
    label: (value) => `Withdraw ${formatUsdc(value)} USDC from ${info.label}`,
    onDone: onClose,
  });

  const valid = parsed !== null && parsed > 0n && !tooMuch && trustline !== "missing";

  return (
    <Modal open={open} onClose={onClose} title="Withdraw to my wallet">
      <fieldset disabled={op.mine} className="min-w-0">
        <p className="mt-2 text-sm text-text-lo">
          Card balance{" "}
          <span className="text-text-hi" title={`${formatUsdc(info.balance, { full: true })} USDC`}>
            {formatUsdc(info.balance)} USDC
          </span>
          .
        </p>

        <Field
          label="Amount"
          value={amount}
          inputMode="decimal"
          unit="USDC"
          onChange={(event) => setAmount(event.target.value)}
          error={error}
        />
        <div className="mt-2 flex gap-2">
          <Button
            variant="ghost"
            className="px-2.5 py-1 text-[11px]"
            title={`${formatUsdc(info.balance, { full: true })} USDC`}
            onClick={() => setAmount(exactAmount(info.balance))}
          >
            Max
          </Button>
        </div>

        {trustline === "missing" || trustline === "unknown" ? (
          <p className="mt-3 rounded-[14px] border border-amber/30 bg-bg-raised px-4 py-3 text-xs text-text-lo">
            {trustline === "missing" ? TRUSTLINE_MISSING_COPY : TRUSTLINE_UNKNOWN_COPY}
          </p>
        ) : null}
      </fieldset>

      <div className="mt-5 flex justify-end gap-2.5">
        <Button variant="ghost" onClick={onClose} disabled={op.mine}>
          Close
        </Button>
        <Button onClick={() => void op.run(parsed as bigint)} loading={op.mine} disabled={!valid || op.locked}>
          {opButtonLabel(op.state, "Withdraw")}
        </Button>
      </div>
    </Modal>
  );
}
