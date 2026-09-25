import { StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import {
  MAX_AMOUNT_USDC,
  MAX_LABEL_BYTES,
  MAX_MERCHANTS,
  addMerchant,
  validateAgentKey,
  validateLabel,
  validateMerchants,
  validatePolicy,
  type PolicyInput,
} from "../../lib/wizard/validate";

const NOW = 1_800_000_000; // 2027-01-15T08:00:00Z — fixed, so nothing depends on the real clock
const BASE = 10_000_000n;
const DAY = 86_400;

const AGENT = "GDHDJL3RT6S3OABSHLOEOCBH4BMMAKLVOR5FPEHXG5ZW2DDJDRRJJSM7";
const MERCHANT_G = "GAIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCF6M";
const MERCHANT_C = "CAZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGGJH";

function input(over: Partial<PolicyInput> = {}): PolicyInput {
  return {
    budget: "50",
    unit: "day",
    customSeconds: "3600",
    perTx: "10",
    expiryPreset: "30",
    expiryDate: "",
    nowUnix: NOW,
    ...over,
  };
}

describe("validatePolicy", () => {
  it("builds a Policy from a valid input", () => {
    const { errors, policy } = validatePolicy(input());
    expect(errors).toEqual({});
    expect(policy).toEqual({
      period_amount: 50n * BASE,
      max_per_tx: 10n * BASE,
      period_duration: 86_400n,
      expiry: BigInt(NOW + 30 * DAY),
    });
  });

  it("rejects a per-transaction cap larger than the period budget", () => {
    const { errors, policy } = validatePolicy(input({ perTx: "60" }));
    expect(errors.perTx).toMatch(/larger than the period budget/i);
    expect(policy).toBeUndefined();
  });

  it("rejects a zero, negative or unparseable budget", () => {
    expect(validatePolicy(input({ budget: "0" })).errors.budget).toMatch(/greater than 0/i);
    expect(validatePolicy(input({ budget: "-5" })).errors.budget).toBeDefined();
    expect(validatePolicy(input({ budget: "abc" })).errors.budget).toBeDefined();
    expect(validatePolicy(input({ budget: "" })).errors.budget).toBeDefined();
  });

  it("rejects more than 7 decimal places", () => {
    expect(validatePolicy(input({ budget: "1.12345678" })).errors.budget).toMatch(/7 decimal/i);
    expect(validatePolicy(input({ perTx: "0.00000001" })).errors.perTx).toMatch(/7 decimal/i);
  });

  it("refuses an amount beyond the app's supported range", () => {
    const over = (MAX_AMOUNT_USDC + 1n).toString();
    expect(validatePolicy(input({ budget: over })).errors.budget).toMatch(/larger than this app supports/i);
    expect(validatePolicy(input({ budget: over, perTx: over })).errors.perTx).toMatch(
      /larger than this app supports/i,
    );
    // The ceiling itself is still accepted.
    expect(validatePolicy(input({ budget: MAX_AMOUNT_USDC.toString() })).errors.budget).toBeUndefined();
  });

  it("rejects a per-transaction cap of zero", () => {
    expect(validatePolicy(input({ perTx: "0" })).errors.perTx).toMatch(/greater than 0/i);
  });

  it("maps the period unit onto period_duration", () => {
    expect(validatePolicy(input({ unit: "hour" })).policy?.period_duration).toBe(3_600n);
    expect(validatePolicy(input({ unit: "week" })).policy?.period_duration).toBe(604_800n);
    expect(validatePolicy(input({ unit: "custom", customSeconds: "900" })).policy?.period_duration).toBe(900n);
  });

  it("requires a custom period of at least 60 seconds", () => {
    expect(validatePolicy(input({ unit: "custom", customSeconds: "59" })).errors.period).toMatch(/60/);
    expect(validatePolicy(input({ unit: "custom", customSeconds: "0" })).errors.period).toMatch(/60/);
    expect(validatePolicy(input({ unit: "custom", customSeconds: "12.5" })).errors.period).toBeDefined();
    expect(validatePolicy(input({ unit: "custom", customSeconds: "" })).errors.period).toBeDefined();
  });

  it("turns the 7 / 30 / 90 day presets into unix seconds", () => {
    expect(validatePolicy(input({ expiryPreset: "7" })).policy?.expiry).toBe(BigInt(NOW + 7 * DAY));
    expect(validatePolicy(input({ expiryPreset: "90" })).policy?.expiry).toBe(BigInt(NOW + 90 * DAY));
  });

  it("accepts a future date and rejects a past one", () => {
    const future = new Date((NOW + 45 * DAY) * 1000);
    const iso = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(
      future.getDate(),
    ).padStart(2, "0")}`;
    const ok = validatePolicy(input({ expiryPreset: "date", expiryDate: iso }));
    expect(ok.errors.expiry).toBeUndefined();
    expect(Number(ok.policy?.expiry)).toBeGreaterThan(NOW);

    const past = validatePolicy(input({ expiryPreset: "date", expiryDate: "2020-01-01" }));
    expect(past.errors.expiry).toMatch(/future/i);
    expect(past.policy).toBeUndefined();

    expect(validatePolicy(input({ expiryPreset: "date", expiryDate: "" })).errors.expiry).toBeDefined();
  });

  it("reports every bad field at once and withholds the policy", () => {
    const { errors, policy } = validatePolicy(input({ budget: "0", perTx: "", expiryPreset: "date", expiryDate: "" }));
    expect(Object.keys(errors).sort()).toEqual(["budget", "expiry", "perTx"]);
    expect(policy).toBeUndefined();
  });
});

describe("validateLabel", () => {
  it("counts UTF-8 bytes, not characters", () => {
    expect(validateLabel("çç").bytes).toBe(4);
    expect(validateLabel("agent").bytes).toBe(5);
    expect(validateLabel("🙂").bytes).toBe(4);
  });

  it("counts the trimmed label, since that is what is submitted", () => {
    expect(validateLabel("  agent  ").bytes).toBe(5);
    expect(validateLabel(`${"a".repeat(MAX_LABEL_BYTES)}   `).error).toBeUndefined();
  });

  it("rejects an empty label", () => {
    expect(validateLabel("").error).toMatch(/name/i);
    expect(validateLabel("   ").error).toBeDefined();
  });

  it("accepts exactly 32 bytes and rejects 33, naming the byte count", () => {
    expect(validateLabel("a".repeat(MAX_LABEL_BYTES)).error).toBeUndefined();
    expect(validateLabel("a".repeat(33)).error).toMatch(/33 bytes/);
    // 17 two-byte characters = 34 bytes, but only 17 JS characters.
    const multibyte = "ç".repeat(17);
    expect(multibyte.length).toBe(17);
    expect(validateLabel(multibyte).bytes).toBe(34);
    expect(validateLabel(multibyte).error).toMatch(/34 bytes/);
  });
});

describe("validateAgentKey", () => {
  it("accepts a G… ed25519 public key and returns the raw 32 bytes", () => {
    const { valid, signer, error } = validateAgentKey(AGENT);
    expect(valid).toBe(true);
    expect(error).toBeUndefined();
    expect(signer).toHaveLength(32);
    expect(StrKey.encodeEd25519PublicKey(Buffer.from(signer as Uint8Array))).toBe(AGENT);
  });

  it("rejects a contract address, a secret key and junk", () => {
    expect(validateAgentKey(MERCHANT_C).valid).toBe(false);
    expect(validateAgentKey(MERCHANT_C).error).toMatch(/G…/);
    expect(validateAgentKey("SABC").valid).toBe(false);
    expect(validateAgentKey("").valid).toBe(false);
  });

  it("tolerates surrounding whitespace", () => {
    expect(validateAgentKey(`  ${AGENT}\n`).valid).toBe(true);
  });
});

describe("merchants", () => {
  it("adds a G… or C… address", () => {
    expect(addMerchant([], MERCHANT_G).merchants).toEqual([MERCHANT_G]);
    expect(addMerchant([], MERCHANT_C).merchants).toEqual([MERCHANT_C]);
  });

  it("deduplicates rather than adding the same merchant twice", () => {
    const first = addMerchant([], MERCHANT_G);
    const second = addMerchant(first.merchants, ` ${MERCHANT_G} `);
    expect(second.merchants).toEqual([MERCHANT_G]);
    expect(second.error).toMatch(/already/i);
  });

  it("rejects an address that is neither a G… nor a C… strkey", () => {
    const { merchants, error } = addMerchant([], "not-an-address");
    expect(merchants).toEqual([]);
    expect(error).toMatch(/G… or C…/);
  });

  it("caps the list at 32", () => {
    const full = Array.from({ length: MAX_MERCHANTS }, () => MERCHANT_G);
    const { error } = addMerchant(full, MERCHANT_C);
    expect(error).toMatch(/32/);
  });

  it("validateMerchants filters duplicates and invalid entries and caps the list", () => {
    expect(validateMerchants([MERCHANT_G, MERCHANT_G, "junk", MERCHANT_C]).merchants).toEqual([
      MERCHANT_G,
      MERCHANT_C,
    ]);
    expect(validateMerchants([]).merchants).toEqual([]);
    expect(validateMerchants([]).error).toBeUndefined();
  });
});
