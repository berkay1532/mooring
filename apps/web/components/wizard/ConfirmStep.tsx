"use client";

import type { Card } from "@mooring/contracts-ts";

import { periodLabel } from "@/components/cards/summary";
import { Button } from "@/components/ui/Button";
import { TxStatus, type TxDetailsProps, type TxError, type TxState } from "@/components/ui/TxStatus";
import { formatDate } from "@/components/wizard/PolicyStep";
import { explorerTxUrl } from "@/lib/chain/rpc";
import { config } from "@/lib/config";
import { shortAddress } from "@/lib/format/address";
import { formatDuration } from "@/lib/format/time";
import { formatUsdc } from "@/lib/format/usdc";
import { UNIT_SECONDS } from "@/lib/wizard/validate";

export interface ConfirmStepProps {
  label: string;
  policy: Card.Policy;
  agentKey: string;
  merchants: readonly string[];
  /** The address the card will be deployed at, once discovery has answered. */
  address?: string;
  /** Something went wrong working out the next free address. */
  addressError?: boolean;
  /** Extra line under the status box, e.g. "Adding merchant 2 of 3". */
  progress?: string;
  tx: { state: TxState; hash?: string; error?: TxError; details?: TxDetailsProps };
  /** Disabled until the expected address is known and nothing is in flight. */
  canCreate: boolean;
  creating: boolean;
  /** The flow has started — going back would desync what is being deployed. */
  locked?: boolean;
  onBack: () => void;
  onCreate: () => void;
  /** Offered when a merchant transaction failed: open the card anyway. */
  onSkipMerchants?: () => void;
  /** The submit button's text. Defaults to "Create with Freighter". */
  submitLabel?: string;
  /** Retries the address lookup when discovery failed. */
  onRetryAddress?: () => void;
}

/** "day" / "hour" / "week", or a plain duration for a custom period. */
function periodPhrase(seconds: bigint): string {
  const known = seconds === UNIT_SECONDS.hour || seconds === UNIT_SECONDS.day || seconds === UNIT_SECONDS.week;
  return known ? periodLabel(seconds) : formatDuration(Number(seconds));
}

/**
 * Step 3 — what is about to be signed, in plain language, and the one
 * button that signs it (spec §3.3). The expected card address is shown
 * *before* signing: it is derived from `(factory, owner, salt)` exactly as
 * the factory derives it, so the owner can check it up front.
 */
export function ConfirmStep({
  label,
  policy,
  agentKey,
  merchants,
  address,
  addressError,
  progress,
  tx,
  canCreate,
  creating,
  locked,
  onBack,
  onCreate,
  onSkipMerchants,
  submitLabel = "Create with Freighter",
  onRetryAddress,
}: ConfirmStepProps) {
  const period = periodPhrase(policy.period_duration);
  const expires = formatDate(Number(policy.expiry));
  const count = merchants.length;
  const where =
    count === 0
      ? " but nowhere yet: the merchant allowlist is empty, so every payment is rejected until you add a merchant"
      : `, only at ${count} merchant${count === 1 ? "" : "s"}`;

  return (
    <div>
      <div className="rounded-[14px] border border-text-hi/[0.07] bg-surface px-5 py-4.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-lo">Summary</span>
        <p className="mt-2 font-body text-sm text-text-hi">{label}</p>
        <p className="mt-1 text-xs text-text-lo">
          {formatUsdc(policy.period_amount)} USDC / {period} · per tx {formatUsdc(policy.max_per_tx)} USDC · until{" "}
          {expires}
        </p>
        <p className="mt-1 text-xs text-text-lo">
          Agent <span className="font-mono text-text-hi">{shortAddress(agentKey)}</span> ·{" "}
          {count === 0 ? "no merchants yet" : `${count} merchant${count === 1 ? "" : "s"}`}
        </p>

        <p className="mt-3.5 text-xs leading-relaxed text-text-lo">
          {`Your agent can spend up to ${formatUsdc(policy.period_amount)} USDC per ${period}, at most ${formatUsdc(
            policy.max_per_tx,
          )} USDC per request${where}, until ${expires}. You can freeze, change or cancel this at any time.`}
        </p>
      </div>

      <div className="mt-3.5 rounded-[14px] border border-text-hi/[0.07] bg-surface px-5 py-4.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-lo">Card address</span>
        {address ? (
          <p className="mt-2 break-all font-mono text-xs text-text-hi">{address}</p>
        ) : (
          <p className="mt-2 text-xs text-text-lo">
            {addressError ? "Couldn't reach the network to work out the address." : "Working out the address…"}
          </p>
        )}
        {addressError && onRetryAddress ? (
          <Button variant="ghost" className="mt-2 px-3.5 py-1.5 text-xs" onClick={onRetryAddress}>
            Retry
          </Button>
        ) : null}
        <p className="mt-1.5 text-xs text-text-lo">
          Known in advance: the factory derives it from your wallet and this card&apos;s index, so you can
          check it before you sign.
        </p>
      </div>

      <p className="mt-3.5 text-xs leading-relaxed text-text-lo">
        The card is a Soroban account tied to your wallet; the USDC in it stays under your control and you can
        withdraw it at any time. Creating it costs a one-time network fee — well under a cent on testnet.
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-text-lo">
        {`What you will sign: one create_card call to the Mooring factory (${shortAddress(
          config.factory,
        )}) from your own account, carrying the policy and agent key above. Your wallet pays the network fee; no USDC moves in this transaction.`}
      </p>
      {count > 0 ? (
        <p className="mt-1.5 text-xs leading-relaxed text-text-lo">
          {`You'll sign one transaction to create the card, then ${count} more to put ${
            count === 1 ? "that merchant" : "those merchants"
          } on its allowlist.`}
        </p>
      ) : null}

      <TxStatus
        className="mt-4"
        state={tx.state}
        hash={tx.hash}
        error={tx.error}
        explorerUrl={tx.hash ? explorerTxUrl(tx.hash) : undefined}
        details={tx.details}
      />
      {progress ? <p className="mt-2 text-xs text-text-lo">{progress}</p> : null}
      {tx.state === "failed" && onSkipMerchants ? (
        <div className="mt-2 flex justify-end">
          <Button variant="ghost" className="px-3.5 py-1.5 text-xs" onClick={onSkipMerchants}>
            Skip the rest and open the card
          </Button>
        </div>
      ) : null}

      <div className="mt-6 flex justify-end gap-2.5">
        <Button variant="ghost" onClick={onBack} disabled={creating || locked}>
          ← Back
        </Button>
        <Button onClick={onCreate} loading={creating} disabled={!canCreate}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
