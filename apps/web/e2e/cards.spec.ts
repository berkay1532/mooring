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

  test("freezing a card reports its progress on a toast through to Confirmed", async ({ page, rpc }) => {
    await page.getByRole("button", { name: "Freeze", exact: true }).click();

    const toast = page.getByTestId("tx-toast").first();
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(`Freeze ${CARD_ONE.label}`);
    await expect(toast).toHaveAttribute("data-state", "confirmed", { timeout: 30_000 });
    await expect(toast).toContainText("Confirmed");

    // Every step of the progress is done, not just the headline.
    await expect(toast.locator("li[data-step]")).toHaveCount(4);
    await expect(toast.locator('li[data-step-status="done"]')).toHaveCount(4);

    // The write really went through the RPC — on this card, exactly once —
    // and the toast carries its hash and explorer link.
    expect(rpc.submitted.map(({ contract, fn }) => ({ contract, fn }))).toEqual([
      { contract: CARD_ONE.address, fn: "freeze" },
    ]);
    const { hash } = rpc.submitted[0];
    await expect(toast).toContainText(`${hash.slice(0, 8)}…${hash.slice(-8)}`);
    await expect(toast.getByRole("link", { name: /view transaction/i })).toHaveAttribute(
      "href",
      new RegExp(`${hash}$`),
    );

    // The §7 details are one toggle away.
    await toast.getByRole("button", { name: /details/i }).click();
    await expect(toast.getByTestId("tx-details")).toContainText("freeze");

    // The panel itself shows no inline transaction box, and the card reads frozen after.
    await expect(page.getByRole("region", { name: `${CARD_ONE.label} details` }).locator("[data-state]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Unfreeze" })).toBeVisible();

    // One toast per action: no separate "Card frozen" notice alongside it.
    await expect(page.getByTestId("tx-toast")).toHaveCount(1);
    await expect(page.getByText("Card frozen")).toHaveCount(0);
  });

  test("renders in the brand fonts, not the system fallback", async ({ page }) => {
    // The design tokens (`--font-display/body/mono`) only resolve to the
    // `next/font` faces when the font variables are set on <html>, where
    // `@theme` reads them; otherwise everything falls back to the system
    // sans. (Depending on the Next version the face is named "Instrument
    // Serif" or "__Instrument_Serif_<hash>".)
    const face = selectedFace(page);
    const family = (locator: ReturnType<Page["locator"]>) =>
      locator.evaluate((el) => getComputedStyle(el).fontFamily);

    expect(await family(face.getByText("MOORING", { exact: true }))).toMatch(/Instrument[ _]Serif/);
    expect(await family(page.locator("body"))).toMatch(/^"?_*Manrope/);
    expect(await family(face.getByTestId("budget-expiry"))).toMatch(/IBM[ _]Plex[ _]Mono/);
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
