import { StrKey } from "@stellar/stellar-sdk";
import type { CardPolicy } from "@mooring-live/x402-client";

const UNIT = 10_000_000n;

/** `"1.5"` USDC → base units (7 decimals). */
export function parseUsdc(input: string, what = "amount"): bigint {
  const s = input.trim();
  if (!/^\d+(\.\d{1,7})?$/.test(s)) throw new Error(`${what}: enter a USDC amount with at most 7 decimals, e.g. 1 or 0.25`);
  const [whole, frac = ""] = s.split(".");
  const v = BigInt(whole) * UNIT + BigInt(frac.padEnd(7, "0"));
  if (v <= 0n) throw new Error(`${what}: must be greater than 0`);
  return v;
}

/** `"1d" | "12h" | "30m" | "3600"` → seconds. */
export function parsePeriod(input: string): bigint {
  const m = /^(\d+)\s*(s|m|h|d)?$/i.exec(input.trim());
  if (!m) throw new Error("period: use a number of seconds or a duration like 1d, 12h, 30m");
  const n = BigInt(m[1]);
  const unit = (m[2] ?? "s").toLowerCase();
  const mult = unit === "d" ? 86_400n : unit === "h" ? 3_600n : unit === "m" ? 60n : 1n;
  const seconds = n * mult;
  if (seconds <= 0n) throw new Error("period: must be greater than 0");
  return seconds;
}

/** `"+30d"` (relative) or an ISO date → unix seconds, strictly in the future. */
export function parseExpiry(input: string, now: Date = new Date()): bigint {
  const rel = /^\+(\d+)\s*(h|d)$/i.exec(input.trim());
  let unix: number;
  if (rel) {
    const mult = rel[2].toLowerCase() === "d" ? 86_400 : 3_600;
    unix = Math.floor(now.getTime() / 1000) + Number(rel[1]) * mult;
  } else {
    const t = Date.parse(input.trim());
    if (Number.isNaN(t)) throw new Error("expiry: use +30d, +12h or an ISO date like 2026-12-31");
    unix = Math.floor(t / 1000);
  }
  if (unix <= Math.floor(now.getTime() / 1000)) throw new Error("expiry: must be in the future");
  return BigInt(unix);
}

/** A 64-hex string or a `G…` public key → the 32 signer bytes. */
export function parseSigner(input: string): Uint8Array {
  const s = input.trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Uint8Array.from(Buffer.from(s, "hex"));
  if (StrKey.isValidEd25519PublicKey(s)) return Uint8Array.from(StrKey.decodeEd25519PublicKey(s));
  throw new Error("signer: pass the agent's public key as G… or as 64 hex characters (mooring keygen --hex)");
}

export function parseLabel(input: string): string {
  const bytes = new TextEncoder().encode(input).length;
  if (bytes < 1 || bytes > 32) throw new Error("label: 1 to 32 bytes");
  return input;
}

export interface CreateArgs {
  label: string;
  budget: string;
  period: string;
  maxPerTx?: string;
  expiry?: string;
  signer: string;
}

/** Validates the raw options into the contract's `Policy` plus signer and label. */
export function buildPolicy(a: CreateArgs, now: Date = new Date()): { policy: CardPolicy; signer: Uint8Array; label: string } {
  const label = parseLabel(a.label);
  const period_amount = parseUsdc(a.budget, "budget");
  const max_per_tx = a.maxPerTx ? parseUsdc(a.maxPerTx, "max-per-tx") : period_amount;
  if (max_per_tx > period_amount) throw new Error("max-per-tx: cannot be larger than the budget");
  const period_duration = parsePeriod(a.period);
  const expiry = parseExpiry(a.expiry ?? "+30d", now);
  return { policy: { period_amount, period_duration, max_per_tx, expiry }, signer: parseSigner(a.signer), label };
}
