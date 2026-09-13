/**
 * The cards dashboard (spec §3.2 / §3.4): the 3D carousel and its keyboard
 * selection, the list view, and a full owner write (freeze) driven end to end
 * through the mocked RPC — plus the narrow-viewport and reduced-motion
 * behaviours the design spec promises.
 */
import type { Page } from "@playwright/test";

import { connectWallet, expect, test } from "./fixtures/app";
import { CARD_ONE, CARD_TWO } from "./fixtures/cards";

/** The card face that is currently front and centre in the carousel. */
function selectedFace(page: Page) {
  return page.locator('[data-size="carousel"][data-selected="true"]');
}

test.describe("cards dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await connectWallet(page);
  });

  test("shows both of the owner's cards in the carousel", async ({ page }) => {
    await expect(page.getByRole("group", { name: `${CARD_ONE.label} card, active` })).toBeVisible();
    await expect(page.getByRole("group", { name: `${CARD_TWO.label} card, frozen` })).toBeVisible();
    await expect(page.getByText("2 cards · total")).toBeVisible();

    // The first card opens selected, with its details panel below the stage.
    await expect(selectedFace(page)).toHaveAttribute("aria-label", `${CARD_ONE.label} card, active`);
    await expect(page.getByRole("heading", { name: CARD_ONE.label })).toBeVisible();
  });

  test("ArrowRight in the stage selects the second card", async ({ page }) => {
    const stage = page.getByRole("region", { name: "Your cards" });
    await stage.focus();
    await stage.press("ArrowRight");

    await expect(selectedFace(page)).toHaveAttribute("aria-label", `${CARD_TWO.label} card, frozen`);
    await expect(page.getByRole("heading", { name: CARD_TWO.label })).toBeVisible();
  });

  test("the list toggle shows one row per card", async ({ page }) => {
    await page.getByRole("radio", { name: "List" }).click();

    const rows = page.locator("tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText(CARD_ONE.label);
    await expect(rows.nth(1)).toContainText(CARD_TWO.label);
    await expect(page.getByRole("region", { name: "Your cards" })).toHaveCount(0);
  });

  test("freezing a card runs the timeline through to Confirmed", async ({ page, rpc }) => {
    await page.getByRole("button", { name: "Freeze", exact: true }).click();

    const tx = page.locator('[role="status"][data-state]').first();
    await expect(tx).toBeVisible();
    await expect(tx).toHaveAttribute("data-state", "confirmed", { timeout: 30_000 });
    await expect(tx).toContainText("Confirmed");

    // Every step of the timeline is done, not just the headline.
    await expect(tx.locator("li[data-step]")).toHaveCount(4);
    await expect(tx.locator('li[data-step-status="done"]')).toHaveCount(4);

    // The write really went through the RPC, and the card reads frozen after.
    expect(rpc.submitted.map((call) => call.fn)).toContain("freeze");
    await expect(page.getByRole("button", { name: "Unfreeze" })).toBeVisible();
  });

  test("stays free of horizontal scroll at 400px", async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 900 });
    await expect(page.getByRole("heading", { name: "My cards" })).toBeVisible();
    await expect(page.getByRole("group", { name: `${CARD_ONE.label} card, active` })).toBeVisible();

    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
  });

  test("tilts the selected card toward the viewer when motion is allowed", async ({ page }) => {
    const selected = page.locator('[data-slide-offset="0"]');
    await expect(selected).toBeVisible();
    // `translateZ(60px)` — the stage's perspective renders it as a matrix3d.
    await expect(selected).toHaveCSS("transform", /matrix3d/);
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("drops the carousel's 3D transforms", async ({ page }) => {
    await connectWallet(page);

    // The selected slide is flat — no translateZ toward the viewer.
    const selected = page.locator('[data-slide-offset="0"]');
    await expect(selected).toBeVisible();
    await expect(selected).toHaveCSS("transform", "none");
    expect(await selected.getAttribute("style")).not.toContain("transform");

    // Neighbours are not rotated away in perspective — they are not rendered
    // at all; the list view is the accessible alternative.
    await expect(page.locator('[data-slide-offset="1"]')).toBeHidden();
  });
});
