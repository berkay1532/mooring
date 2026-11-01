export type StellarNetwork = "stellar:testnet" | "stellar:pubnet";

/**
 * Every read below must spell `process.env.NEXT_PUBLIC_…` out in full.
 * Next.js inlines a public variable by textually substituting that exact
 * expression at build time; a dynamic lookup (`process.env[name]`) is left
 * as-is and reads an empty object in the browser bundle, so the whole app
 * would throw "Missing NEXT_PUBLIC_…" on load in a production build while
 * working perfectly in `next dev`. The name is therefore passed alongside
 * the value, only so the error message can still say which one is missing.
 *
 * Two guards keep it that way: `test/unit/config.test.ts` asserts on this
 * file's source text (under vitest both forms behave identically, so no
 * behavioural test can catch the regression), and the Playwright suite builds
 * and serves the app for real, which is how the bug was found in the first
 * place.
 */
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name} — copy apps/web/.env.example to .env.local`);
  return value;
}

/** Validates a 32-byte hex hash and normalizes it to lowercase. */
function wasmHash(value: string): string {
  const hex = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error("NEXT_PUBLIC_CARD_WASM_HASH must be 64 hex characters");
  }
  return hex;
}

/** True outside a production build (`next dev`, vitest). */
export const isDev = process.env.NODE_ENV !== "production";

export const config = {
  network: required(
    "NEXT_PUBLIC_STELLAR_NETWORK",
    process.env.NEXT_PUBLIC_STELLAR_NETWORK,
  ) as StellarNetwork,
  rpcUrl: required("NEXT_PUBLIC_RPC_URL", process.env.NEXT_PUBLIC_RPC_URL),
  networkPassphrase: required(
    "NEXT_PUBLIC_NETWORK_PASSPHRASE",
    process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE,
  ),
  factory: required("NEXT_PUBLIC_FACTORY_ADDRESS", process.env.NEXT_PUBLIC_FACTORY_ADDRESS),
  usdc: required("NEXT_PUBLIC_USDC_SAC", process.env.NEXT_PUBLIC_USDC_SAC),
  /**
   * The hex WASM hash of the Mooring card contract. A contract is treated as
   * a card (its `info()` trusted, owner actions offered) only when its
   * instance runs exactly this code — see `lib/chain/verify.ts`.
   */
  cardWasmHash: wasmHash(
    required("NEXT_PUBLIC_CARD_WASM_HASH", process.env.NEXT_PUBLIC_CARD_WASM_HASH),
  ),
  docsUrl:
    process.env.NEXT_PUBLIC_DOCS_URL ??
    "https://github.com/berkay1532/mooring/blob/main/docs/x402-integration.md",
  walletMode: (process.env.NEXT_PUBLIC_WALLET ?? "freighter") as "freighter" | "mock",
} as const;
