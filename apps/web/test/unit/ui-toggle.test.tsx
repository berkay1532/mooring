import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Toggle } from "../../components/ui/Toggle";

afterEach(() => cleanup());

const OPTIONS = [
  { value: "hour", label: "hour" },
  { value: "day", label: "day" },
  { value: "week", label: "week" },
] as const;

describe("Toggle", () => {
  it("renders a radiogroup with the selected option checked", () => {
    render(<Toggle options={OPTIONS} value="day" onChange={() => {}} aria-label="Period unit" />);
    expect(screen.getByRole("radiogroup", { name: "Period unit" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "day" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "hour" })).toHaveAttribute("aria-checked", "false");
  });

  it("moves selection with the arrow keys", () => {
    const onChange = vi.fn();
    render(<Toggle options={OPTIONS} value="day" onChange={onChange} aria-label="Period unit" />);
    const current = screen.getByRole("radio", { name: "day" });
    fireEvent.keyDown(current, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("week");

    fireEvent.keyDown(current, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith("hour");
  });

  it("selects an option on click", () => {
    const onChange = vi.fn();
    render(<Toggle options={OPTIONS} value="day" onChange={onChange} aria-label="Period unit" />);
    fireEvent.click(screen.getByRole("radio", { name: "hour" }));
    expect(onChange).toHaveBeenCalledWith("hour");
  });

  it("Home/End jump to the first/last option", () => {
    const onChange = vi.fn();
    render(<Toggle options={OPTIONS} value="day" onChange={onChange} aria-label="Period unit" />);
    const current = screen.getByRole("radio", { name: "day" });
    fireEvent.keyDown(current, { key: "End" });
    expect(onChange).toHaveBeenCalledWith("week");
    fireEvent.keyDown(current, { key: "Home" });
    expect(onChange).toHaveBeenCalledWith("hour");
  });

  it("defaults to the pill shape and switches to the segment (10px radius) shape", () => {
    const { container, rerender } = render(
      <Toggle options={OPTIONS} value="day" onChange={() => {}} aria-label="Period unit" />,
    );
    const group = () => container.querySelector('[role="radiogroup"]') as HTMLElement;
    expect(group().className).toContain("rounded-full");

    rerender(<Toggle options={OPTIONS} value="day" onChange={() => {}} aria-label="Period unit" shape="segment" />);
    expect(group().className).toContain("rounded-[10px]");
  });
});
