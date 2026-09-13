import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    // Scoped to the unit suite so vitest never picks up `e2e/*.spec.ts`,
    // which are Playwright tests and must only run under `npm run e2e`.
    include: ["test/unit/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    // `lib/config.ts` throws at import time if any NEXT_PUBLIC_* var is
    // missing. These are the same public, non-secret testnet values from
    // `.env.example`; per-file suites that need to test the "missing"
    // path (e.g. config.test.ts, card.test.ts) delete/override them.
    env: {
      NEXT_PUBLIC_STELLAR_NETWORK: "stellar:testnet",
      NEXT_PUBLIC_RPC_URL: "https://soroban-testnet.stellar.org",
      NEXT_PUBLIC_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
      NEXT_PUBLIC_FACTORY_ADDRESS: "CBMSK4OSNLBEXTJWNEWX422RPVDEUNFEWADTSPECGBI26ESDYW65AUSE",
      NEXT_PUBLIC_USDC_SAC: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      NEXT_PUBLIC_WALLET: "freighter",
    },
  },
});
