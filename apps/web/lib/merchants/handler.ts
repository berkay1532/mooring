/** Thin request handler for POST /api/resolve-merchant, with injectable deps. */
import { config } from "@/lib/config"
import { resolveMerchant, type ResolveDeps } from "./resolve"
import { closePinned } from "./pinned"

// Mirrors the `version` in apps/web/package.json.
const USER_AGENT = "mooring-resolver/0.1.0"

/** Collaborators of the route; tests inject stubs. */
export interface RouteDeps {
  fetch: typeof globalThis.fetch
  lookup: (host: string) => Promise<string[]>
  allowLocal: boolean
  limiter: { take(key: string): boolean }
  dispatcherFor?: ResolveDeps["dispatcherFor"]
}

const NO_STORE = { "Cache-Control": "no-store" }
const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...NO_STORE, ...extra } })

/** Builds the POST handler around `deps`. */
export function createHandler(deps: RouteDeps) {
  return async function POST(req: Request): Promise<Response> {
    const key = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local"
    if (!deps.limiter.take(key)) {
      return json(
        { ok: false, code: "unreachable", message: "Too many lookups, try again in a minute." },
        429,
        { "Retry-After": "60" },
      )
    }
    let url: unknown
    try {
      url = ((await req.json()) as { url?: unknown } | null)?.url
    } catch {
      url = undefined
    }
    if (typeof url !== "string") {
      return json({ ok: false, code: "invalid_url", message: "Enter a full https:// URL." }, 400)
    }
    const result = await resolveMerchant(url, {
      fetch: deps.fetch,
      lookup: deps.lookup,
      network: config.network,
      asset: config.usdc,
      allowLocal: deps.allowLocal,
      userAgent: USER_AGENT,
      dispatcherFor: deps.dispatcherFor,
      closeDispatcher: closePinned,
    })
    return json(result, result.ok || result.code !== "invalid_url" ? 200 : 400)
  }
}
