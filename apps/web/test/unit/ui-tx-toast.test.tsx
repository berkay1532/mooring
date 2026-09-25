import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONFIRMED_DISMISS_MS,
  TxToast,
  TxToastProvider,
  useTxToast,
  useTxToasts,
  type TrackedAction,
  type TxToastData,
} from "../../components/ui/TxToast";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const HASH = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const DETAILS = {
  contract: "CAJPWJRJPFIY6XYYQIVCC3XLYFYQVNJIJ6XVPTUY4EBLNQ3CFN2AHCJ",
  fn: "withdraw",
  args: [{ name: "amount", value: "10000000" }],
  xdr: "AAAAAgAAAABXDR",
};

function toast(over: Partial<TxToastData> = {}): TxToastData {
  return { label: "Freeze inference-agent", state: "preparing", ...over };
}

describe("TxToast", () => {
  it.each([
    ["preparing", "Preparing the transaction", 0],
    ["signing", "Waiting for signature in your wallet", 1],
    ["submitted", "Submitted — waiting for confirmation", 2],
  ] as const)("in flight (%s): label, step name, dots, no close button", (state, headline, done) => {
    const { container } = render(<TxToast toast={toast({ state })} onDismiss={() => {}} />);
    const node = screen.getByRole("status");
    expect(node).toHaveAttribute("data-state", state);
    expect(node).toHaveTextContent("Freeze inference-agent");
    expect(node).toHaveTextContent(headline);
    expect(container.querySelectorAll("li[data-step]")).toHaveLength(4);
    expect(container.querySelectorAll('li[data-step-status="done"]')).toHaveLength(done);
    expect(container.querySelectorAll('li[data-step-status="current"]')).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });

  it("confirmed: every step done, the short hash and the explorer link", () => {
    const url = `https://stellar.expert/explorer/testnet/tx/${HASH}`;
    const { container } = render(
      <TxToast toast={toast({ state: "confirmed", hash: HASH, explorerUrl: url })} onDismiss={() => {}} />,
    );
    const node = screen.getByRole("status");
    expect(node).toHaveTextContent("Confirmed");
    expect(container.querySelectorAll('li[data-step-status="done"]')).toHaveLength(4);
    expect(screen.getByText(`${HASH.slice(0, 8)}…${HASH.slice(-8)}`)).toHaveAttribute("title", HASH);
    expect(screen.getByRole("link", { name: /view transaction/i })).toHaveAttribute("href", url);
  });

  it("failed: an alert with the translated title, detail and next step, and no timeline", () => {
    const { container } = render(
      <TxToast
        toast={toast({
          state: "failed",
          error: { title: "Policy rejected", detail: "Per-tx limit exceeded (code #11).", next: "Fix the policy" },
        })}
        onDismiss={() => {}}
      />,
    );
    const node = screen.getByRole("alert");
    expect(node).toHaveTextContent("Policy rejected");
    expect(node).toHaveTextContent("Per-tx limit exceeded (code #11).");
    expect(node).toHaveTextContent("Fix the policy");
    expect(node).toHaveTextContent("Freeze inference-agent");
    expect(container.querySelector("li[data-step]")).toBeNull();
  });

  it("auto-dismisses a confirmed toast after 10 s", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<TxToast toast={toast({ state: "confirmed", hash: HASH })} onDismiss={onDismiss} />);
    act(() => void vi.advanceTimersByTime(CONFIRMED_DISMISS_MS - 1));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("never auto-dismisses a failed or in-flight toast", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(<TxToast toast={toast({ state: "failed", error: { title: "No" } })} onDismiss={onDismiss} />);
    act(() => void vi.advanceTimersByTime(CONFIRMED_DISMISS_MS * 10));
    rerender(<TxToast toast={toast({ state: "submitted" })} onDismiss={onDismiss} />);
    act(() => void vi.advanceTimersByTime(CONFIRMED_DISMISS_MS * 10));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("can be closed early once settled", () => {
    const onDismiss = vi.fn();
    render(<TxToast toast={toast({ state: "failed", error: { title: "No" } })} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("keeps the §7 details collapsed until the Details toggle, then shows the XDR", () => {
    render(<TxToast toast={toast({ state: "signing", details: DETAILS })} onDismiss={() => {}} />);
    const toggle = screen.getByRole("button", { name: /details/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(DETAILS.xdr)).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(DETAILS.xdr)).toBeInTheDocument();
    expect(screen.getByText(DETAILS.contract)).toBeInTheDocument();
    expect(screen.getByText("withdraw")).toBeInTheDocument();
    expect(screen.getByText("amount")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "copy" })).toBeInTheDocument();
  });

  it("holds a confirmed toast while its details are open", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<TxToast toast={toast({ state: "confirmed", details: DETAILS })} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    act(() => void vi.advanceTimersByTime(CONFIRMED_DISMISS_MS * 2));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

// --- the stack + useTxToast ---------------------------------------------------

/** A hand-driven action, standing in for `useContractAction`. */
function Harness({ label = "Freeze card" }: { label?: string }) {
  const [action, setAction] = useState<TrackedAction>({ state: "idle", hash: null, error: null, details: null });
  const toast = useTxToast(action, { explorerUrl: (h) => `https://x/${h}` });
  const { notify } = useTxToasts();
  return (
    <div>
      <button type="button" onClick={() => { toast.begin(label); setAction({ state: "preparing", hash: null, error: null, details: null }); }}>
        run
      </button>
      <button type="button" onClick={() => setAction((a) => ({ ...a, state: "signing", details: DETAILS }))}>
        sign
      </button>
      <button type="button" onClick={() => setAction((a) => ({ ...a, state: "confirmed", hash: HASH }))}>
        confirm
      </button>
      <button type="button" onClick={() => setAction((a) => ({ ...a, state: "failed", error: { title: "Declined" } }))}>
        fail
      </button>
      <button type="button" onClick={() => notify("Card added")}>
        notify
      </button>
    </div>
  );
}

describe("TxToastProvider + useTxToast", () => {
  it("shows one toast per run and follows its states", () => {
    render(
      <TxToastProvider>
        <Harness />
      </TxToastProvider>,
    );
    expect(screen.queryByTestId("tx-toast")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("run"));
    expect(screen.getByTestId("tx-toast")).toHaveAttribute("data-state", "preparing");
    expect(screen.getByTestId("tx-toast")).toHaveTextContent("Freeze card");

    // The details are reachable at `signing` — before the wallet answers.
    fireEvent.click(screen.getByText("sign"));
    expect(screen.getByTestId("tx-toast")).toHaveAttribute("data-state", "signing");
    expect(screen.getByRole("button", { name: /details/i })).toBeInTheDocument();

    fireEvent.click(screen.getByText("confirm"));
    expect(screen.getByTestId("tx-toast")).toHaveAttribute("data-state", "confirmed");
    expect(screen.getByRole("link", { name: /view transaction/i })).toHaveAttribute("href", `https://x/${HASH}`);

    // A second run is a second toast; the first stays until it times out.
    fireEvent.click(screen.getByText("run"));
    const toasts = screen.getAllByTestId("tx-toast");
    expect(toasts).toHaveLength(2);
    expect(toasts[0]).toHaveAttribute("data-state", "confirmed");
    expect(toasts[1]).toHaveAttribute("data-state", "preparing");
  });

  it("keeps a failed toast until it is closed", () => {
    vi.useFakeTimers();
    render(
      <TxToastProvider>
        <Harness />
      </TxToastProvider>,
    );
    fireEvent.click(screen.getByText("run"));
    fireEvent.click(screen.getByText("fail"));
    act(() => void vi.advanceTimersByTime(CONFIRMED_DISMISS_MS * 6));
    expect(screen.getByRole("alert")).toHaveTextContent("Declined");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says it stopped following a transaction whose component unmounted mid-flight", () => {
    function Toggle() {
      const [shown, setShown] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setShown(false)}>
            leave
          </button>
          {shown ? <Harness /> : null}
        </>
      );
    }
    render(
      <TxToastProvider>
        <Toggle />
      </TxToastProvider>,
    );
    fireEvent.click(screen.getByText("run"));
    fireEvent.click(screen.getByText("leave"));
    expect(screen.getByRole("alert")).toHaveTextContent(/no longer following/i);
  });

  it("puts plain notices in the same stack", () => {
    render(
      <TxToastProvider>
        <Harness />
      </TxToastProvider>,
    );
    fireEvent.click(screen.getByText("notify"));
    expect(screen.getByRole("status")).toHaveTextContent("Card added");
  });

  it("is a silent no-op without a provider", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("run"));
    expect(screen.queryByTestId("tx-toast")).not.toBeInTheDocument();
  });
});
