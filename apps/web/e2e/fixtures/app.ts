/**
 * The shared Playwright fixture: a page with the mock Soroban RPC already
 * intercepted, plus the helpers every spec needs to drive the mock wallet.
 *
 * `NEXT_PUBLIC_WALLET=mock` (see `playwright.config.ts`) selects
 * `lib/wallet/mock.ts`, whose `window.__mooringMock` hook is the only way to
 * reach the states a real wallet would otherwise have to produce: no extension
 * installed, or connected to the wrong network.
 */
import { test as base, expect as baseExpect, type Page } from "@playwright/test";

import { RPC_URL } from "./env";
import { installRpcMock, type RpcMock } from "./rpc-mock";

export { installRpcMock } from "./rpc-mock";
export type { RpcMock, RpcMockOptions } from "./rpc-mock";

export type MockWalletMode = "unavailable" | "wrong-network";

export const test = base.extend<{
  /** The mock RPC installed on `page`, with its recorded calls and mutable cards. */
  rpc: RpcMock;
}>({
  // Automatic: the route has to exist before the first navigation, and every
  // spec in this suite runs against the mocked chain. A test that wants to
  // inspect what was called simply names `rpc` in its arguments.
  rpc: [
    async ({ page, baseURL }, use) => {
      const mock = await installRpcMock(page);
      await installNetworkGuard(page, baseURL as string);
      await use(mock);
      // An RPC method the mock does not implement answers -32601, which the
      // SDK turns into a throw — but the app's own error handling can absorb
      // that into a UI state no assertion looks at. Fail the test instead.
      baseExpect(mock.unhandled, "the app called an RPC method the mock does not implement").toEqual([]);
    },
    { auto: true },
  ],
});

/**
 * Aborts anything that is neither the app under test nor the mocked RPC.
 * Nothing in the app reaches a third party today (fonts are self-hosted, QR
 * codes are generated in-process, stellar.expert only ever appears as an
 * `href`); this makes that structural rather than circumstantial — a request
 * that leaks in later fails loudly instead of quietly hitting the network
 * from CI.
 */
async function installNetworkGuard(page: Page, baseURL: string): Promise<void> {
  const allowed = new Set([new URL(baseURL).origin, new URL(RPC_URL).origin]);
  // Registered after the RPC mock, so it runs *first*: an allowed request is
  // handed back with `fallback()` (which is what lets the RPC mock still see
  // its own calls), anything else is aborted.
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    const origin = url.startsWith("http") ? new URL(url).origin : null;
    if (origin === null || allowed.has(origin)) {
      await route.fallback();
      return;
    }
    console.error(`e2e: blocked an unexpected request to ${url}`);
    await route.abort("blockedbyclient");
  });
}

export const expect = test.expect;

/**
 * Forces the mock wallet into `mode` before the page's own scripts run.
 * `lib/wallet/mock.ts` reads `window.__mooringMock.mode` on every adapter
 * call and wires its own `set()` around whatever a test assigned here.
 */
export async function setWalletMode(page: Page, mode: MockWalletMode): Promise<void> {
  await page.addInitScript((value) => {
    (window as unknown as { __mooringMock?: { mode?: string } }).__mooringMock = { mode: value };
  }, mode);
}

/**
 * Goes to the connect screen and connects the mock wallet, landing on
 * `/cards`. The connect screen only renders its button once the adapter has
 * answered `isAvailable()`, so this waits for the button rather than the load
 * event.
 */
export async function connectWallet(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Connect Freighter" }).click();
  await page.waitForURL("**/cards");
}
