/**
 * A canned `GET /api/directory` answer. The real route fetches public
 * catalogues server-side, which the suite must never do, so `fixtures/app.ts`
 * installs this by default and `directory.spec.ts` asserts against it.
 */
import type { Page } from "@playwright/test";

import { USDC } from "./env";

export const DIRECTORY_PAY_TO = "GBSVTVRQ4AEFRNGH2MIOOWZSAVLZKOKNKI4UAGSMBZSNRP4I3FL3ELYP";
export const DIRECTORY_URL = "https://demo.rail402.dev/weather";
export const SKETCH_PAY_TO = "GBCKZHYGFWRS77UVZCOGTST55OL3HHXDSAYZRKPNBQGO5DXHSCBGRL7B";

const base = {
  source: "rail402",
  network: "stellar:testnet",
  asset: USDC,
  scheme: "exact",
  kind: "http",
  method: "GET",
  tags: [] as string[],
  proxy: false,
  verified: false,
};

export const DIRECTORY_BODY = {
  network: "stellar:testnet",
  fetchedAt: "2026-11-23T12:00:00.000Z",
  sources: [
    { source: "rail402", ok: true, count: 4 },
    { source: "stellarsight", ok: true, count: 3 },
    { source: "mpprouter", ok: true, count: 448 },
  ],
  items: [
    {
      ...base,
      id: `rail402:stellar:testnet:${SKETCH_PAY_TO}:https://try-cli-1.onrender.com/sketch`,
      url: "https://try-cli-1.onrender.com/sketch",
      host: "try-cli-1.onrender.com",
      name: "Pet Pen Portraits",
      description: "Turns a photo of a dog into an SVG sketch",
      payTo: SKETCH_PAY_TO,
      amount: "2500000",
      method: "POST",
      tags: ["pet-portrait", "svg"],
      verified: true,
      settlements: 75,
    },
    {
      ...base,
      id: `rail402:stellar:testnet:${DIRECTORY_PAY_TO}:${DIRECTORY_URL}`,
      url: DIRECTORY_URL,
      host: "demo.rail402.dev",
      name: "Rail402 demo",
      description: "Current weather for a city",
      payTo: DIRECTORY_PAY_TO,
      amount: "10000",
      tags: ["weather"],
    },
  ],
  other: {
    network: "stellar:pubnet",
    count: 448,
    proxyCount: 441,
    items: [
      {
        ...base,
        id: "mpprouter:stellar:pubnet:GC5K:https://apiserver.mpprouter.dev/v1/services/mercury/events/by-contract#mercury",
        source: "mpprouter",
        url: "https://apiserver.mpprouter.dev/v1/services/mercury/events/by-contract",
        host: "apiserver.mpprouter.dev",
        name: "Mercury",
        payTo: "GC5KJLF3UOKRWWWQCRGNXP4A3CFBNUD6ZQFVSJNBA4UVNICZXPBLMHC3",
        network: "stellar:pubnet",
        asset: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
        amount: "10000",
        verified: true,
      },
    ],
  },
};

/** Serves `body` (default: the canned directory) for every directory request on `page`. */
export async function stubDirectory(page: Page, body: unknown = DIRECTORY_BODY, status = 200): Promise<void> {
  await page.route("**/api/directory?**", (route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }),
  );
}
