import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Field } from "../../components/ui/Field";

afterEach(() => cleanup());

describe("Field", () => {
  it("associates the label and hint with the input", () => {
    render(<Field label="Period budget" hint="Cannot be zero." unit="USDC" defaultValue="50" />);
    const input = screen.getByLabelText("Period budget");
    expect(input).toHaveAccessibleDescription("Cannot be zero.");
    expect(screen.getByText("USDC")).toBeInTheDocument();
  });

  it("renders an error with aria-invalid and aria-describedby pointing at it", () => {
    render(<Field label="Per-tx cap" error="Cannot exceed the period budget." />);
    const input = screen.getByLabelText("Per-tx cap");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const errorNode = document.getElementById(describedBy as string);
    expect(errorNode).toHaveTextContent("Cannot exceed the period budget.");
  });
});
