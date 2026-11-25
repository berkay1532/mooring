/**
 * Canned answers for the indexer routes (`/api/cards*`). By default the suite
 * stubs them as "no database" (503) so every existing flow keeps using the
 * on-chain probe and local storage; `activity.spec.ts` layers real bodies on top.
 */
import type { Page } from "@playwright/test";

export const PAYMENT_TX = "e343161a4264c407bf1556d32080b54195fe4eb978c55478f9ca18b5da0f3be0";

export function activityBody(card: string, opts: { nextCursor?: string | null; page?: 1 | 2 } = {}) {
  const page = opts.page ?? 1;
  const items =
    page === 1
      ? [
          {
            id: "p1",
            kind: "payment",
            ledger: 5904134,
            txHash: PAYMENT_TX,
            ts: new Date(Date.now() - 2 * 3600_000).toISOString(),
            amount: "10000",
            counterparty: "GBSVTVRQ4AEFRNGH2MIOOWZSAVLZKOKNKI4UAGSMBZSNRP4I3FL3ELYP",
            merchantName: "demo.rail402.dev",
            payload: {},
          },
          {
            id: "e1",
            kind: "merchant_added",
            ledger: 5903743,
            txHash: "4e246e69" + "0".repeat(56),
            ts: new Date(Date.now() - 3 * 3600_000).toISOString(),
            amount: null,
            counterparty: null,
            merchantName: null,
            payload: { merchant: "GBSVTVRQ4AEFRNGH2MIOOWZSAVLZKOKNKI4UAGSMBZSNRP4I3FL3ELYP" },
          },
        ]
      : [
          {
            id: "c1",
            kind: "created",
            ledger: 5883567,
            txHash: "ca2a7f2d" + "0".repeat(56),
            ts: new Date(Date.now() - 48 * 3600_000).toISOString(),
            amount: null,
            counterparty: null,
            merchantName: null,
            payload: {},
          },
        ];
  return { card, items, nextCursor: opts.nextCursor ?? null, stale: false };
}

/** Every indexer route answers 503 — the app must behave as if there were no indexer. */
export async function stubIndexerOff(page: Page) {
  await page.route("**/api/cards**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "no_database" }) }),
  );
}

/** A live indexer: `cards` lists the given cards; activity pages twice; merchants carries one label. */
export async function stubIndexerOn(page: Page, owner: string, cards: string[], labelPayTo = "GBSVTVRQ4AEFRNGH2MIOOWZSAVLZKOKNKI4UAGSMBZSNRP4I3FL3ELYP") {
  await page.route("**/api/cards**", (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const m = url.pathname.match(/^\/api\/cards\/([^/]+)(?:\/(activity|merchants|track))?/);
    if (!m) {
      return json({
        owner,
        cards: cards.map((card) => ({ card, label: null, createdAt: null, createdTx: null, trackedBy: "factory" })),
        stale: false,
      });
    }
    const card = m[1];
    if (m[2] === "activity") {
      const cursor = url.searchParams.get("cursor");
      return json(cursor ? activityBody(card, { page: 2 }) : activityBody(card, { nextCursor: "5903743:e1" }));
    }
    if (m[2] === "merchants") {
      return json({
        card,
        merchants: [
          {
            payTo: labelPayTo,
            name: "demo.rail402.dev",
            url: "https://demo.rail402.dev/weather",
            addedAt: new Date().toISOString(),
            addedTx: null,
            removedAt: null,
          },
        ],
      });
    }
    if (m[2] === "track") return json({ card, tracked: true, backfilled: true });
    return json({ error: "not_found" }, 404);
  });
}
