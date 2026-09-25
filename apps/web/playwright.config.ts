import { defineConfig, devices } from "@playwright/test";

import { appEnv } from "./e2e/fixtures/env";

/**
 * End-to-end configuration for the Mooring web app.
 *
 * The app is built and served exactly as it ships, with `apps/web/.env.example`
 * (the public testnet values) plus `NEXT_PUBLIC_WALLET=mock`, so no browser
 * extension is needed. Nothing here touches the network: every Soroban RPC
 * call is answered by the route-intercepting mock in `e2e/fixtures/rpc-mock.ts`.
 */
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { open: "never", outputFolder: "./playwright-report" }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    command: `npm run build:web && npm run start -- --port ${PORT} --hostname 127.0.0.1`,
    url: BASE_URL,
    env: appEnv,
    // Locally a server already listening on this (non-default) port is
    // reused, which keeps an edit-run loop fast; CI always builds and serves
    // its own, so a run can never be answered by a stale tree.
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
