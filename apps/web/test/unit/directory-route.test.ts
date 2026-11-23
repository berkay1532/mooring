// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createSnapshotCache } from "@/lib/directory/cache";
import { createDirectoryHandler } from "@/lib/directory/handler";
import { loadSnapshot } from "@/lib/directory/snapshot";
import { MPPROUTER_URL } from "@/lib/directory/sources/mpprouter";
import { RAIL402_URL } from "@/lib/directory/sources/rail402";
import { STELLARSIGHT_URL } from "@/lib/directory/sources/stellarsight";
import type { DirectoryResponse } from "@/lib/directory/types";
import { createRateLimiter } from "@/lib/merchants/ratelimit";
import mpprouter from "../fixtures/directory/mpprouter.json";
import rail402 from "../fixtures/directory/rail402.json";
import stellarsight from "../fixtures/directory/stellarsight.json";

const fetchStub = (opts: { failRail?: boolean } = {}): typeof fetch =>
  (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith(RAIL402_URL)) {
      if (opts.failRail) return new Response("nope", { status: 503 });
      return Response.json(rail402);
    }
    if (url.startsWith(STELLARSIGHT_URL.split("?")[0])) return Response.json(stellarsight);
    if (url.startsWith(MPPROUTER_URL)) return Response.json(mpprouter);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

function handler(opts: { failRail?: boolean } = {}) {
  const cache = createSnapshotCache({
    load: () => loadSnapshot({ fetch: fetchStub(opts), now: () => new Date("2026-11-23T12:00:00Z") }),
    ttlMs: 60_000,
    staleMs: 120_000,
  });
  return createDirectoryHandler({ cache, limiter: createRateLimiter({ limit: 60, windowMs: 60_000 }) });
}
const req = (qs: string, ip = "1.1.1.1") => new Request(`http://x/api/directory${qs}`, { headers: { "x-forwarded-for": ip } });

describe("GET /api/directory", () => {
  it("400 without a known network", async () => {
    const h = handler();
    for (const qs of ["", "?network=eip155:1", "?network=stellar%3Afuturenet"]) {
      const res = await h(req(qs));
      expect(res.status).toBe(400);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("lists the testnet USDC sellers, reports sources, and describes the other network", async () => {
    const res = await handler()(req("?network=stellar:testnet"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=3600, stale-while-revalidate=86400");
    const body = (await res.json()) as DirectoryResponse;
    expect(body.network).toBe("stellar:testnet");
    expect(body.fetchedAt).toBe("2026-11-23T12:00:00.000Z");
    // Rail402's three testnet rows; StellarSight's rows use another token and are not payable.
    expect(body.items.map((e) => e.url).sort()).toEqual([
      "https://demo.rail402.dev/mcp",
      "https://demo.rail402.dev/weather",
      "https://try-cli-1.onrender.com/sketch",
    ]);
    expect(body.sources).toEqual([
      { source: "rail402", ok: true, count: 4 },
      { source: "stellarsight", ok: true, count: 3 },
      { source: "mpprouter", ok: true, count: 2 },
    ]);
    // Other network: Rail402's pubnet demo + MPP Router (one proxied, one direct).
    expect(body.other).toMatchObject({ network: "stellar:pubnet", count: 3, proxyCount: 1 });
    expect(body.other.items.map((e) => e.host).sort()).toEqual(["apiserver.mpprouter.dev", "demo-mainnet.rail402.dev"]);
  });

  it("serves the pubnet view with testnet as the other side", async () => {
    const body = (await (await handler()(req("?network=stellar:pubnet"))).json()) as DirectoryResponse;
    expect(body.items).toHaveLength(3);
    expect(body.other.network).toBe("stellar:testnet");
    expect(body.other.count).toBe(3);
  });

  it("keeps serving when one source fails, and says so", async () => {
    const body = (await (await handler({ failRail: true })(req("?network=stellar:testnet"))).json()) as DirectoryResponse;
    expect(body.items).toEqual([]);
    expect(body.sources[0]).toEqual({ source: "rail402", ok: false, count: 0, error: "HTTP 503" });
    expect(body.other.count).toBe(2);
  });

  it("429 after the limit", async () => {
    const h = createDirectoryHandler({
      cache: createSnapshotCache({ load: async () => ({ fetchedAt: "", entries: [], sources: [] }), ttlMs: 1, staleMs: 1 }),
      limiter: createRateLimiter({ limit: 1, windowMs: 60_000 }),
    });
    expect((await h(req("?network=stellar:testnet"))).status).toBe(200);
    const res = await h(req("?network=stellar:testnet"));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });
});
