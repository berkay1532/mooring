/**
 * The new-card wizard (spec §3.3): the client-side validation that keeps an
 * `InvalidPolicy`/`InvalidLabel` away from a signature, and a full run through
 * to a confirmed `create_card` that lands on the dashboard with the Fund sheet
 * open.
 */
import { connectWallet, expect, test } from "./fixtures/app";
import { AGENT_KEY, cardAddress } from "./fixtures/cards";

test.describe("new-card wizard", () => {
  test.beforeEach(async ({ page }) => {
    await connectWallet(page);
    await page.getByRole("button", { name: "+ New card" }).click();
    await page.waitForURL("**/cards/new");
    await expect(page.getByRole("heading", { name: "New card" })).toBeVisible();
  });

  test("refuses to advance with an empty policy and says why", async ({ page }) => {
    await page.getByRole("button", { name: "Continue →" }).click();

    await expect(page.getByText("Give the card a name so you can tell it apart later.")).toBeVisible();
    await expect(page.getByText("Enter a budget greater than 0.")).toBeVisible();
    await expect(page.getByText("Enter a cap greater than 0.")).toBeVisible();
    // Still on step 1 — the agent-key field belongs to step 2.
    await expect(page.getByLabel("Agent public key")).toHaveCount(0);
  });

  test("rejects a per-transaction cap above the period budget", async ({ page }) => {
    await page.getByLabel("Card name").fill("ops-agent");
    await page.getByLabel("Period budget").fill("50");
    await page.getByLabel("Max per transaction").fill("80");

    await expect(
      page.getByText("The per-transaction cap cannot be larger than the period budget."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Continue →" }).click();
    await expect(page.getByLabel("Agent public key")).toHaveCount(0);
  });

  test("rejects anything that is not a Stellar public key as the agent", async ({ page }) => {
    await page.getByLabel("Card name").fill("ops-agent");
    await page.getByLabel("Period budget").fill("50");
    await page.getByLabel("Max per transaction").fill("10");
    await page.getByRole("button", { name: "Continue →" }).click();

    const agentField = page.getByLabel("Agent public key");
    await expect(agentField).toBeVisible();
    await agentField.fill("not-a-key");

    await expect(page.getByText("That is not a Stellar public key")).toBeVisible();
    await page.getByRole("button", { name: "Continue →" }).click();
    await expect(page.getByText("Summary")).toHaveCount(0);
  });

  test("creates a card and lands on the dashboard with the Fund sheet open", async ({ page, rpc }) => {
    // Step 1 — policy.
    await page.getByLabel("Card name").fill("ops-agent");
    await page.getByLabel("Period budget").fill("50");
    await page.getByLabel("Max per transaction").fill("10");
    await page.getByRole("button", { name: "Continue →" }).click();

    // Step 2 — the agent's public key. No merchants: each one would be its
    // own transaction, and the allowlist has its own coverage.
    await page.getByLabel("Agent public key").fill(AGENT_KEY);
    await expect(page.getByText("Valid key")).toBeVisible();
    await page.getByRole("button", { name: "Continue →" }).click();

    // Step 3 — confirm. The card's address is derived before anything is
    // signed: two cards already exist, so this one deploys at salt 2.
    await expect(page.getByText("Summary")).toBeVisible();
    await expect(page.getByText("50.00 USDC / day · per tx 10.00 USDC")).toBeVisible();
    const expected = cardAddress(2);
    await expect(page.getByText(expected, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Create with Freighter" }).click();

    // The transaction reports on a toast, from before the wallet prompt on.
    const toast = page.getByTestId("tx-toast").first();
    await expect(toast).toContainText("Create card ops-agent");

    const fundSheet = page.getByRole("dialog", { name: "Fund the card" });
    await expect(fundSheet).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/cards$/);
    await expect(fundSheet).toContainText("ops-agent");

    // The toast lives above the routes: it survives the navigation, confirmed.
    await expect(toast).toHaveAttribute("data-state", "confirmed");
    await expect(page.getByTestId("tx-toast")).toHaveCount(1);

    expect(rpc.submitted.map((call) => call.fn)).toEqual(["create_card"]);
    expect(rpc.cards.map((card) => card.label)).toContain("ops-agent");
  });
});
