import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Modal } from "../../components/ui/Modal";

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

describe("Modal", () => {
  it("renders nothing when closed and a labelled dialog when open", () => {
    const { rerender } = render(
      <Modal open={false} onClose={() => {}} title="Cancel card">
        <p>content</p>
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <Modal open onClose={() => {}} title="Cancel card">
        <p>content</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog", { name: "Cancel card" })).toHaveAttribute("aria-modal", "true");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Cancel card">
        <p>content</p>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("B1: keeps focus on a controlled input while the parent re-renders with a fresh inline onClose", () => {
    function Harness() {
      const [text, setText] = useState("");
      return (
        <Modal open onClose={() => {}} title="Rotate signer">
          <button type="button">confirm</button>
          <input aria-label="New signer" value={text} onChange={(event) => setText(event.target.value)} />
        </Modal>
      );
    }
    render(<Harness />);
    const input = screen.getByLabelText("New signer");
    input.focus();
    fireEvent.change(input, { target: { value: "G" } });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "GD" } });
    expect(document.activeElement).toBe(input);
  });

  it("only the top-most dialog closes on Escape when a Modal is opened on top of an already-open Sheet", async () => {
    const { Sheet } = await import("../../components/ui/Sheet");
    const onCloseSheet = vi.fn();
    const onCloseModal = vi.fn();

    function Harness() {
      const [modalOpen, setModalOpen] = useState(false);
      return (
        <Sheet open onClose={onCloseSheet} title="Card details">
          <button type="button" onClick={() => setModalOpen(true)}>
            cancel
          </button>
          <Modal open={modalOpen} onClose={onCloseModal} title="Cancel card">
            <button type="button">confirm</button>
          </Modal>
        </Sheet>
      );
    }

    render(<Harness />);
    // The Sheet is open first (pushed onto the dialog stack); the Modal
    // opens on top of it afterward, in a later commit — the realistic
    // sequence for a typed Cancel confirmation opened from the details sheet.
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(screen.getByRole("dialog", { name: "Cancel card" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCloseModal).toHaveBeenCalledTimes(1);
    expect(onCloseSheet).not.toHaveBeenCalled();
  });

  it("Escape closes the nested dialog even when both open in the same commit", async () => {
    const { Sheet } = await import("../../components/ui/Sheet");
    const onCloseSheet = vi.fn();
    const onCloseModal = vi.fn();

    // Both `open` on the first render: React runs the Modal's (child) effect
    // before the Sheet's, so push order alone would put the Sheet on top.
    render(
      <Sheet open onClose={onCloseSheet} title="Card details">
        <Modal open onClose={onCloseModal} title="Cancel card">
          <button type="button">confirm</button>
        </Modal>
      </Sheet>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCloseModal).toHaveBeenCalledTimes(1);
    expect(onCloseSheet).not.toHaveBeenCalled();
  });

  it("pulls focus that fell out of the panel back in, and cycles through the toast stack", () => {
    render(
      <>
        <button type="button">page behind</button>
        <Modal open onClose={() => {}} title="Withdraw">
          <fieldset disabled>
            <input aria-label="amount" />
          </fieldset>
          <button type="button">primary</button>
        </Modal>
        <div data-toast-region="">
          <button type="button">Details</button>
        </div>
      </>,
    );
    const primary = screen.getByRole("button", { name: "primary" });
    const details = screen.getByRole("button", { name: "Details" });

    // The in-flight primary button got disabled and focus dropped to <body>.
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(primary); // the fieldset-disabled input is skipped
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(details);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(primary); // never the page behind
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(details);
  });
});
