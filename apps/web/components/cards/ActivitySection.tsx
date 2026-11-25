"use client";

import { useActivity } from "@/lib/query/hooks";
import type { ActivityItem } from "@/lib/indexer/client";
import { explorerTxUrl } from "@/lib/chain/rpc";
import { shortAddress } from "@/lib/format/address";
import { formatUsdc } from "@/lib/format/usdc";
import { Button } from "@/components/ui/Button";
import { KV_CLASS, SECTION_HEAD_CLASS, SECTION_LABEL_CLASS, SMALL_BUTTON_CLASS, SURFACE_CLASS } from "@/components/cards/PolicySection";

export interface ActivitySectionProps {
  address: string;
  /** Injected in tests; defaults to `useActivity`. */
  useFeed?: typeof useActivity;
  nowMs?: number;
}

/** "2 h ago" style relative time; falls back to the date past a week. */
export function relativeTime(iso: string, nowMs = Date.now()): string {
  const diff = Math.max(0, nowMs - new Date(iso).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Full precision with trailing zeros trimmed, never fewer than two decimals: 0.001, 0.25, 10.00. */
export function feedAmount(base: string): string {
  const full = formatUsdc(base, { full: true });
  const trimmed = full.replace(/0+$/, "");
  const [whole, frac = ""] = trimmed.split(".");
  return `${whole}.${frac.padEnd(2, "0")}`;
}

function who(item: ActivityItem): string {
  if (item.merchantName) return item.merchantName;
  return item.counterparty ? shortAddress(item.counterparty) : "";
}

/** One line per event, in the owner's words. */
export function describeActivity(item: ActivityItem): string {
  const p = item.payload;
  switch (item.kind) {
    case "payment":
      return `Paid ${feedAmount(item.amount ?? "0")} USDC to ${who(item)}`;
    case "funded":
      return `Funded ${feedAmount(item.amount ?? "0")} USDC from ${who(item)}`;
    case "withdrawn":
      return `Withdrew ${feedAmount(String(p.amount ?? "0"))} USDC to ${shortAddress(String(p.to ?? ""))}`;
    case "created":
      return "Card created";
    case "merchant_added":
      return `Merchant added ${shortAddress(String(p.merchant ?? ""))}`;
    case "merchant_removed":
      return `Merchant removed ${shortAddress(String(p.merchant ?? ""))}`;
    case "policy_changed":
      return `Policy changed · ${feedAmount(String(p.period_amount ?? "0"))} USDC per period, max ${feedAmount(String(p.max_per_tx ?? "0"))} per payment`;
    case "signer_changed":
      return "Agent signer rotated";
    case "label_changed":
      return `Renamed to “${String(p.label ?? "")}”`;
    case "state_changed": {
      const name = String(p.stateName ?? "");
      return name === "frozen" ? "Frozen" : name === "cancelled" ? "Cancelled" : name === "active" ? "Unfrozen" : `State: ${name}`;
    }
    default:
      return String(item.kind);
  }
}

const TONE: Partial<Record<ActivityItem["kind"], string>> = {
  payment: "text-amber",
  funded: "text-success-text",
  withdrawn: "text-text-hi",
  state_changed: "text-danger-text",
};

/**
 * The card's indexed history: payments (with the merchant's verified name),
 * funding, owner actions. Policy refusals never reach the chain, so they are
 * not here — the empty state says so.
 */
export function ActivitySection({ address, useFeed = useActivity, nowMs }: ActivitySectionProps) {
  const feed = useFeed(address);
  const pages = feed.data?.pages ?? [];
  const off = pages.length > 0 && pages.every((p) => p === null);
  const items = pages.flatMap((p) => p?.items ?? []);
  const stale = pages.some((p) => p?.stale);

  return (
    <section className={SURFACE_CLASS} aria-label="Activity" data-testid="activity-section">
      <div className={SECTION_HEAD_CLASS}>
        <span className={SECTION_LABEL_CLASS}>Activity{stale ? " · catching up" : ""}</span>
        {feed.hasNextPage ? (
          <Button variant="ghost" className={SMALL_BUTTON_CLASS} onClick={() => void feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
            {feed.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        ) : null}
      </div>

      {feed.isLoading ? <p className="py-3 text-sm text-text-lo">Loading activity…</p> : null}
      {feed.isError ? (
        <p className="py-3 text-sm text-text-lo">
          Could not load activity.{" "}
          <button type="button" className="underline" onClick={() => void feed.refetch()}>
            Retry
          </button>
        </p>
      ) : null}
      {off ? <p className="py-3 text-sm text-text-lo">Activity history is not available on this deployment.</p> : null}
      {!feed.isLoading && !feed.isError && !off && items.length === 0 ? (
        <p className="py-3 text-sm text-text-lo">
          No activity yet. Policy refusals happen before a transaction exists, so they never appear here.
        </p>
      ) : null}

      <ol className="divide-y divide-line" aria-label="Activity items">
        {items.map((item) => (
          <li key={item.id} className={KV_CLASS}>
            <div className="min-w-0">
              <div className={`truncate text-sm ${TONE[item.kind] ?? "text-text-hi"}`}>{describeActivity(item)}</div>
              <div className="text-xs text-text-lo">
                <time dateTime={item.ts} title={new Date(item.ts).toLocaleString()}>
                  {relativeTime(item.ts, nowMs)}
                </time>
                {item.txHash ? (
                  <>
                    {" · "}
                    <a href={explorerTxUrl(item.txHash)} target="_blank" rel="noreferrer" className="underline decoration-dotted">
                      tx {item.txHash.slice(0, 8)}
                    </a>
                  </>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
