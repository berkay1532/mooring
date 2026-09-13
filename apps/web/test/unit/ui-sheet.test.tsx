import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Sheet } from "../../components/ui/Sheet";

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

describe("Sheet", () => {
  it("renders nothing when closed", () => {
    render(
      <Sheet open={false} onClose={() => {}} title="Fund card">
        <p>content</p>
      </Sheet>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders a labelled dialog and locks body scroll while open", () => {
    render(
      <Sheet open onClose={() => {}} title="Fund card">
        <p>content</p>
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "Fund card" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Fund card">
        <p>content</p>
      </Sheet>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a backdrop click", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Sheet open onClose={onClose} title="Fund card">
        <p>content</p>
      </Sheet>,
    );
    const backdrop = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("traps focus: Tab from the last focusable element cycles to the first", () => {
    render(
      <Sheet open onClose={() => {}} title="Fund card">
        <button type="button">first</button>
        <button type="button">last</button>
      </Sheet>,
    );
    const first = screen.getByRole("button", { name: "first" });
    const last = screen.getByRole("button", { name: "last" });
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("restores focus to the previously focused element on close", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            open
          </button>
          <Sheet open={open} onClose={() => setOpen(false)} title="Fund card">
            <button type="button">inside</button>
          </Sheet>
        </div>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "open" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(opener);
  });

  it("B1: keeps focus on a controlled input while the parent re-renders with a fresh inline onClose", () => {
    function Harness() {
      const [text, setText] = useState("");
      return (
        // `onClose={() => {}}` is a new closure on every Harness render — the
        // exact shape every real caller uses (`onClose={() => setOpen(false)}`).
        <Sheet open onClose={() => {}} title="Fund card">
          <button type="button">segment</button>
          <input aria-label="Amount" value={text} onChange={(event) => setText(event.target.value)} />
        </Sheet>
      );
    }
    render(<Harness />);
    const input = screen.getByLabelText("Amount");
    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: "2" } });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "20" } });
    expect(document.activeElement).toBe(input);
  });

  it("does not restore body overflow on a re-render that keeps the sheet open (inline onClose)", () => {
    function Harness() {
      const [text, setText] = useState("");
      return (
        <Sheet open onClose={() => {}} title="Fund card">
          <input aria-label="Amount" value={text} onChange={(event) => setText(event.target.value)} />
        </Sheet>
      );
    }
    render(<Harness />);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "5" } });
    expect(document.body.style.overflow).toBe("hidden");
  });
});
