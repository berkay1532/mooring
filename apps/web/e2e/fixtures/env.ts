/**
 * The app's public configuration, read from `apps/web/.env.example`.
 *
 * Both the Playwright `webServer` (which builds the app with these values) and
 * the RPC mock (which has to answer for exactly the factory and SAC the built
 * app asks about) read it from the same place, so the two can never drift
 * apart the way two hard-coded copies would.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** `KEY=value` / `KEY="value with spaces"`, ignoring blanks and `#` comments. */
function parseDotenv(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function locateEnvExample(): string {
  const candidates = [
    path.resolve(process.cwd(), ".env.example"),
    path.resolve(process.cwd(), "apps/web/.env.example"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `Could not find apps/web/.env.example (looked in ${candidates.join(", ")}). ` +
        "Run the e2e suite from the apps/web workspace: npm run e2e -w @mooring/web",
    );
  }
  return found;
}

const parsed = parseDotenv(readFileSync(locateEnvExample(), "utf8"));

/**
 * The environment the app under test is built and served with: `.env.example`
 * plus the mock wallet, so no browser extension is involved.
 */
export const appEnv: Record<string, string> = {
  ...parsed,
  NEXT_PUBLIC_WALLET: "mock",
};

function required(name: string): string {
  const value = appEnv[name];
  if (!value) throw new Error(`apps/web/.env.example is missing ${name}`);
  return value;
}

export const RPC_URL = required("NEXT_PUBLIC_RPC_URL");
export const NETWORK_PASSPHRASE = required("NEXT_PUBLIC_NETWORK_PASSPHRASE");
export const FACTORY = required("NEXT_PUBLIC_FACTORY_ADDRESS");
export const USDC = required("NEXT_PUBLIC_USDC_SAC");
