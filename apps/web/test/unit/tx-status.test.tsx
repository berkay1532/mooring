import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TxStatus } from "../../components/ui/TxStatus";

afterEach(() => cleanup());

function stepStatus(container: HTMLElement, step: string) {
  return container.querySelector(`[data-step="${step}"]`)?.getAttribute("data-step-status");
}

describe("TxStatus", () => {
  it("idle carries the state but renders no steps", () => {
    const { container } = render(<TxStatus state="idle" />);
    const region = container.querySelector('[role="status"]');
    expect(region).toHaveAttribute("data-state", "idle");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(container.querySelector('[data-step="prepared"]')).not.toBeInTheDocument();
  });

  it("preparing marks Prepared current and the rest pending", () => {
    const { container } = render(<TxStatus state="preparing" />);
    expect(stepStatus(container, "prepared")).toBe("current");
    expect(stepStatus(container, "signature")).toBe("pending");
    expect(stepStatus(container, "submitted")).toBe("pending");
    expect(stepStatus(container, "confirmed")).toBe("pending");
  });

  it("signing marks Prepared done and Signature current", () => {
    const { container } = render(<TxStatus state="signing" />);
    expect(stepStatus(container, "prepared")).toBe("done");
    expect(stepStatus(container, "signature")).toBe("current");
    expect(stepStatus(container, "submitted")).toBe("pending");
  });

  it("submitted marks Prepared and Signature done, Submitted current", () => {
    const { container } = render(<TxStatus state="submitted" />);
    expect(stepStatus(container, "prepared")).toBe("done");
    expect(stepStatus(container, "signature")).toBe("done");
    expect(stepStatus(container, "submitted")).toBe("current");
    expect(stepStatus(container, "confirmed")).toBe("pending");
  });

  it("confirmed marks every step done", () => {
    const { container } = render(<TxStatus state="confirmed" />);
    expect(stepStatus(container, "prepared")).toBe("done");
    expect(stepStatus(container, "signature")).toBe("done");
    expect(stepStatus(container, "submitted")).toBe("done");
    expect(stepStatus(container, "confirmed")).toBe("done");
  });

  it("renders the hash and an explorer link with safe target/rel when present", () => {
    render(<TxStatus state="confirmed" hash="abc123" explorerUrl="https://stellar.expert/explorer/testnet/tx/abc123" />);
    expect(screen.getByText("abc123")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /view transaction/i });
    expect(link).toHaveAttribute("href", "https://stellar.expert/explorer/testnet/tx/abc123");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("renders no explorer link when explorerUrl is absent even with a hash", () => {
    render(<TxStatus state="confirmed" hash="abc123" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("failed renders no timeline, but the error title/detail and a next action button when onNext is given", () => {
    const onNext = vi.fn();
    const { container } = render(
      <TxStatus
        state="failed"
        error={{
          title: "Policy rejected",
          detail: "Per-tx limit cannot exceed the period budget (code #11).",
          next: "Fix the policy",
        }}
        onNext={onNext}
      />,
    );
    expect(container.querySelector('[data-step="prepared"]')).not.toBeInTheDocument();
    expect(screen.getByText("Policy rejected")).toBeInTheDocument();
    expect(screen.getByText(/per-tx limit/i)).toBeInTheDocument();

    const button = screen.getByRole("button", { name: "Fix the policy" });
    fireEvent.click(button);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("renders the next action as plain text (not a button) when onNext is not given", () => {
    render(<TxStatus state="failed" error={{ title: "Failed", next: "Fix" }} />);
    expect(screen.queryByRole("button", { name: "Fix" })).not.toBeInTheDocument();
    expect(screen.getByText("Fix")).toBeInTheDocument();
  });

  it("renders the transaction details disclosure: contract, function, args and the envelope XDR", () => {
    render(
      <TxStatus
        state="signing"
        details={{
          contract: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
          fn: "transfer",
          args: [
            { name: "from", value: "GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD" },
            { name: "amount", value: "15000000" },
          ],
          xdr: "AAAAAgAAAAC=",
        }}
      />,
    );

    const disclosure = screen.getByTestId("tx-details");
    expect(disclosure.tagName).toBe("DETAILS");
    expect(screen.getByText("Transaction details")).toBeInTheDocument();
    expect(within(disclosure).getByText("contract")).toBeInTheDocument();
    expect(
      within(disclosure).getByText("CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"),
    ).toBeInTheDocument();
    expect(within(disclosure).getByText("transfer")).toBeInTheDocument();
    expect(within(disclosure).getByText("from")).toBeInTheDocument();
    expect(within(disclosure).getByText("amount")).toBeInTheDocument();
    expect(within(disclosure).getByText("15000000")).toBeInTheDocument();
    expect(disclosure.querySelector("pre")?.textContent).toBe("AAAAAgAAAAC=");
    expect(within(disclosure).getByRole("button", { name: "copy" })).toBeInTheDocument();
  });

  it("renders no disclosure when there are no details, or while idle", () => {
    const { container, rerender } = render(<TxStatus state="signing" />);
    expect(container.querySelector('[data-testid="tx-details"]')).toBeNull();

    rerender(<TxStatus state="idle" details={{ contract: "C", fn: "freeze", args: [], xdr: "AAAA" }} />);
    expect(container.querySelector('[data-testid="tx-details"]')).toBeNull();
  });
});
