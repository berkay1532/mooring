import { cleanup, render, screen } from "@testing-library/react";
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
});
