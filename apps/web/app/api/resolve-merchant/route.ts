import { lookup as dnsLookup } from "node:dns/promises"
import { createHandler, type RouteDeps } from "@/lib/merchants/handler"
import { closePinned, pinnedDispatcher, pinnedFetch } from "@/lib/merchants/pinned"
import { createRateLimiter } from "@/lib/merchants/ratelimit"

export const runtime = "nodejs"

const defaultDeps: RouteDeps = {
  fetch: pinnedFetch,
  lookup: async (host) => (await dnsLookup(host, { all: true })).map((a) => a.address),
  allowLocal: process.env.MOORING_RESOLVER_ALLOW_LOCAL === "1",
  limiter: createRateLimiter({ limit: 30, windowMs: 60_000 }),
  dispatcherFor: pinnedDispatcher,
  closeDispatcher: closePinned,
}

export const POST = createHandler(defaultDeps)
