/**
 * The merchant directory (flow 3): "Browse services" under the URL field in
 * the wizard and on the card screen. `GET /api/directory` is stubbed with the
 * canned catalogue from `fixtures/directory.ts`; the resolver that re-checks a
 * picked service is stubbed the same way `merchants.spec.ts` does.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { connectWallet, expect, test } from "./fixtures/app";
import { AGENT_KEY, CARD_ONE, USDC } from "./fixtures/cards";
import { DIRECTORY_PAY_TO, DIRECTORY_URL, stubDirectory } from "./fixtures/directory";

const NOTICE = /It does not vouch for the service/;

async function stubResolveOk(page: Page) {
  await page.route("**/api/resolve-merchant", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        url: DIRECTORY_URL,
        payTo: DIRECTORY_PAY_TO,
        network: "stellar:testnet",
        asset: USDC,
        amount: "10000",
        scheme: "exact",
        service: { name: "Rail402 demo", description: "Current weather for a city" },
      }),
    }),
  );
}

async function confirmInModal(page: Page, primary: string) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(NOTICE)).toBeVisible();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: primary }).click();
  await expect(dialog).toHaveCount(0);
}

test.describe("merchant directory", () => {
  test("the wizard lists services, filters them, and adds one through the live check and the modal", async ({ page }) => {
    await stubResolveOk(page);
    await connectWallet(page);
    await page.getByRole("button", { name: "+ New card" }).click();
    await page.waitForURL("**/cards/new");
    await page.getByLabel("Card name").fill("ops-agent");
    await page.getByLabel("Period budget").fill("50");
    await page.getByLabel("Max per transaction").fill("10");
    await page.getByRole("button", { name: "Continue →" }).click();
    await page.getByLabel("Agent public key").fill(AGENT_KEY);

    const list = page.getByRole("list", { name: "Services" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list).toContainText("Pet Pen Portraits");
    await expect(list).toContainText("0.25 USDC / request");
    await expect(list).toContainText("verified by source · 75 payments");
    await expect(page.getByText("Listed, not vetted. Examples, not recommendations.")).toBeVisible();
    // The mainnet section is there, collapsed, and offers nothing to add.
    const other = page.getByText("On Stellar mainnet · 448 services (not payable from this card)");
    await expect(other).toBeVisible();
    await expect(page.getByRole("list", { name: "Services on Stellar mainnet" })).toBeHidden();

    await page.getByLabel("Search services").fill("weather");
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await page.getByRole("button", { name: "Add Rail402 demo" }).click();

    await expect(page.getByLabel("Service URL")).toHaveValue(DIRECTORY_URL);
    await expect(page.getByText(NOTICE)).toBeVisible();
    await page.getByRole("button", { name: "Add to list" }).click();
    await confirmInModal(page, "Add to list");

    await expect(page.getByRole("list", { name: "Merchants" })).toContainText("Rail402 demo");
    // Back on the list, the payee now reads Allowed.
    await expect(page.getByLabel("Service URL")).toHaveValue("");
    await page.getByLabel("Search services").fill("");
    await expect(page.getByRole("list", { name: "Services" })).toContainText("Allowed");
  });

  test("the card screen allows a directory service and signs add_merchant", async ({ page, rpc }) => {
    await stubResolveOk(page);
    await connectWallet(page);
    await page.getByRole("button", { name: "+ Add" }).click();
    await page.getByRole("button", { name: "Add Rail402 demo" }).click();
    await page.getByRole("button", { name: "Allow demo.rail402.dev" }).click();
    await confirmInModal(page, "Allow and sign");

    await expect(page.getByTestId("tx-toast").first()).toHaveAttribute("data-state", "confirmed", { timeout: 30_000 });
    await expect(page.getByText("Rail402 demo")).toBeVisible();
    expect(rpc.submitted.map(({ contract, fn }) => ({ contract, fn }))).toEqual([{ contract: CARD_ONE.address, fn: "add_merchant" }]);
  });

  test("an unavailable directory still leaves the URL field usable", async ({ page }) => {
    await stubDirectory(page, { error: "down" }, 503);
    await connectWallet(page);
    await page.getByRole("button", { name: "+ Add" }).click();
    await expect(page.getByText(/The directory is unavailable right now/)).toBeVisible();
    await expect(page.getByLabel("Service URL")).toBeEditable();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("the browse panel has no accessibility violations", async ({ page }) => {
    await connectWallet(page);
    await page.getByRole("button", { name: "+ Add" }).click();
    await expect(page.getByRole("list", { name: "Services" })).toBeVisible();
    const results = await new AxeBuilder({ page }).include('[data-testid="browse-services"]').analyze();
    expect(results.violations).toEqual([]);
  });
});
