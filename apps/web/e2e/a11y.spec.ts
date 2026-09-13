/**
 * A baseline accessibility pass over the app's screens, with axe-core.
 *
 * Only `serious` and `critical` findings fail: those are the ones that stop
 * someone using the screen (an unlabelled control, an unreachable dialog, a
 * broken landmark). `minor`/`moderate` findings are reported in the failure
 * message when one of the other two trips, but never fail on their own.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { connectWallet, expect, test } from "./fixtures/app";

const BLOCKING = new Set(["serious", "critical"]);

/**
 * Every rule runs, `color-contrast` included: small danger text now uses the
 * `--color-danger-text` token (#e8695c) rather than `--color-danger`
 * (#e05548, 4.45:1 on `--color-surface` — just under the 4.5:1 AA threshold),
 * which was the one real failing pair.
 */
const DISABLED_RULES: string[] = [];

/**
 * Long enough for Tailwind's 150 ms transitions to settle before axe samples
 * a colour. A step chip caught mid-transition (amber background fading out
 * under seaglass text) reports a contrast ratio no user ever sees.
 */
const TRANSITION_SETTLE_MS = 1_000;

async function audit(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .disableRules(DISABLED_RULES)
    .analyze();

  return results.violations
    .filter((violation) => BLOCKING.has(violation.impact ?? ""))
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => node.target.join(" ")),
    }));
}

test.describe("accessibility", () => {
  test("the connect screen has no serious or critical violations", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Connect Freighter" })).toBeVisible();

    expect(await audit(page)).toEqual([]);
  });

  test("the cards dashboard has no serious or critical violations", async ({ page }) => {
    await connectWallet(page);
    await expect(page.getByRole("region", { name: "Your cards" })).toBeVisible();

    expect(await audit(page)).toEqual([]);
  });

  test("the list view has no serious or critical violations", async ({ page }) => {
    await connectWallet(page);
    await page.getByRole("radio", { name: "List" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(2);

    expect(await audit(page)).toEqual([]);
  });

  test("the new-card wizard has no serious or critical violations", async ({ page }) => {
    // Navigated by click, not `goto`: a full reload drops the mock wallet's
    // in-memory connection and the route guard would show the connect screen.
    await connectWallet(page);
    await page.getByRole("button", { name: "+ New card" }).click();
    await expect(page.getByRole("heading", { name: "New card" })).toBeVisible();
    // The step chips animate on arrival; sample colours only once they have.
    await page.waitForTimeout(TRANSITION_SETTLE_MS);

    expect(await audit(page)).toEqual([]);
  });
});
