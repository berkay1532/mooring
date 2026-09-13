import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MooringCard } from "../../components/card/MooringCard";

const BASE = 10_000_000n;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MooringCard", () => {
  it("renders the label, balance, and today's budget line for an active card", () => {
    const now = Math.floor(Date.now() / 1000);
    render(
      <MooringCard
        size="carousel"
        state="active"
        label="inference-agent"
        address="CAJPWJRJPFIY6XYYQIVCC3XLYFYQVNJIJ6XVPTUY4EBLNQ3CFN2AHCJ"
        balance={11n * BASE}
        spent={40n * BASE}
        periodAmount={50n * BASE}
        expiry={now + 2_505_600}
        nowUnix={now}
        allowCount={1}
        signer="GDHDJL3RT6S3OABSHLOEOCBH4BMMAKLVOR5FPEHXG5ZW2DDJDRRJJSM7"
      />,
    );

    expect(screen.getByText("inference-agent")).toBeInTheDocument();
    expect(screen.getByTestId("balance")).toHaveTextContent("11.00 USDC");
    expect(screen.getByTestId("budget-spent")).toHaveTextContent("40.00 / 50.00");
    expect(screen.getByTestId("status")).toHaveTextContent(/active/);
    expect(screen.getByTestId("footer-address")).toHaveTextContent("CAJP…AHCJ");
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

  it("tilts on pointer move by default (carousel/preview)", () => {
    const { container } = render(<MooringCard size="carousel" state="active" label="x" />);
    const root = container.firstElementChild as HTMLElement;
    fireEvent.pointerMove(root, { clientX: 400, clientY: 10 });
    expect(root.style.getPropertyValue("--tilt-y")).not.toBe("");
    fireEvent.pointerLeave(root);
    expect(root.style.getPropertyValue("--tilt-y")).toBe("0deg");
  });

  it("does not attach tilt handlers when prefers-reduced-motion matches", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

    const { container } = render(<MooringCard size="carousel" state="active" label="x" />);
    const root = container.firstElementChild as HTMLElement;
    fireEvent.pointerMove(root, { clientX: 400, clientY: 10 });
    expect(root.style.getPropertyValue("--tilt-y")).toBe("");
  });

  it("does not attach tilt handlers when tilt={false}", () => {
    const { container } = render(<MooringCard size="carousel" state="active" label="x" tilt={false} />);
    const root = container.firstElementChild as HTMLElement;
    fireEvent.pointerMove(root, { clientX: 400, clientY: 10 });
    expect(root.style.getPropertyValue("--tilt-y")).toBe("");
  });

  it("renders no label/balance text for thumb size (minimal thumbnail)", () => {
    render(<MooringCard size="thumb" state="active" label="do-not-render-me" balance={11n * BASE} />);
    expect(screen.queryByText("do-not-render-me")).not.toBeInTheDocument();
    expect(screen.queryByTestId("balance")).not.toBeInTheDocument();
  });

  it("falls back to placeholders when balance/expiry/address are not provided", () => {
    render(<MooringCard size="carousel" state="draft" label="new-card" />);
    expect(screen.getByTestId("balance")).toHaveTextContent("— USDC");
    expect(screen.getByTestId("footer-address")).toHaveTextContent("—");
  });
});
