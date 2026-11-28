import type { GuardCaps, GuardConfig } from "./types.js";

const DECIMALS = 7;
const SCALE = 10n ** BigInt(DECIMALS);
const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** Decimal USDC (`"1.5"`) to base units (`"15000000"`). Throws `RangeError`. */
function toBaseUnits(key: string, value: string): string {
  const m = DECIMAL.exec(value);
  if (!m) throw new RangeError(`${key}: "${value}" is not a decimal USDC amount`);
  const frac = m[2] ?? "";
  if (frac.length > DECIMALS) {
    throw new RangeError(`${key}: "${value}" has more than ${DECIMALS} decimals`);
  }
  return (BigInt(m[1]!) * SCALE + BigInt(frac.padEnd(DECIMALS, "0") || "0")).toString();
}

/** Base units (`"10000"`) to decimal USDC (`"0.001"`): trailing zeros trimmed, at least one integer digit. */
export function formatUsdc(baseUnits: string | bigint): string {
  const v = BigInt(baseUnits);
  const sign = v < 0n ? "-" : "";
  const abs = v < 0n ? -v : v;
  const whole = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  return `${sign}${whole}${frac ? `.${frac}` : ""}`;
}

/**
 * Converts caps configured in decimal USDC to base units (7 decimals).
 * Absent keys stay absent; a non-numeric value or more than 7 decimals
 * throws `RangeError`.
 */
export function parseGuardConfig(cfg: GuardConfig): GuardCaps {
  const caps: GuardCaps = {};
  for (const key of ["dailyCap", "totalCap", "maxPerTx"] as const) {
    const value = cfg[key];
    if (value !== undefined) caps[key] = toBaseUnits(key, value);
  }
  return caps;
}

/**
 * Reads `MOORING_DAILY_CAP`, `MOORING_TOTAL_CAP` and `MOORING_MAX_PER_TX`
 * (decimal USDC) into a `GuardConfig`. Unset or empty variables are left out.
 * Pass it to `parseGuardConfig` for the caps.
 */
export function guardCapsFromEnv(env: NodeJS.ProcessEnv): GuardConfig {
  const cfg: GuardConfig = {};
  const read = (name: string) => {
    const v = env[name]?.trim();
    return v ? v : undefined;
  };
  const dailyCap = read("MOORING_DAILY_CAP");
  const totalCap = read("MOORING_TOTAL_CAP");
  const maxPerTx = read("MOORING_MAX_PER_TX");
  if (dailyCap !== undefined) cfg.dailyCap = dailyCap;
  if (totalCap !== undefined) cfg.totalCap = totalCap;
  if (maxPerTx !== undefined) cfg.maxPerTx = maxPerTx;
  return cfg;
}
