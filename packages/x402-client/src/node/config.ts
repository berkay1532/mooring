import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { guardCapsFromEnv, parseGuardConfig } from "../guard/config.js";
import type { GuardConfig } from "../guard/types.js";

const KEYS = ["dailyCap", "totalCap", "maxPerTx"] as const;

/** Where the guard state, stop file and receipt ledger live: `$MOORING_HOME`, else `~/.mooring`. */
export function defaultStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.MOORING_HOME ?? path.join(os.homedir(), ".mooring");
}

/**
 * The local caps in decimal USDC: `mooring.guard.json` in `cwd` (keys
 * `dailyCap`, `totalCap`, `maxPerTx`, each an optional decimal string)
 * over `MOORING_DAILY_CAP` / `MOORING_TOTAL_CAP` / `MOORING_MAX_PER_TX`,
 * key by key. A malformed file throws an `Error` naming its path.
 */
export function loadGuardConfig(cwd: string, env: NodeJS.ProcessEnv = process.env): GuardConfig {
  const fromEnv = guardCapsFromEnv(env);
  const file = path.join(cwd, "mooring.guard.json");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fromEnv;
    throw new Error(`${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`${file}: not valid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${file}: expected an object with dailyCap, totalCap and/or maxPerTx`);
  }
  const fromFile: GuardConfig = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!(KEYS as readonly string[]).includes(key)) {
      throw new Error(`${file}: unknown key "${key}" (expected ${KEYS.join(", ")})`);
    }
    if (typeof value !== "string") {
      throw new Error(`${file}: ${key} must be a decimal USDC string such as "1.5"`);
    }
    fromFile[key as (typeof KEYS)[number]] = value;
  }
  try {
    parseGuardConfig(fromFile);
  } catch (err) {
    throw new Error(`${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { ...fromEnv, ...fromFile };
}
