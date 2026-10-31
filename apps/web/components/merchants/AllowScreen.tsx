"use client";

import { StrKey } from "@stellar/stellar-sdk";
import Link from "next/link";
import { useRef, useState } from "react";

import { CardBusyProvider, useCardOp } from "@/components/cards/busy";
import { MerchantResolver, type ResolvedMerchant } from "@/components/merchants/MerchantResolver";
import { buildAddMerchant } from "@/lib/chain/card";
import { shortAddress } from "@/lib/format/address";
import { addCard, setMerchantLabel, setSelected } from "@/lib/prefs";
import { useCardInfo, useMerchants } from "@/lib/query/hooks";
import { keys } from "@/lib/query/keys";
import { useWallet } from "@/lib/wallet/context";

/** The contract's `CardState::Cancelled` discriminant. */
const CANCELLED = 2;

const LINK_CLASS = "text-amber underline underline-offset-2";

export interface AllowScreenProps {
  /** The `card` query parameter; validated here. */
  card: string | null;
  /** The `url` query parameter: the service the agent was denied at. */
  url: string | null;
}

function BackToCards() {
  return (
    <Link href="/cards" className={LINK_CLASS}>
      Go to my cards
    </Link>
  );
}

/**
 * The landing page of an agent's "not allowlisted" link: shows the named card
 * and resolves the service URL so the owner can allow that merchant in one
 * confirmation. Only the card's owner sees the resolver.
 */
export function AllowScreen({ card, url }: AllowScreenProps) {
  if (!card || !StrKey.isValidContract(card)) {
    return (
      <main className="px-6 py-10 text-sm text-text-lo">
        <p>This link does not name a valid card.</p>
        <BackToCards />
      </main>
    );
  }
  return (
    <CardBusyProvider>
      <AllowCard card={card} url={url} />
    </CardBusyProvider>
  );
}

function AllowCard({ card, url }: { card: string; url: string | null }) {
  const { address: owner } = useWallet();
  const infoQuery = useCardInfo(card);
  const merchantsQuery = useMerchants(card);
  const pendingLabel = useRef<ResolvedMerchant | null>(null);
  const [allowed, setAllowed] = useState(false);

  const add = useCardOp<string>("merchant-add", (merchant, wallet) => buildAddMerchant(card, merchant, wallet), {
    invalidates: () => [keys.merchants(card), keys.info(card)],
    label: (merchant) => `Add merchant ${shortAddress(merchant)}`,
    onDone: () => {
      const pending = pendingLabel.current;
      pendingLabel.current = null;
      if (!owner) return;
      if (pending) setMerchantLabel(owner, card, pending.payTo, { name: pending.name, url: pending.url });
      addCard(owner, card);
      setSelected(owner, card);
      setAllowed(true);
    },
  });

  const info = infoQuery.data;
  if (!info) {
    return (
      <main className="px-6 py-10 text-sm text-text-lo">
        {infoQuery.error ? (
          <>
            <p>Could not read this card.</p>
            <BackToCards />
          </>
        ) : (
          <p>Loading card…</p>
        )}
      </main>
    );
  }

  if (info.owner !== owner) {
    return (
      <main className="px-6 py-10 text-sm text-text-lo">
        <p>
          This card belongs to {shortAddress(info.owner)}. Connect that wallet to manage it.
        </p>
      </main>
    );
  }

  const disabled = info.state === CANCELLED || add.locked || add.mine;

  return (
    <main className="mx-auto max-w-[560px] px-6 pb-16 pt-7">
      <h1 className="font-display text-[24px] leading-tight text-text-hi">{info.label}</h1>
      <p className="mb-5 font-mono text-xs text-text-lo" title={card}>
        {shortAddress(card)}
      </p>

      {allowed ? (
        <p className="text-sm text-text-hi">
          Merchant allowed.{" "}
          <Link href="/cards" className={LINK_CLASS}>
            Open card
          </Link>
        </p>
      ) : (
        <MerchantResolver
          initialUrl={url ?? undefined}
          autoResolve={Boolean(url)}
          linkOrigin
          existing={merchantsQuery.data ?? []}
          confirmLabel={(host) => `Allow ${host}`}
          onConfirm={async (m) => {
            pendingLabel.current = m;
            try {
              await add.run(m.payTo);
            } catch {
              // The failure is on the transaction toast; drop the label so a
              // later, unrelated confirmation cannot store it.
              pendingLabel.current = null;
            }
          }}
          confirming={add.mine}
          disabled={disabled || merchantsQuery.data === undefined}
        />
      )}
    </main>
  );
}
