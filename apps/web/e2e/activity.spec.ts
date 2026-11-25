/**
 * The indexer-backed card screen: discovery through `GET /api/cards`, the
 * activity feed with paging, and a verified merchant name from the indexer.
 * The routes are stubbed (`fixtures/indexer.ts`); the chain is the usual mock.
 */
import AxeBuilder from "@axe-core/playwright";
import { connectWallet, expect, test } from "./fixtures/app";
import { CARD_ONE, MERCHANT_1, OWNER } from "./fixtures/cards";
import { PAYMENT_TX, stubIndexerOn } from "./fixtures/indexer";

test.describe("activity feed (indexer)", () => {
  test("lists payments and owner actions, pages with Load more, links to the explorer", async ({ page }) => {
    await stubIndexerOn(page, OWNER, [CARD_ONE.address]);
    await connectWallet(page);

    const feed = page.getByTestId("activity-section");
    await expect(feed).toBeVisible();
    const items = feed.getByRole("list", { name: "Activity items" }).getByRole("listitem");
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText("Paid 0.001 USDC to demo.rail402.dev");
    await expect(items.first().getByRole("link", { name: `tx ${PAYMENT_TX.slice(0, 8)}` })).toHaveAttribute(
      "href",
      new RegExp(PAYMENT_TX),
    );
    await expect(items.nth(1)).toContainText("Merchant added GBSV…ELYP");

    await feed.getByRole("button", { name: "Load more" }).click();
    await expect(items).toHaveCount(3);
    await expect(items.nth(2)).toContainText("Card created");
    await expect(feed.getByRole("button", { name: "Load more" })).toHaveCount(0);
  });

  test("merchant names come from the indexer when this device has none", async ({ page }) => {
    await stubIndexerOn(page, OWNER, [CARD_ONE.address], MERCHANT_1);
    await connectWallet(page);
    await expect(page.getByText(/Merchants · 1 \/ 32/)).toBeVisible();
    await expect(page.getByText("demo.rail402.dev").first()).toBeVisible();
  });

  test("without an indexer the feed says so and the rest of the screen works", async ({ page }) => {
    await connectWallet(page);
    await expect(page.getByTestId("activity-section")).toContainText("not available on this deployment");
    await expect(page.getByText(/Merchants · 1 \/ 32/)).toBeVisible();
  });

  test("the activity section has no accessibility violations", async ({ page }) => {
    await stubIndexerOn(page, OWNER, [CARD_ONE.address]);
    await connectWallet(page);
    await expect(page.getByTestId("activity-section")).toBeVisible();
    const results = await new AxeBuilder({ page }).include('[data-testid="activity-section"]').analyze();
    expect(results.violations).toEqual([]);
  });
});
