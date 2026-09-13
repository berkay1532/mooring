import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CardCarousel } from "../../components/card/CardCarousel";
import { CardList } from "../../components/card/CardList";
import type { CardSummary } from "../../components/cards/summary";
import type { CardInfo } from "../../lib/chain/card";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const BASE = 10_000_000n;
const NOW = 1_800_000_000;

const A = "CAJPWJRJPFIY6XYYQIVCC3XLYFYQVNJIJ6XVPTUY4EBLNQ3CFN2AHCJ";
const B = "CB7QKSJBGKNWX3TOWQYRT5UQ4KXWQ4M5X5VZXHBYRPLEN24TCVVTM2KA";
const C = "CDX1KSJBGKNWX3TOWQYRT5UQ4KXWQ4M5X5VZXHBYRPLEN24TCVV9QWE";

function info(label: string, over: Partial<CardInfo> = {}): CardInfo {
  return {
    owner: "GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD",
    signer: new Uint8Array(32),
    token: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    label,
    policy: {
      period_amount: 50n * BASE,
      period_duration: 86_400n,
      max_per_tx: 10n * BASE,
      expiry: BigInt(NOW + 2_505_600),
    },
    state: 0,
    period: { start: BigInt(NOW - 3_600), spent: 10n * BASE },
    remaining: 40n * BASE,
    balance: 11n * BASE,
    allow_count: 1,
    ...over,
  };
}

function summary(address: string, label: string, over: Partial<CardInfo> = {}): CardSummary {
  return { address, info: info(label, over), error: null, loading: false };
}

const ITEMS: CardSummary[] = [
  summary(A, "research-bot", { state: 1, balance: 240n * 10_000n }),
  summary(B, "inference-agent"),
  summary(C, "ops-agent", { balance: 120n * BASE }),
];

/** A stateful harness: the carousel is controlled, so selection lives here. */
function Harness({ items = ITEMS, initial = B }: { items?: CardSummary[]; initial?: string }) {
  const [selected, setSelected] = useState<string | null>(initial);
  return <CardCarousel items={items} selected={selected} onSelect={setSelected} nowUnix={NOW} />;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockReset();
});

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

describe("CardCarousel", () => {
  it("centers the selected card and marks it data-selected", () => {
    const { container } = render(<Harness />);
    const selected = container.querySelectorAll('[data-selected="true"]');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveAttribute("aria-label", expect.stringContaining("inference-agent"));

    const slide = container.querySelector('[data-slide-offset="0"]') as HTMLElement;
    expect(slide.style.transform).toContain("translateZ(60px)");

    const left = container.querySelector('[data-slide-offset="-1"]') as HTMLElement;
    expect(left.style.transform).toContain("translateX(-360px)");
    expect(left.style.transform).toContain("translateZ(-160px)");
    expect(left.style.transform).toContain("rotateY(28deg)");
    expect(left.style.transform).toContain("scale(0.86)");

    const right = container.querySelector('[data-slide-offset="1"]') as HTMLElement;
    expect(right.style.transform).toContain("translateX(360px)");
    expect(right.style.transform).toContain("rotateY(-28deg)");
  });

  it("moves the selection with the arrow keys", () => {
    const { container } = render(<Harness />);
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(container.querySelector('[data-selected="true"]')).toHaveAttribute(
      "aria-label",
      expect.stringContaining("ops-agent"),
    );
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(container.querySelector('[data-selected="true"]')).toHaveAttribute(
      "aria-label",
      expect.stringContaining("inference-agent"),
    );
  });

  it("moves the selection with the arrow buttons and the dots", () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /previous card/i }));
    expect(container.querySelector('[data-selected="true"]')).toHaveAttribute(
      "aria-label",
      expect.stringContaining("research-bot"),
    );
    fireEvent.click(screen.getByRole("button", { name: /go to ops-agent/i }));
    expect(container.querySelector('[data-selected="true"]')).toHaveAttribute(
      "aria-label",
      expect.stringContaining("ops-agent"),
    );
  });

  it("navigates to the wizard from the new-card slot, by click and by Enter", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /new card/i }));
    expect(push).toHaveBeenCalledWith("/cards/new");

    push.mockReset();
    // Walk right past the last card onto the "+ new card" slot, then Enter.
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/cards/new");
  });

  it("ignores arrow keys while typing in a field", () => {
    const { container } = render(<Harness />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(container.querySelector('[data-selected="true"]')).toHaveAttribute(
      "aria-label",
      expect.stringContaining("inference-agent"),
    );
    input.remove();
  });

  it("drops the 3D transforms under prefers-reduced-motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("reduced-motion"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const { container } = render(<Harness />);
    const slide = container.querySelector('[data-slide-offset="0"]') as HTMLElement;
    expect(slide.style.transform).toBe("");
    expect(slide.style.transition).toBe("none");
    // Neighbours are not stacked behind the selected card when motion is off.
    const left = container.querySelector('[data-slide-offset="-1"]') as HTMLElement;
    expect(left.className).toContain("hidden");
  });
});

describe("CardList", () => {
  function ListHarness({ items = ITEMS }: { items?: CardSummary[] }) {
    const [selected, setSelected] = useState<string | null>(B);
    return <CardList items={items} selected={selected} onSelect={setSelected} nowUnix={NOW} />;
  }

  it("renders one row per card with label, status and balance", () => {
    render(<ListHarness />);
    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText("inference-agent")).toBeInTheDocument();
    expect(within(rows[1]).getByText("11.00")).toBeInTheDocument();
    expect(within(rows[0]).getByText("frozen")).toBeInTheDocument();
  });

  it("filters by the search box (label or address)", () => {
    render(<ListHarness />);
    fireEvent.change(screen.getByLabelText("Search cards"), { target: { value: "ops" } });
    expect(screen.getAllByRole("row").slice(1)).toHaveLength(1);
    expect(screen.getByText("ops-agent")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search cards"), { target: { value: A.slice(0, 6) } });
    expect(screen.getAllByRole("row").slice(1)).toHaveLength(1);
    expect(screen.getByText("research-bot")).toBeInTheDocument();
  });

  it("filters by status", () => {
    render(<ListHarness />);
    fireEvent.change(screen.getByLabelText("Status filter"), { target: { value: "frozen" } });
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText("research-bot")).toBeInTheDocument();
  });

  it("selects a card from its Open button", () => {
    const { container } = render(<ListHarness />);
    fireEvent.click(screen.getByRole("button", { name: /open ops-agent/i }));
    expect(container.querySelector('tr[data-selected="true"] td')).toHaveTextContent("ops-agent");
  });

  it("says so when the filters match nothing", () => {
    render(<ListHarness />);
    fireEvent.change(screen.getByLabelText("Search cards"), { target: { value: "zzzz" } });
    expect(screen.getByText(/no cards match/i)).toBeInTheDocument();
  });
});
