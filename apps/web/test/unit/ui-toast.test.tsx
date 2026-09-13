import { useState } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toast } from "../../components/ui/Toast";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Toast", () => {
  it("renders the message with a polite status role", () => {
    render(<Toast message="Card frozen" onDismiss={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("Card frozen");
  });

  it("calls onDismiss automatically after the duration", () => {
    const onDismiss = vi.fn();
    render(<Toast message="Card frozen" duration={3000} onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2999);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not fire after unmount", () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<Toast message="Card frozen" duration={1000} onDismiss={onDismiss} />);
    unmount();
    vi.advanceTimersByTime(2000);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("minor 1: does not restart the timer when the parent re-renders with a fresh inline onDismiss", () => {
    const dismissed = vi.fn();
    function Harness() {
      const [count, setCount] = useState(0);
      return (
        <div>
          <button type="button" onClick={() => setCount((c) => c + 1)}>
            bump ({count})
          </button>
          {/* A new closure every render — the shape every real caller uses. */}
          <Toast message="Card frozen" duration={1000} onDismiss={() => dismissed()} />
        </div>
      );
    }
    render(<Harness />);

    act(() => {
      vi.advanceTimersByTime(800);
    });
    act(() => {
      screen.getByRole("button").click();
    });
    expect(dismissed).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(dismissed).toHaveBeenCalledTimes(1);
  });
});
