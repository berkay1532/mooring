/**
 * Pure validation for the new-card wizard (spec §3.3). Everything here is
 * free of React, the network and the wallet so it can be unit-tested
 * directly, and so the wizard and the "Edit policy" modal can agree on the
 * same rules the contract enforces.
 *
 * The rules mirror `contracts/card/src/policy.rs` (`period_amount > 0`,
 * `period_duration != 0`, `0 < max_per_tx <= period_amount`, `expiry > now`)
 * and `contracts/card/src/label.rs` (a label is 1..=32 **bytes**), so an
 * `InvalidPolicy`/`InvalidLabel` is caught before anything is signed.
 */
import { Buffer } from "buffer";
import { StrKey } from "@stellar/stellar-sdk";
import type { Card } from "@mooring/contracts-ts";

import { parseUsdc } from "../format/usdc";

/** `contracts/card/src/label.rs::MAX_LABEL_LEN` — bytes, not characters. */
export const MAX_LABEL_BYTES = 32;

/** `contracts/card/src/lib.rs::MAX_ALLOWLIST`. */
export const MAX_MERCHANTS = 32;

/**
 * Floor for a custom period. The contract only requires a non-zero period,
 * but a period shorter than a minute cannot be operated sensibly (ledger
 * close times alone are ~5 s, and the period resets while a payment is in
 * flight), so the app refuses it and says so.
 */
export const MIN_CUSTOM_PERIOD_SECS = 60;

/**
 * Sanity ceiling on an amount, in whole USDC. `i128` reaches far past this,
 * but a budget in the trillions is a typo, and without a bound the mistake
 * only surfaces as an untranslated scval conversion error at signing time.
 */
export const MAX_AMOUNT_USDC = 1_000_000_000_000n;
const MAX_AMOUNT_BASE = MAX_AMOUNT_USDC * 10_000_000n;

export type PeriodUnit = "hour" | "day" | "week" | "custom";
export type ExpiryPreset = "7" | "30" | "90" | "date";

export const UNIT_SECONDS: Record<Exclude<PeriodUnit, "custom">, bigint> = {
  hour: 3_600n,
  day: 86_400n,
  week: 604_800n,
};

export interface PolicyInput {
  /** Period budget in decimal USDC, as typed. */
  budget: string;
  unit: PeriodUnit;
  /** Period length in seconds, as typed (only read when `unit` is `"custom"`). */
  customSeconds: string;
  /** Per-transaction cap in decimal USDC, as typed. */
  perTx: string;
  expiryPreset: ExpiryPreset;
  /** `YYYY-MM-DD` (only read when `expiryPreset` is `"date"`). */
  expiryDate: string;
  /** Injected "now" in Unix seconds — the caller owns the clock so tests are deterministic. */
  nowUnix: number;
}

export interface PolicyValidation {
  /** Per-field messages, keyed `budget` | `period` | `perTx` | `expiry`. Empty when valid. */
  errors: Record<string, string>;
  /** Only present when `errors` is empty. */
  policy?: Card.Policy;
  /** The resolved period length, even when another field is invalid (for the live preview). */
  periodSecs?: bigint;
  /** The resolved expiry in Unix seconds, even when another field is invalid (for the live preview). */
  expiryUnix?: number;
  /** The parsed period budget in base units, when it parses (for the live preview). */
  budgetBase?: bigint;
}

const SECONDS_PER_DAY = 86_400;

/** A whole number of seconds, or `null`. */
function parseSeconds(value: string): bigint | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return BigInt(trimmed);
}

/**
 * The Unix second an expiry choice resolves to: a preset is `now + N days`;
 * a date is the end of that day in the owner's own timezone, so "expires on
 * the 12th" means the card still works all through the 12th.
 */
export function resolveExpiry(input: PolicyInput): number | null {
  if (input.expiryPreset !== "date") {
    return input.nowUnix + Number(input.expiryPreset) * SECONDS_PER_DAY;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiryDate)) return null;
  const ms = new Date(`${input.expiryDate}T23:59:59`).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** The period length in seconds for the chosen unit, or `null` if unparseable. */
export function resolvePeriod(input: PolicyInput): bigint | null {
  return input.unit === "custom" ? parseSeconds(input.customSeconds) : UNIT_SECONDS[input.unit];
}

/**
 * An amount message that distinguishes "too many decimals" from "not a
 * number", because the first is a real and easily-made mistake (USDC has 7
 * decimals) and the user needs to be told which one it is.
 */
function amountError(raw: string, what: string): string {
  const trimmed = raw.trim();
  if (trimmed.length > 0 && /^\d*\.\d{8,}$/.test(trimmed)) {
    return "USDC has at most 7 decimal places.";
  }
  return `Enter ${what} greater than 0.`;
}

/** `undefined` when the amount is within the app's supported range. */
function tooLarge(value: bigint | null, what: string): string | undefined {
  if (value === null || value <= MAX_AMOUNT_BASE) return undefined;
  return `That ${what} is larger than this app supports (up to ${MAX_AMOUNT_USDC.toLocaleString("en-GB")} USDC).`;
}

/** Validates the policy fields and, when they all pass, the `Policy` to sign. */
export function validatePolicy(input: PolicyInput): PolicyValidation {
  const errors: Record<string, string> = {};

  const budget = parseUsdc(input.budget.trim());
  if (budget === null || budget <= 0n) {
    errors.budget = amountError(input.budget, "a budget");
  } else {
    const over = tooLarge(budget, "budget");
    if (over) errors.budget = over;
  }

  const perTx = parseUsdc(input.perTx.trim());
  if (perTx === null || perTx <= 0n) {
    errors.perTx = amountError(input.perTx, "a cap");
  } else {
    const over = tooLarge(perTx, "cap");
    if (over) {
      errors.perTx = over;
    } else if (budget !== null && budget > 0n && perTx > budget) {
      errors.perTx = "The per-transaction cap cannot be larger than the period budget.";
    }
  }

  const periodSecs = resolvePeriod(input);
  if (periodSecs === null || periodSecs < BigInt(MIN_CUSTOM_PERIOD_SECS)) {
    errors.period = `Enter a period of at least ${MIN_CUSTOM_PERIOD_SECS} seconds.`;
  }

  const expiryUnix = resolveExpiry(input);
  if (expiryUnix === null || expiryUnix <= input.nowUnix) {
    errors.expiry = "Pick an expiry date in the future.";
  }

  const valid = Object.keys(errors).length === 0;
  return {
    errors,
    policy: valid
      ? {
          period_amount: budget as bigint,
          max_per_tx: perTx as bigint,
          period_duration: periodSecs as bigint,
          expiry: BigInt(expiryUnix as number),
        }
      : undefined,
    periodSecs: periodSecs ?? undefined,
    expiryUnix: expiryUnix ?? undefined,
    budgetBase: budget !== null && budget > 0n && budget <= MAX_AMOUNT_BASE ? budget : undefined,
  };
}

export interface LabelValidation {
  /** The label's UTF-8 length — what the contract counts, not `label.length`. */
  bytes: number;
  error?: string;
}

/**
 * A card label is 1..=32 UTF-8 bytes (`contracts/card/src/label.rs`).
 *
 * The count is taken over the **trimmed** label, because that is what the
 * wizard submits — otherwise trailing spaces could push an otherwise valid
 * name over the limit and the counter would disagree with the transaction.
 */
export function validateLabel(label: string): LabelValidation {
  const trimmed = label.trim();
  const bytes = new TextEncoder().encode(trimmed).length;
  if (trimmed.length === 0) {
    return { bytes, error: "Give the card a name so you can tell it apart later." };
  }
  if (bytes > MAX_LABEL_BYTES) {
    return {
      bytes,
      error: `A name is at most ${MAX_LABEL_BYTES} bytes — this one is ${bytes} bytes. Accented letters and emoji count as several bytes each.`,
    };
  }
  return { bytes };
}

export interface AgentKeyValidation {
  valid: boolean;
  /** The raw 32-byte ed25519 public key the card stores as its signer. */
  signer?: Buffer;
  error?: string;
}

/**
 * The agent's **public** key. The app never generates, sees or stores an
 * agent secret — the owner pastes the public half of a keypair the agent
 * already holds (`mooring keygen` in the CLI produces one).
 */
export function validateAgentKey(key: string): AgentKeyValidation {
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: "Paste your agent's public key." };
  }
  if (!StrKey.isValidEd25519PublicKey(trimmed)) {
    return {
      valid: false,
      error: "That is not a Stellar public key (G…). Contract addresses (C…) and secret keys are not accepted.",
    };
  }
  // `decodeEd25519PublicKey` hands back a plain `Uint8Array`; the generated
  // factory bindings want a `Buffer` (`CreateCardParams.signer`).
  return { valid: true, signer: Buffer.from(StrKey.decodeEd25519PublicKey(trimmed)) };
}

/** A merchant is any Stellar account (`G…`) or contract (`C…`) address. */
export function isMerchantAddress(value: string): boolean {
  return StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value);
}

export interface MerchantListValidation {
  merchants: string[];
  error?: string;
}

/** Normalizes a merchant list: trims, drops invalid entries and duplicates, caps at 32. */
export function validateMerchants(list: readonly string[]): MerchantListValidation {
  const merchants: string[] = [];
  for (const raw of list) {
    const value = raw.trim();
    if (!isMerchantAddress(value) || merchants.includes(value)) continue;
    if (merchants.length >= MAX_MERCHANTS) {
      return { merchants, error: `A card can hold at most ${MAX_MERCHANTS} merchants.` };
    }
    merchants.push(value);
  }
  return { merchants };
}

/**
 * Adds one merchant to the list. Returns the unchanged list plus a message
 * when the candidate is not an address, is already on the list, or would
 * overflow the contract's 32-entry allowlist.
 */
export function addMerchant(list: readonly string[], candidate: string): MerchantListValidation {
  const value = candidate.trim();
  if (!isMerchantAddress(value)) {
    return { merchants: [...list], error: "Enter a Stellar address (G… or C…)." };
  }
  if (list.includes(value)) {
    return { merchants: [...list], error: "That merchant is already on the list." };
  }
  if (list.length >= MAX_MERCHANTS) {
    return { merchants: [...list], error: `A card can hold at most ${MAX_MERCHANTS} merchants.` };
  }
  return { merchants: [...list, value] };
}

/** Everything the wizard collects, as typed. */
export interface WizardDraft {
  label: string;
  budget: string;
  unit: PeriodUnit;
  customSeconds: string;
  perTx: string;
  expiryPreset: ExpiryPreset;
  expiryDate: string;
  agentKey: string;
  merchants: string[];
}

/** A fresh draft: a daily budget expiring in 30 days, nothing filled in. */
export function emptyDraft(): WizardDraft {
  return {
    label: "",
    budget: "",
    unit: "day",
    customSeconds: "",
    perTx: "",
    expiryPreset: "30",
    expiryDate: "",
    agentKey: "",
    merchants: [],
  };
}

/** The policy half of a draft, with the caller's clock. */
export function policyInput(draft: WizardDraft, nowUnix: number): PolicyInput {
  return {
    budget: draft.budget,
    unit: draft.unit,
    customSeconds: draft.customSeconds,
    perTx: draft.perTx,
    expiryPreset: draft.expiryPreset,
    expiryDate: draft.expiryDate,
    nowUnix,
  };
}
