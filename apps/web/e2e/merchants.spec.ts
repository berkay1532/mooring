/**
 * Adding a merchant by service URL: the wizard, the card screen, the `/allow`
 * link flow, the "no match" refusal, and the raw-address path that remains.
 *
 * The server-side resolver (`POST /api/resolve-merchant`) is stubbed with
 * `page.route`: the app under test is real, the sellers it would fetch are not.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { connectWallet, expect, test } from "./fixtures/app";
import { AGENT_KEY, CARD_ONE, MERCHANT_1, USDC } from "./fixtures/cards";

const PAY_TO = "GBSVTVRQ4AEFRNGH2MIOOWZSAVLZKOKNKI4UAGSMBZSNRP4I3FL3ELYP";
const SERVICE_URL = "https://demo.rail402.dev/weather";
const NOTICE = /It does not vouch for the service/;

async function stubResolveOk(page: Page, opts: { payTo: string; name: string; url: string }) {
  const url = new URL(opts.url);
  await page.route("**/api/resolve-merchant", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        url: opts.url,
        host: url.host,
        payTo: opts.payTo,
        network: "stellar:testnet",
        asset: USDC,
        amount: "10000",
        scheme: "exact",
        service: { name: opts.name, description: "Current weather for a city" },
      }),
    }),
  );
}

async function stubResolveNoMatch(page: Page) {
  await page.route("**/api/resolve-merchant", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        code: "no_match",
        message: "This service accepts Stellar mainnet USDC; this card holds Stellar testnet USDC.",
        found: [
          {
            network: "stellar:pubnet",
            asset: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
            payTo: "GDK3AVW3YE6UL3J4WLNKBMP65KSY32YPUKIOC6PXW65XJ3LEG3YIDXXB",
            amount: "10000",
          },
        ],
      }),
    }),
  );
}

const RAIL402 = { payTo: PAY_TO, name: "Rail402 demo", url: SERVICE_URL };

/** Opens the "+ Add" resolver on the card screen and looks the demo URL up. */
async function lookUpOnCard(page: Page) {
  await page.getByRole("button", { name: "+ Add" }).click();
  await page.getByLabel("Service URL").fill(SERVICE_URL);
  await page.getByRole("button", { name: "Look up" }).click();
}

test.describe("adding a merchant by URL", () => {
  test("the wizard adds a service by URL and the card lands with its name", async ({ page, rpc }) => {
    await stubResolveOk(page, RAIL402);
    await connectWallet(page);
    await page.getByRole("button", { name: "+ New card" }).click();
    await page.waitForURL("**/cards/new");

    await page.getByLabel("Card name").fill("ops-agent");
    await page.getByLabel("Period budget").fill("50");
    await page.getByLabel("Max per transaction").fill("10");
    await page.getByRole("button", { name: "Continue →" }).click();

    await page.getByLabel("Agent public key").fill(AGENT_KEY);
    await page.getByLabel("Service URL").fill(SERVICE_URL);
    await page.getByRole("button", { name: "Look up" }).click();
    await expect(page.getByText(NOTICE)).toBeVisible();
    await page.getByRole("button", { name: "Add to list" }).click();
    await expect(page.getByRole("list", { name: "Merchants" })).toContainText("Rail402 demo");
    await page.getByRole("button", { name: "Continue →" }).click();

    await expect(page.getByRole("list", { name: "Allowed merchants" })).toContainText("Rail402 demo");
    await page.getByRole("button", { name: "Create with Freighter" }).click();

    await expect(page.getByRole("dialog", { name: "Fund the card" })).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/cards$/);
    await expect.poll(() => rpc.submitted.map((call) => call.fn)).toEqual(["create_card", "add_merchant"]);

    await page.keyboard.press("Escape");
    await expect(page.getByText("Rail402 demo")).toBeVisible();
  });

  test("the card screen allows a service by URL and shows its name", async ({ page, rpc }) => {
    await stubResolveOk(page, RAIL402);
    await connectWallet(page);
    await lookUpOnCard(page);

    await expect(page.getByText(NOTICE)).toBeVisible();
    await page.getByRole("button", { name: "Allow demo.rail402.dev" }).click();

    await expect(page.getByTestId("tx-toast").first()).toHaveAttribute("data-state", "confirmed", {
      timeout: 30_000,
    });
    // The resolver closes on confirmation; what remains is the allowlist row.
    await expect(page.getByRole("group", { name: /^Service / })).toHaveCount(0);
    await expect(page.getByText("Rail402 demo")).toBeVisible();
    await expect(page.getByText("GBSV…ELYP", { exact: true })).toBeVisible();
    expect(rpc.submitted.map(({ contract, fn }) => ({ contract, fn }))).toEqual([
      { contract: CARD_ONE.address, fn: "add_merchant" },
    ]);
  });

  test("/allow resolves the link's service and allows it for the owner", async ({ page, rpc }) => {
    await stubResolveOk(page, RAIL402);
    await connectWallet(page);
    // A full `goto` would drop the mock wallet's in-memory connection, so the
    // link is followed with a client-side navigation, as the app's own links do.
    await page.evaluate((href) => {
      (window as unknown as { next: { router: { push(href: string): void } } }).next.router.push(href);
    }, `/allow?card=${CARD_ONE.address}&url=${encodeURIComponent(SERVICE_URL)}`);
    await page.waitForURL("**/allow?**");

    await expect(page.getByText("This request came from a link. Make sure it is a service your agent is meant to use.")).toBeVisible();
    await expect(page.getByText(NOTICE)).toBeVisible();
    await page.getByRole("button", { name: "Allow demo.rail402.dev" }).click();

    await expect(page.getByText("Merchant allowed.")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: "Open card" })).toHaveAttribute("href", "/cards");
    expect(rpc.submitted.map((call) => call.fn)).toEqual(["add_merchant"]);
  });

  test("a service on another network is refused with no Allow button", async ({ page, rpc }) => {
    await stubResolveNoMatch(page);
    await connectWallet(page);
    await lookUpOnCard(page);

    await expect(
      page.getByText("This service accepts Stellar mainnet USDC; this card holds Stellar testnet USDC."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^Allow / })).toHaveCount(0);
    expect(rpc.submitted).toEqual([]);
  });

  test("Add by address instead still adds a raw address", async ({ page, rpc }) => {
    await connectWallet(page);
    await page.getByRole("button", { name: "+ Add" }).click();
    await page.getByRole("button", { name: "Add by address instead" }).click();
    await page.getByLabel("Merchant address").fill(PAY_TO);
    await page.getByRole("button", { name: "Add", exact: true }).click();

    await expect.poll(() => rpc.submitted.map((call) => call.fn)).toEqual(["add_merchant"]);
    await expect(page.getByText(PAY_TO, { exact: true })).toBeVisible({ timeout: 30_000 });
    expect(MERCHANT_1).not.toBe(PAY_TO);
  });

  test("the resolved preview has no serious or critical accessibility violations", async ({ page }) => {
    await stubResolveOk(page, RAIL402);
    await connectWallet(page);
    await lookUpOnCard(page);
    await expect(page.getByRole("button", { name: "Allow demo.rail402.dev" })).toBeVisible();
    await page.waitForTimeout(1_000);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const blocking = results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ")) }));
    expect(blocking).toEqual([]);
  });
});
