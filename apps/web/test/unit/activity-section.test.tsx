import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActivitySection, describeActivity, feedAmount, relativeTime } from "@/components/cards/ActivitySection";
import type { ActivityItem } from "@/lib/indexer/client";
import type { useActivity } from "@/lib/query/hooks";

const CBI3 = "CBI3L3KLF63F2I72ZGHVC766JZCDPBCTLQVLP7X36G5MB3DVD62CV7RY";
const NOW = Date.parse("2026-11-25T12:00:00Z");

const item = (over: Partial<ActivityItem>): ActivityItem => ({
  id: "e1",
  kind: "payment",
  ledger: 1,
  txHash: "e343161a4264c407bf1556d32080b54195fe4eb978c55478f9ca18b5da0f3be0",
  ts: "2026-11-25T10:00:00Z",
  amount: "10000",
  counterparty: "GBSVTVRQ4AEFRNGH2MIOOWZSAVLZKOKNKI4UAGSMBZSNRP4I3FL3ELYP",
  merchantName: "demo.rail402.dev",
  payload: {},
  ...over,
});

type Feed = ReturnType<typeof useActivity>;

function fakeFeed(over: Record<string, unknown> = {}): typeof useActivity {
  return () =>
    ({
      data: { pages: [{ card: CBI3, items: [], nextCursor: null, stale: false }] },
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      ...over,
    }) as unknown as Feed;

}

describe("ActivitySection", () => {
  it("feedAmount keeps sub-cent precision and at least two decimals", () => {
    expect(["10000", "10000000", "2500000", "20000000", "0", "123456789"].map(feedAmount)).toEqual(["0.001", "1.00", "0.25", "20.00", "0.00", "12.3456789"]);
  });

  it("describes every kind in the owner's words", () => {
    expect(describeActivity(item({}))).toBe("Paid 0.001 USDC to demo.rail402.dev");
    expect(describeActivity(item({ kind: "funded", amount: "10000000", merchantName: null }))).toMatch(/^Funded 10\.00 USDC from GBSV…ELYP$/);
    expect(describeActivity(item({ kind: "withdrawn", payload: { to: "GBXKAJETATENTZ2TAYVBYGOCNUWRRJHSIKUC2NPWKYN7ZULYHKJHTGIR", amount: "500000" } }))).toBe("Withdrew 0.05 USDC to GBXK…TGIR");
    expect(describeActivity(item({ kind: "created" }))).toBe("Card created");
    expect(describeActivity(item({ kind: "merchant_added", payload: { merchant: "GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG" } }))).toBe("Merchant added GAW3…LOIG");
    expect(describeActivity(item({ kind: "policy_changed", payload: { period_amount: "20000000", max_per_tx: "2500000" } }))).toBe("Policy changed · 20.00 USDC per period, max 0.25 per payment");
    expect(describeActivity(item({ kind: "signer_changed" }))).toBe("Agent signer rotated");
    expect(describeActivity(item({ kind: "label_changed", payload: { label: "cli card 2 renamed" } }))).toBe("Renamed to “cli card 2 renamed”");
    expect(describeActivity(item({ kind: "state_changed", payload: { stateName: "frozen" } }))).toBe("Frozen");
    expect(describeActivity(item({ kind: "state_changed", payload: { stateName: "active" } }))).toBe("Unfrozen");
    expect(describeActivity(item({ kind: "state_changed", payload: { stateName: "cancelled" } }))).toBe("Cancelled");
  });

  it("relativeTime steps from minutes to days, then a date", () => {
    expect(relativeTime("2026-11-25T11:59:40Z", NOW)).toBe("just now");
    expect(relativeTime("2026-11-25T11:30:00Z", NOW)).toBe("30 min ago");
    expect(relativeTime("2026-11-25T10:00:00Z", NOW)).toBe("2 h ago");
    expect(relativeTime("2026-11-22T10:00:00Z", NOW)).toBe("3 d ago");
    expect(relativeTime("2026-10-01T10:00:00Z", NOW)).toMatch(/2026/);
  });

  it("renders rows with explorer links and a Load more button that fetches the next page", () => {
    const fetchNextPage = vi.fn();
    render(
      <ActivitySection
        address={CBI3}
        nowMs={NOW}
        useFeed={fakeFeed({
          data: { pages: [{ card: CBI3, items: [item({}), item({ id: "e2", kind: "funded", amount: "10000000", merchantName: null, txHash: null })], nextCursor: "c", stale: false }] },
          hasNextPage: true,
          fetchNextPage,
        })}
      />,
    );
    const list = within(screen.getByRole("list", { name: "Activity items" }));
    expect(list.getAllByRole("listitem")).toHaveLength(2);
    expect(list.getByText("Paid 0.001 USDC to demo.rail402.dev")).toBeInTheDocument();
    expect(list.getByRole("link", { name: "tx e343161a" })).toHaveAttribute("href", expect.stringContaining("e343161a"));
    expect(list.getByText("2 h ago")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(fetchNextPage).toHaveBeenCalled();
  });

  it("explains the empty feed, the error, and an indexer that is off", () => {
    const { rerender } = render(<ActivitySection address={CBI3} useFeed={fakeFeed()} />);
    expect(screen.getByText(/Policy refusals happen before a transaction exists/)).toBeInTheDocument();
    rerender(<ActivitySection address={CBI3} useFeed={fakeFeed({ isError: true, data: undefined })} />);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    rerender(<ActivitySection address={CBI3} useFeed={fakeFeed({ data: { pages: [null] } })} />);
    expect(screen.getByText(/not available on this deployment/)).toBeInTheDocument();
    rerender(<ActivitySection address={CBI3} useFeed={fakeFeed({ data: { pages: [{ card: CBI3, items: [item({})], nextCursor: null, stale: true }] } })} />);
    expect(screen.getByText("Activity · catching up")).toBeInTheDocument();
  });
});
