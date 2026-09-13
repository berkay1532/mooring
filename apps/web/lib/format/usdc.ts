/**
 * USDC (SEP-41 SAC) formatting and parsing. USDC has 7 decimals, so one whole
 * USDC is `10_000_000` base units.
 */
const DECIMALS = 7;
const BASE = 10n ** BigInt(DECIMALS);

/** `^\d+(\.\d{1,7})?$` — a plain non-negative decimal with at most 7 fraction digits. */
const USER_INPUT_RE = /^\d+(\.\d{1,7})?$/;

/**
 * Formats base units as a decimal USDC string.
 *
 * Display rounds to nearest at the requested precision (round-half-up),
 * it does not truncate: `109_980_000n` (10.998 USDC) must read as `"11.00"`
 * at 2 decimals, since 10.998 is genuinely closer to 11.00 than to 10.99 and
 * showing "10.99" would understate the balance just as much as overstating
 * it would. Full precision (`{ full: true }`, 7 decimals) never actually
 * rounds anything — it is an exact readout of the base units, so there is
 * nothing coarser to round away.
 *
 * - Default: 2 decimal places (`"11.00"`).
 * - `{ full: true }`: full 7-decimal precision (`"10.9980000"`).
 *
 * `base` as a string must be a plain base-unit integer (optionally signed,
 * e.g. `"109980000"` or `"-1"`) — the same shape `BigInt()` accepts for an
 * integer; it is not a decimal USDC amount (use `parseUsdc` for that), and a
 * non-integer string (`"1.5"`) or non-numeric string (`"abc"`) throws, same
 * as `BigInt()` does. On-chain balances are never negative, but a rounded
 * negative value that lands on zero (`-1n` at 2 decimals) is shown as
 * `"0.00"`, not `"-0.00"` — there is no such thing as a negative zero here.
 */
export function formatUsdc(base: bigint | string, opts?: { full?: boolean }): string {
  const value = typeof base === "bigint" ? base : BigInt(base);
  const negative = value < 0n;
  const abs = negative ? -value : value;

  const places = opts?.full ? DECIMALS : 2;
  const scale = 10n ** BigInt(DECIMALS - places);
  const scaled = (abs + scale / 2n) / scale; // round-half-up at `places` decimals

  const divisor = 10n ** BigInt(places);
  const whole = scaled / divisor;
  const fraction = scaled % divisor;
  const fractionStr = fraction.toString().padStart(places, "0");

  const sign = negative && scaled !== 0n ? "-" : "";
  return `${sign}${whole.toString()}.${fractionStr}`;
}

/**
 * Parses a user-entered decimal USDC amount into base units.
 *
 * Rejects: negative numbers, non-numeric input, empty input, more than 7
 * decimal places, and any shape other than plain digits with an optional
 * decimal point (no leading/trailing whitespace, no exponents, no leading
 * "." with no integer part, no trailing "." with no fraction part).
 */
export function parseUsdc(input: string): bigint | null {
  if (!USER_INPUT_RE.test(input)) return null;

  const [wholePart, fractionPart = ""] = input.split(".");
  const paddedFraction = fractionPart.padEnd(DECIMALS, "0");

  return BigInt(wholePart) * BASE + BigInt(paddedFraction);
}
