import { formatUsdc } from "@/lib/format/usdc";

/** Exact price with trailing zeros trimmed, keeping two decimals ("0.001", "1.00"): micro-prices must not round to 0.00. */
export function formatMerchantPrice(amount: string): string {
  const full = formatUsdc(amount, { full: true });
  const [whole, frac] = full.split(".");
  return `${whole}.${frac.replace(/0+$/, "").padEnd(2, "0")}`;
}
