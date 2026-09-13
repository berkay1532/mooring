import { describe, expect, it } from "vitest";
import { formatUsdc, parseUsdc } from "../../lib/format/usdc";
import { formatDuration, formatCountdown } from "../../lib/format/time";
import { shortAddress } from "../../lib/format/address";

describe("usdc", () => {
  it("formats base units with two decimals and full precision on demand", () => {
    expect(formatUsdc(109_980_000n)).toBe("11.00");
    expect(formatUsdc("109980000", { full: true })).toBe("10.9980000");
    expect(formatUsdc(0n)).toBe("0.00");
  });
  it("parses user input to base units", () => {
    expect(parseUsdc("20")).toBe(200_000_000n);
    expect(parseUsdc("0.001")).toBe(10_000n);
    expect(parseUsdc("1.23456789")).toBeNull();
    expect(parseUsdc("-1")).toBeNull();
    expect(parseUsdc("abc")).toBeNull();
  });

  // Extra edge cases beyond the brief.
  it("rounds to nearest at the display precision, in both directions", () => {
    // 10.9999999 rounds up to 11.00 at 2 decimals...
    expect(formatUsdc(109_999_999n)).toBe("11.00");
    // ...but full precision is an exact readout, never rounded.
    expect(formatUsdc(109_999_999n, { full: true })).toBe("10.9999999");
    // 10.994 rounds down to 10.99 at 2 decimals.
    expect(formatUsdc(109_940_000n)).toBe("10.99");
  });
  it("accepts a plain numeric string of base units", () => {
    expect(formatUsdc("0")).toBe("0.00");
  });
  it("rejects malformed numeric shapes", () => {
    expect(parseUsdc("1.")).toBeNull();
    expect(parseUsdc(".5")).toBeNull();
    expect(parseUsdc("")).toBeNull();
    expect(parseUsdc("NaN")).toBeNull();
    expect(parseUsdc("Infinity")).toBeNull();
    expect(parseUsdc("1e5")).toBeNull();
    expect(parseUsdc("1 ")).toBeNull();
    expect(parseUsdc(" 1")).toBeNull();
  });
  it("accepts zero and exactly seven decimal places", () => {
    expect(parseUsdc("0")).toBe(0n);
    expect(parseUsdc("0.0000000")).toBe(0n);
    expect(parseUsdc("1.2345678")).toBe(12345678n); // exactly 7 decimals is the max allowed
  });
  it("parses very large values without losing precision", () => {
    expect(parseUsdc("12345678901.1234567")).toBe(123456789011234567n);
  });
});

describe("time", () => {
  it("formats durations", () => {
    expect(formatDuration(29 * 86_400)).toBe("29 days");
    expect(formatDuration(86_400)).toBe("1 day");
    expect(formatDuration(14 * 3600 + 20 * 60)).toBe("14 h 20 m");
    expect(formatDuration(45)).toBe("45 s");
  });
  it("counts down and clamps at zero", () => {
    expect(formatCountdown(1_000_100, 1_000_000)).toBe("1 m 40 s");
    expect(formatCountdown(1_000_000, 1_000_100)).toBe("now");
  });
  it("handles zero and negative durations", () => {
    expect(formatDuration(0)).toBe("0 s");
    expect(formatDuration(-5)).toBe("0 s");
  });
  it("treats an exact-now countdown as now", () => {
    expect(formatCountdown(1_000_000, 1_000_000)).toBe("now");
  });
});

describe("address", () => {
  it("shortens", () => {
    expect(shortAddress("CBOOOQDW4YA7JHDW4ELMKRFUUBJFBOJZGB4IXZJTHSAGUE4TWKJXUH5W")).toBe("CBOO…UH5W");
  });
  it("returns short strings unchanged", () => {
    expect(shortAddress("SHORT")).toBe("SHORT");
  });
});
