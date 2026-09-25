"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import { CardCarousel } from "@/components/card/CardCarousel";
import { CardList } from "@/components/card/CardList";
import { AddCardModal } from "@/components/cards/AddCardModal";
import { CardDetails } from "@/components/cards/CardDetails";
import { EmptyState } from "@/components/cards/EmptyState";
import { FundDeepLink } from "@/components/cards/FundDeepLink";
import { totals, useCardSummaries } from "@/components/cards/summary";
import { HeaderBar } from "@/components/layout/HeaderBar";
import { NetworkGuard } from "@/components/layout/NetworkGuard";
import { Button } from "@/components/ui/Button";
import { useTxToasts } from "@/components/ui/TxToast";
import { Toggle } from "@/components/ui/Toggle";
import { formatUsdc } from "@/lib/format/usdc";
import { getSelected, getViewMode, removeCard, setSelected, setViewMode, type ViewMode } from "@/lib/prefs";
import { useCards } from "@/lib/query/hooks";
import { keys } from "@/lib/query/keys";
import { useWallet } from "@/lib/wallet/context";

const VIEW_OPTIONS = [
  { value: "grid", label: "Cards" },
  { value: "list", label: "List" },
] as const;

/** Above this many cards, a first-time visitor opens in the list view (spec §3.2). */
const LIST_VIEW_THRESHOLD = 10;

export default function CardsPage() {
  return (
    <NetworkGuard>
      <HeaderBar />
      <CardsScreen />
    </NetworkGuard>
  );
}

/**
 * "My cards" (spec §3.2): the 3D carousel or the list, the totals line, and
 * the selected card's details with every owner operation below it. Selection
 * and view mode persist per owner in `localStorage`.
 */
function CardsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { address: owner } = useWallet();

  const cardsQuery = useCards(owner);
  const addresses = cardsQuery.data ?? [];
  const summaries = useCardSummaries(addresses);
  const totalsLine = totals(summaries);

  const [selected, setSelectedCard] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("grid");
  const [adding, setAdding] = useState(false);
  const { notify } = useTxToasts();
  // Bumped by `?fund=1` (the new-card wizard lands here), which tells the
  // details panel below to open the Fund sheet for the selected card.
  const [fundSignal, setFundSignal] = useState(0);

  // Restore the owner's last selection before the card list arrives, so the
  // details panel doesn't flash the first card and then switch.
  useEffect(() => {
    if (!owner) return;
    const stored = getSelected(owner);
    if (stored) setSelectedCard(stored);
  }, [owner]);

  // Keep the selection pointing at a card that actually exists.
  useEffect(() => {
    if (addresses.length === 0) return;
    setSelectedCard((prev) => (prev && addresses.includes(prev) ? prev : addresses[0]));
  }, [addresses]);

  // View mode is read once per owner, after that owner's card count is
  // known: their stored choice always wins, and only a first-time visitor
  // with a large dashboard is defaulted into the list. Keyed by owner so
  // switching wallet accounts re-reads that account's preference.
  const viewInitializedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!owner || cardsQuery.isLoading || viewInitializedFor.current === owner) return;
    viewInitializedFor.current = owner;
    setView(getViewMode(owner, addresses.length >= LIST_VIEW_THRESHOLD ? "list" : "grid"));
  }, [owner, cardsQuery.isLoading, addresses.length]);

  const select = useCallback(
    (address: string) => {
      setSelectedCard(address);
      if (owner) setSelected(owner, address);
    },
    [owner],
  );

  const changeView = useCallback(
    (next: ViewMode) => {
      setView(next);
      if (owner) setViewMode(owner, next);
    },
    [owner],
  );

  const handleRemoved = useCallback(
    (address: string) => {
      if (!owner) return;
      removeCard(owner, address);
      // `removeCard` leaves the stored selection behind, so clear it here or
      // the next visit would restore a card that is no longer listed.
      const rest = addresses.filter((a) => a !== address);
      const next = rest[0] ?? null;
      setSelectedCard(next);
      // `next` can be null (that was the last card) — `setSelected` then
      // clears the stored key rather than leaving it pointing at a card
      // this dashboard no longer lists.
      setSelected(owner, next);
      void queryClient.invalidateQueries({ queryKey: keys.cards(owner) });
      notify("Card removed from this browser");
    },
    [owner, addresses, queryClient, notify],
  );

  const onAdded = useCallback(
    (address: string) => {
      if (!owner) return;
      void queryClient.invalidateQueries({ queryKey: keys.cards(owner) });
      select(address);
      notify("Card added");
    },
    [owner, queryClient, select, notify],
  );

  const hasCards = addresses.length > 0;

  return (
    <main className="px-6 pb-16 pt-7 sm:px-8">
      <div className="mx-auto max-w-[1100px]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-[28px] leading-tight text-text-hi">My cards</h1>
            <p className="mt-0.5 text-[13px] text-text-lo">
              {cardsQuery.isLoading
                ? "Looking for your cards…"
                : `${totalsLine.count} card${totalsLine.count === 1 ? "" : "s"} · total ${formatUsdc(
                    totalsLine.balance,
                  )} USDC · ${formatUsdc(totalsLine.spent)} spent this period`}
            </p>
          </div>

          {hasCards ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <Toggle
                options={VIEW_OPTIONS}
                value={view}
                onChange={(value) => changeView(value as ViewMode)}
                aria-label="Card view"
              />
              <Button variant="ghost" className="px-3.5 py-1.5 text-xs" onClick={() => setAdding(true)}>
                Add existing card
              </Button>
              <Button className="px-3.5 py-2 text-xs" onClick={() => router.push("/cards/new")}>
                + New card
              </Button>
            </div>
          ) : null}
        </div>

        {cardsQuery.error && !hasCards ? (
          <div className="mt-10 rounded-[14px] border border-text-hi/[0.07] bg-surface px-5 py-8 text-center text-sm text-text-lo">
            <p>We couldn&apos;t reach the network to look up your cards.</p>
            <div className="mt-3 flex justify-center gap-2.5">
              <Button variant="ghost" onClick={() => void cardsQuery.refetch()}>
                Retry
              </Button>
              <Button variant="ghost" onClick={() => setAdding(true)}>
                Add existing card
              </Button>
            </div>
          </div>
        ) : null}

        {!cardsQuery.isLoading && !cardsQuery.error && !hasCards ? (
          <EmptyState onCreate={() => router.push("/cards/new")} onAddExisting={() => setAdding(true)} />
        ) : null}

        {hasCards ? (
          view === "grid" ? (
            <>
              <CardCarousel items={summaries} selected={selected} onSelect={select} />
              <div className="mt-2 flex justify-center">
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="rounded font-mono text-[11px] uppercase tracking-[0.16em] text-text-lo transition hover:text-text-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
                >
                  Add existing card
                </button>
              </div>
            </>
          ) : (
            <div className="mt-4">
              <CardList items={summaries} selected={selected} onSelect={select} />
            </div>
          )
        ) : null}

        {hasCards && selected ? (
          <CardDetails
            key={selected}
            address={selected}
            owner={owner as string}
            fundSignal={fundSignal}
            onFundOpened={() => setFundSignal(0)}
            onRemoved={handleRemoved}
          />
        ) : null}
      </div>

      <Suspense fallback={null}>
        {/* `?fund=1` is only ever set by the new-card wizard. Its
            transaction toasts (create, then each merchant) live in the
            global stack, so they are still on screen here — no separate
            "Card created" notice. */}
        <FundDeepLink onFund={() => setFundSignal((n) => n + 1)} />
      </Suspense>
      <AddCardModal open={adding} onClose={() => setAdding(false)} owner={owner ?? ""} onAdded={onAdded} />
    </main>
  );
}
