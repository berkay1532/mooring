/** `GET /api/directory?network=` with injectable deps; the CDN caches the answer for an hour. */
import { payableOn } from "./merge";
import type { DirectoryCache } from "./cache";
import type { DirectoryResponse, DirectorySnapshot } from "./types";
import { isDirectoryNetwork, otherNetwork } from "./types";

export interface DirectoryRouteDeps {
  cache: DirectoryCache<DirectorySnapshot>;
  limiter: { take(key: string): boolean };
  /** Cap on `items`; default 500. */
  maxItems?: number;
  /** Cap on the other network's non-proxy list; default 60. */
  maxOther?: number;
}

const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" };

export function createDirectoryHandler(deps: DirectoryRouteDeps) {
  return async function GET(req: Request): Promise<Response> {
    const key = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (!deps.limiter.take(key)) {
      return Response.json({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } });
    }
    const network = new URL(req.url).searchParams.get("network");
    if (!isDirectoryNetwork(network)) {
      return Response.json({ error: "network must be stellar:testnet or stellar:pubnet" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const snap = await deps.cache.get();
    const other = otherNetwork(network);
    const otherAll = payableOn(snap.entries, other);
    const body: DirectoryResponse = {
      network,
      fetchedAt: snap.fetchedAt,
      sources: snap.sources,
      items: payableOn(snap.entries, network).slice(0, deps.maxItems ?? 500),
      other: {
        network: other,
        count: otherAll.length,
        proxyCount: otherAll.filter((e) => e.proxy).length,
        items: otherAll.filter((e) => !e.proxy).slice(0, deps.maxOther ?? 60),
      },
    };
    const ok = snap.sources.some((s) => s.ok);
    return Response.json(body, { status: 200, headers: ok ? CACHE_HEADERS : { "Cache-Control": "no-store" } });
  };
}
