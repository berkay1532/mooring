/**
 * The connect screen (spec §3.1): the three states a visitor can land in
 * before the dashboard will render anything.
 */
import { connectWallet, expect, setWalletMode, test } from "./fixtures/app";

test.describe("connect screen", () => {
  test("offers an install link when no wallet is available", async ({ page, rpc }) => {
    await setWalletMode(page, "unavailable");
    await page.goto("/");

    const install = page.getByRole("link", { name: "Install Freighter" });
    await expect(install).toBeVisible();
    await expect(install).toHaveAttribute("href", "https://www.freighter.app/");
    await expect(page.getByRole("button", { name: "Connect Freighter" })).toHaveCount(0);
    // Nothing is read from the chain before a wallet is connected.
    expect(rpc.calls).toEqual([]);
  });

  test("blocks with a notice when the wallet is on the wrong network", async ({ page }) => {
    await setWalletMode(page, "wrong-network");
    await page.goto("/");

    await page.getByRole("button", { name: "Connect Freighter" }).click();

    const notice = page.getByRole("status");
    await expect(notice).toContainText("Wrong network");
    await expect(notice).toContainText("Testnet");
    // The guard must not let the dashboard through.
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "My cards" })).toHaveCount(0);
  });

  test("connects and lands on the cards dashboard", async ({ page, rpc }) => {
    await connectWallet(page);

    await expect(page.getByRole("heading", { name: "My cards" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Your cards" })).toBeVisible();
    expect(rpc.calls).toContain("getLedgerEntries");
  });

  test("the guard shows the connect screen on a deep link into /cards", async ({ page }) => {
    await page.goto("/cards");

    await expect(page.getByRole("button", { name: "Connect Freighter" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "My cards" })).toHaveCount(0);
  });
});
