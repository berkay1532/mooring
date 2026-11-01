import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MerchantConfirmModal } from "../../components/merchants/MerchantConfirmModal";
import type { MerchantConfirmModalProps } from "../../components/merchants/MerchantConfirmModal";

const PAY_TO = Keypair.random().publicKey();
const MERCHANT = {
  payTo: PAY_TO,
  url: "https://demo.rail402.dev/weather",
  host: "demo.rail402.dev",
  name: "Rail402 demo",
  amount: "10000",
  network: "stellar:testnet",
};
const CHECK_LABEL = "I understand Mooring has not vetted this service and I take responsibility for allowing it.";

function setup(over: Partial<MerchantConfirmModalProps> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const props: MerchantConfirmModalProps = { open: true, merchant: MERCHANT, mode: "sign", onCancel, onConfirm, ...over };
  const utils = render(<MerchantConfirmModal {...props} />);
  return { onConfirm, onCancel, props, ...utils };
}

afterEach(() => cleanup());

describe("MerchantConfirmModal", () => {
  it("titles the dialog per mode", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Allow demo.rail402.dev?" })).toBeInTheDocument();
    cleanup();
    setup({ mode: "list" });
    expect(screen.getByRole("dialog", { name: "Add demo.rail402.dev to the list?" })).toBeInTheDocument();
  });

  it("shows service, host, price, network and the full address", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Rail402 demo");
    expect(dialog).toHaveTextContent("demo.rail402.dev");
    expect(dialog).toHaveTextContent("0.001 USDC / request");
    expect(dialog).toHaveTextContent("Stellar testnet");
    expect(screen.getByText(PAY_TO)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy address" })).toBeInTheDocument();
  });

  it("shows the responsibility notice and the scope sentence", () => {
    setup();
    expect(screen.getByText(/It does not vouch for the service/)).toBeInTheDocument();
    expect(
      screen.getByText("You are allowing every payment to this address within the card's limits, not just this URL."),
    ).toBeInTheDocument();
  });

  it("adds the link sentence only with linkOrigin", () => {
    const { unmount } = setup({ linkOrigin: true });
    expect(screen.getByText(/came from a link/)).toBeInTheDocument();
    unmount();
    setup();
    expect(screen.queryByText(/came from a link/)).toBeNull();
  });

  it("keeps the primary button disabled until the checkbox is checked", () => {
    setup();
    const primary = screen.getByRole("button", { name: "Allow and sign" });
    expect(primary).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: CHECK_LABEL }));
    expect(primary).toBeEnabled();
  });

  it("labels the primary button per mode", () => {
    setup({ mode: "list" });
    expect(screen.getByRole("button", { name: "Add to list" })).toBeDisabled();
  });

  it("calls onConfirm once when confirmed", () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Allow and sign" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Cancel calls onCancel only", () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("resets the checkbox when reopened", () => {
    const { rerender, props } = setup();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox")).toBeChecked();
    rerender(<MerchantConfirmModal {...props} open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<MerchantConfirmModal {...props} open />);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Allow and sign" })).toBeDisabled();
  });

  it("renders nothing without a merchant", () => {
    setup({ merchant: null });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
