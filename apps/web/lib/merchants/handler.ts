/** Thin request handler for POST /api/resolve-merchant, with injectable deps. */
import { config } from "@/lib/config"
import { resolveMerchant, type ResolveDeps } from "./resolve"
import { isIP } from "node:net"

// Mirrors the `version` in apps/web/package.json.
const USER_AGENT = "mooring-resolver/0.1.0"

/** Collaborators of the route; tests inject stubs. */
export interface RouteDeps {
  fetch: typeof globalThis.fetch
  lookup: (host: string) => Promise<string[]>
  allowLocal: boolean
  limiter: { take(key: string): boolean }
  dispatcherFor?: ResolveDeps["dispatcherFor"]
  closeDispatcher?: ResolveDeps["closeDispatcher"]
  /** Defaults to `resolveMerchant`; injectable for tests. */
  resolve?: typeof resolveMerchant
}

/** Rate-limit bucket for a client address: IPv6 collapses to its /64 prefix. */
export function rateKey(raw: string | undefined): string {
  const ip = raw?.trim()
  if (!ip) return "local"
  if (isIP(ip) !== 6 || ip.includes(".")) return ip
  const [head, tail] = ip.split("::")
  const h = head ? head.split(":") : []
  const t = tail ? tail.split(":") : []
  const groups = [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t]
  return groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":") + "::/64"
}

const NO_STORE = { "Cache-Control": "no-store" }
const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...NO_STORE, ...extra } })

/** Builds the POST handler around `deps`. */
export function createHandler(deps: RouteDeps) {
  return async function POST(req: Request): Promise<Response> {
    const key = rateKey(req.headers.get("x-forwarded-for")?.split(",")[0])
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
    let result: Awaited<ReturnType<typeof resolveMerchant>>
    try {
      result = await (deps.resolve ?? resolveMerchant)(url, {
        fetch: deps.fetch,
        lookup: deps.lookup,
        network: config.network,
        asset: config.usdc,
        allowLocal: deps.allowLocal,
        userAgent: USER_AGENT,
        dispatcherFor: deps.dispatcherFor,
        closeDispatcher: deps.closeDispatcher,
        })
    } catch {
      return json({ ok: false, code: "unreachable", message: "Could not reach that service." }, 200)
    }
    return json(result, result.ok || result.code !== "invalid_url" ? 200 : 400)
  }
}
