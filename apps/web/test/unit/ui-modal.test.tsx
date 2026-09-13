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
});
