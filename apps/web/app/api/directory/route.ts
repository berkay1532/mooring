import { createSnapshotCache } from "@/lib/directory/cache"
import { createDirectoryHandler } from "@/lib/directory/handler"
import { loadSnapshot } from "@/lib/directory/snapshot"
import { createRateLimiter } from "@/lib/merchants/ratelimit"

export const runtime = "nodejs"

const cache = createSnapshotCache({
  load: () => loadSnapshot({ fetch: globalThis.fetch, bazaar: process.env.MOORING_DIRECTORY_BAZAAR === "1" }),
  ttlMs: 60 * 60 * 1000,
  staleMs: 24 * 60 * 60 * 1000,
})

export const GET = createDirectoryHandler({ cache, limiter: createRateLimiter({ limit: 60, windowMs: 60_000 }) })
