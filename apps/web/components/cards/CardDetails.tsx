"use client";

import { useEffect, useState } from "react";

import { AgentSection } from "@/components/cards/AgentSection";
import { CancelModal } from "@/components/cards/CancelModal";
import { DangerZone } from "@/components/cards/DangerZone";
import { FundSheet } from "@/components/cards/FundSheet";
import { MerchantsSection } from "@/components/cards/MerchantsSection";
import { PolicyModal } from "@/components/cards/PolicyModal";
import { PolicySection } from "@/components/cards/PolicySection";
import { RenameModal } from "@/components/cards/RenameModal";
import { SignerModal } from "@/components/cards/SignerModal";
import { StatRow } from "@/components/cards/StatRow";
import { WithdrawModal } from "@/components/cards/WithdrawModal";
import { CardBusyProvider, useCardBusy, useCardOp } from "@/components/cards/busy";
import { faceState } from "@/components/cards/summary";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { TxStatus } from "@/components/ui/TxStatus";
import { buildFreeze, buildUnfreeze } from "@/lib/chain/card";
import { explorerTxUrl } from "@/lib/chain/rpc";
import { shortAddress } from "@/lib/format/address";
import { getAddedCards } from "@/lib/prefs";
import { useCardInfo, useMerchants } from "@/lib/query/hooks";
import { keys } from "@/lib/query/keys";

export interface CardDetailsProps {
  address: string;
  owner: string;
  nowUnix?: number;
  onToast: (message: string) => void;
  /** The owner dropped this (manually added) card from the dashboard. */
  onRemoved: (address: string) => void;
}

type OpenPanel = null | "fund" | "rename" | "policy" | "signer" | "withdraw" | "cancel";

/**
 * Everything the owner can do to the selected card (spec §3.4), under one
 * per-card write lock: while any of these transactions is in flight, every
 * other trigger on this card is disabled, so two clicks can never open two
 * wallet prompts against the same account.
 */
export function CardDetails(props: CardDetailsProps) {
  return (
    <CardBusyProvider>
      <CardDetailsInner {...props} />
    </CardBusyProvider>
  );
}

function CardDetailsInner({ address, owner, nowUnix, onToast, onRemoved }: CardDetailsProps) {
  const now = nowUnix ?? Math.floor(Date.now() / 1000);
  const infoQuery = useCardInfo(address);
  const merchantsQuery = useMerchants(address);
  const [panel, setPanel] = useState<OpenPanel>(null);
  const { busy } = useCardBusy();

  const [locallyAdded, setLocallyAdded] = useState(false);
  useEffect(() => setLocallyAdded(getAddedCards(owner).includes(address)), [owner, address]);

  const info = infoQuery.data;
  const frozen = info?.state === 1;

  const freeze = useCardOp<void>(
    "freeze",
    (_args, wallet) => (frozen ? buildUnfreeze(address, wallet) : buildFreeze(address, wallet)),
    {
      invalidates: () => [keys.info(address)],
      onDone: () => onToast(frozen ? "Card unfrozen" : "Card frozen"),
    },
  );

  if (!info) {
    return (
      <div className="mt-6 rounded-[14px] border border-text-hi/[0.07] bg-surface px-5 py-8 text-center text-sm text-text-lo">
        {infoQuery.error ? (
          <>
            <p>We couldn&apos;t read this card right now.</p>
            <Button variant="ghost" className="mt-3" onClick={() => void infoQuery.refetch?.()}>
              Retry
            </Button>
          </>
        ) : (
          <p>Reading the card…</p>
        )}
      </div>
    );
  }

  const state = faceState(info, now);
  const cancelled = state === "cancelled";
  // A read that is failing while older values are still on screen: writes
  // are held back until a fresh read succeeds (spec §6).
  const stale = Boolean(infoQuery.error);
  const disabled = busy || cancelled || stale;

  return (
    <section className="mt-2" aria-label={`${info.label} details`}>
      <hr className="horizon my-[22px]" />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl text-text-hi">{info.label}</h2>
        <Pill tone={state}>{state}</Pill>
        <span className="font-mono text-xs text-text-lo" title={address}>
          {shortAddress(address)}
        </span>
        <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setPanel("rename")} disabled={disabled}>
          Rename
        </Button>
      </div>

      {stale ? (
        <p className="mb-4 rounded-[14px] border border-amber/30 bg-bg-raised px-4 py-3 text-xs text-text-lo">
          Couldn&apos;t refresh this card — the values below may be out of date, so writes are paused.{" "}
          <button type="button" className="text-amber underline" onClick={() => void infoQuery.refetch?.()}>
            retry
          </button>
        </p>
      ) : null}

      <StatRow
        info={info}
        nowUnix={now}
        actions={
          <>
            <Button onClick={() => setPanel("fund")} disabled={disabled}>
              Fund
            </Button>
            <Button
              variant="ghost"
              onClick={() => void freeze.run()}
              loading={freeze.mine}
              disabled={freeze.locked || cancelled || stale}
            >
              {frozen ? "Unfreeze" : "Freeze"}
            </Button>
            <Button variant="ghost" onClick={() => setPanel("withdraw")} disabled={busy || stale || info.balance <= 0n}>
              Withdraw
            </Button>
          </>
        }
      />

      {freeze.state !== "idle" ? (
        <TxStatus
          className="mt-4"
          state={freeze.state}
          hash={freeze.hash ?? undefined}
          error={freeze.error ?? undefined}
          explorerUrl={freeze.hash ? explorerTxUrl(freeze.hash) : undefined}
        />
      ) : null}

      <div className="mt-5 flex flex-col gap-5 lg:flex-row">
        <div className="min-w-0 flex-1">
          <PolicySection info={info} nowUnix={now} onEdit={() => setPanel("policy")} disabled={disabled} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3.5">
          <MerchantsSection
            address={address}
            merchants={merchantsQuery.data ?? []}
            loading={merchantsQuery.isLoading}
            onDone={onToast}
          />
          <AgentSection info={info} onRotate={() => setPanel("signer")} disabled={disabled} />
        </div>
      </div>

      <DangerZone
        cancelled={cancelled}
        disabled={busy || stale}
        onCancel={() => setPanel("cancel")}
        onRemove={locallyAdded ? () => onRemoved(address) : undefined}
      />

      <FundSheet
        open={panel === "fund"}
        onClose={() => setPanel(null)}
        address={address}
        info={info}
        owner={owner}
        onDone={onToast}
      />
      <RenameModal
        open={panel === "rename"}
        onClose={() => setPanel(null)}
        address={address}
        info={info}
        onDone={onToast}
      />
      <PolicyModal
        open={panel === "policy"}
        onClose={() => setPanel(null)}
        address={address}
        info={info}
        nowUnix={now}
        onDone={onToast}
      />
      <SignerModal
        open={panel === "signer"}
        onClose={() => setPanel(null)}
        address={address}
        info={info}
        onDone={onToast}
      />
      <WithdrawModal
        open={panel === "withdraw"}
        onClose={() => setPanel(null)}
        address={address}
        info={info}
        owner={owner}
        onDone={onToast}
      />
      <CancelModal
        open={panel === "cancel"}
        onClose={() => setPanel(null)}
        address={address}
        info={info}
        onDone={onToast}
      />
    </section>
  );
}
