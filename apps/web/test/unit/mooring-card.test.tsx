import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MooringCard } from "../../components/card/MooringCard";

const BASE = 10_000_000n;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * jsdom has no `PointerEvent` constructor, so `@testing-library`'s
 * `fireEvent.pointerMove(el, { clientX, clientY })` silently falls back to a
 * plain `Event` that drops `clientX`/`clientY` (they aren't part of the
 * generic `EventInit` dict) — the handler then reads `undefined` and
 * computes `NaN`. Dispatching a native `MouseEvent` typed `"pointermove"`
 * carries real coordinates through: `dispatchEvent` fires listeners by the
 * event's `type` string, not its constructor class, and React's synthetic
 * event just proxies whatever native event object it wraps.
 */
function firePointerMove(el: HTMLElement, clientX: number, clientY: number) {
  el.dispatchEvent(new MouseEvent("pointermove", { clientX, clientY, bubbles: true, cancelable: true }));
}

describe("MooringCard", () => {
  it("renders the label, balance, and this period's remaining budget for an active card", () => {
    const now = Math.floor(Date.now() / 1000);
    render(
      <MooringCard
        size="carousel"
        state="active"
        label="inference-agent"
        address="CAJPWJRJPFIY6XYYQIVCC3XLYFYQVNJIJ6XVPTUY4EBLNQ3CFN2AHCJ"
        balance={11n * BASE}
        spent={10n * BASE}
        periodAmount={50n * BASE}
        expiry={now + 2_505_600}
        nowUnix={now}
        allowCount={1}
        signer="GDHDJL3RT6S3OABSHLOEOCBH4BMMAKLVOR5FPEHXG5ZW2DDJDRRJJSM7"
      />,
    );

    expect(screen.getByText("inference-agent")).toBeInTheDocument();
    expect(screen.getByTestId("balance")).toHaveTextContent("11.00 USDC");
    // Remaining this period (periodAmount - spent = 50 - 10 = 40), not spent.
    expect(screen.getByTestId("budget-remaining")).toHaveTextContent("40.00 / 50.00");
    expect(screen.getByText("left this period")).toBeInTheDocument();
    expect(screen.getByTestId("status")).toHaveTextContent(/active/);
    expect(screen.getByTestId("footer-address")).toHaveTextContent("CAJP…AHCJ");
  });

  it("fills the bar with the spent fraction, not the remaining fraction", () => {
    render(
      <MooringCard
        size="carousel"
        state="active"
        label="x"
        spent={10n * BASE}
        periodAmount={50n * BASE}
      />,
    );
    // 10 spent of a 50 budget -> a 20% bar.
    expect(screen.getByTestId("budget-bar-fill").style.width).toBe("20%");
  });

  it("clamps remaining at zero when spent exceeds the period budget", () => {
    render(<MooringCard size="carousel" state="active" label="x" spent={60n * BASE} periodAmount={50n * BASE} />);
    expect(screen.getByTestId("budget-remaining")).toHaveTextContent("0.00 / 50.00");
  });

  it.each([
    ["active", /active/],
    ["frozen", /frozen/],
    ["expired", /expired/],
    ["cancelled", /cancelled/],
    ["draft", /draft/],
  ] as const)("shows the %s status text", (state, expected) => {
    render(<MooringCard size="carousel" state={state} label="x" />);
    expect(screen.getByTestId("status")).toHaveTextContent(expected);
  });

  it("sets data-selected, data-state and data-size on the root element", () => {
    const { container } = render(<MooringCard size="preview" state="active" label="x" selected />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute("data-selected", "true");
    expect(root).toHaveAttribute("data-state", "active");
    expect(root).toHaveAttribute("data-size", "preview");
  });

  it("defaults data-selected to false", () => {
    const { container } = render(<MooringCard size="carousel" state="active" label="x" />);
    expect(container.firstElementChild).toHaveAttribute("data-selected", "false");
  });

  it("tilts on pointer move by default (carousel/preview), prefixed with perspective and clamped to ±4deg", () => {
    const { container } = render(<MooringCard size="carousel" state="active" label="x" />);
    const root = container.firstElementChild as HTMLElement;

    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      width: 420,
      height: 250,
      top: 0,
      left: 0,
      right: 420,
      bottom: 250,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    expect(root.style.transform).toContain("perspective(1200px)");

    // Far outside the card (clamped to the +0.5 edge on both axes).
    firePointerMove(root, 10_000, 10_000);
    const tiltX = parseFloat(root.style.getPropertyValue("--tilt-x"));
    const tiltY = parseFloat(root.style.getPropertyValue("--tilt-y"));
    expect(Number.isFinite(tiltX)).toBe(true);
    expect(Number.isFinite(tiltY)).toBe(true);
    expect(Math.abs(tiltX)).toBeLessThanOrEqual(4);
    expect(Math.abs(tiltY)).toBeLessThanOrEqual(4);

    fireEvent.pointerLeave(root);
    expect(root.style.getPropertyValue("--tilt-y")).toBe("0deg");
  });

  it("does not attach tilt handlers when prefers-reduced-motion matches, but keeps the same transform style (no hydration mismatch)", () => {
    const { container: normalContainer } = render(<MooringCard size="carousel" state="active" label="x" />);
    const normalTransform = (normalContainer.firstElementChild as HTMLElement).style.transform;
    cleanup();

    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

    const { container } = render(<MooringCard size="carousel" state="active" label="x" />);
    const root = container.firstElementChild as HTMLElement;

    // Same transform string as the non-reduced-motion render — only the
    // handlers differ, never the inline style (this is what keeps SSR and a
    // reduced-motion client from disagreeing on the rendered markup).
    expect(root.style.transform).toBe(normalTransform);

    fireEvent.pointerMove(root, { clientX: 400, clientY: 10 });
    expect(root.style.getPropertyValue("--tilt-y")).toBe("");
  });

  it("does not attach tilt handlers when tilt={false}", () => {
    const { container } = render(<MooringCard size="carousel" state="active" label="x" tilt={false} />);
    const root = container.firstElementChild as HTMLElement;
    fireEvent.pointerMove(root, { clientX: 400, clientY: 10 });
    expect(root.style.getPropertyValue("--tilt-y")).toBe("");
  });

  it("renders no label/balance text for thumb size (minimal thumbnail), with role=img carrying the label", () => {
    render(<MooringCard size="thumb" state="active" label="do-not-render-me" balance={11n * BASE} />);
    expect(screen.queryByText("do-not-render-me")).not.toBeInTheDocument();
    expect(screen.queryByTestId("balance")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: /do-not-render-me card, active/ })).toBeInTheDocument();
  });

  it("falls back to placeholders when balance/expiry/address are not provided", () => {
    render(<MooringCard size="carousel" state="draft" label="new-card" />);
    expect(screen.getByTestId("balance")).toHaveTextContent("— USDC");
    expect(screen.getByTestId("footer-address")).toHaveTextContent("—");
  });
});
