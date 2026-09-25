import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "../../components/ui/Button";

afterEach(() => cleanup());

describe("Button", () => {
  it("defaults to type=button", () => {
    render(<Button>Fund</Button>);
    expect(screen.getByRole("button", { name: "Fund" })).toHaveAttribute("type", "button");
  });

  it("is disabled and aria-busy while loading", () => {
    render(<Button loading>Fund</Button>);
    const button = screen.getByRole("button", { name: "Fund" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});
