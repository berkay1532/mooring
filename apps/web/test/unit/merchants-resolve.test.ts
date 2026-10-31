// @vitest-environment node
import { describe, expect, it } from "vitest"
import { resolveMerchant, type ResolveDeps } from "@/lib/merchants/resolve"

const NET = "stellar:testnet"
const USDC = "CUSDC"
const PAY = "GPAYTO"

function header(accepts: unknown[], extra: Record<string, unknown> = {}): string {
  return Buffer.from(JSON.stringify({ x402Version: 2, accepts, ...extra })).toString("base64")
}
const entry = (network = NET, amount = "10000") => ({
  scheme: "exact",
  network,
  asset: USDC,
  payTo: PAY,
  amount,
  maxTimeoutSeconds: 60,
  extra: {},
})
const r402 = (h: string | null, body = "") =>
  new Response(body, { status: 402, headers: h ? { "PAYMENT-REQUIRED": h } : {} })

type Call = { url: string; init: RequestInit & { dispatcher?: unknown } }
function setup(script: Array<Response | Error>, over: Partial<ResolveDeps> = {}) {
  const calls: Call[] = []
  const queue = [...script]
  const fetch = (async (url: unknown, init: RequestInit) => {
    calls.push({ url: String(url), init })
    const next = queue.shift()
    if (!next) throw new Error("script exhausted")
    if (next instanceof Error) throw next
    return next
  }) as unknown as typeof globalThis.fetch
  const deps: ResolveDeps = {
    fetch,
    lookup: async () => ["93.184.216.34"],
    network: NET,
    asset: USDC,
    allowLocal: false,
    userAgent: "mooring-resolver/test",
    ...over,
  }
  return { deps, calls }
}
const redirect = (to: string, status = 302) => new Response(null, { status, headers: { location: to } })

describe("resolveMerchant", () => {
  it("resolves a v2 402 on GET", async () => {
    const h = header([entry()], { resource: { description: "Weather" } })
    const { deps, calls } = setup([r402(h)])
    const r = await resolveMerchant("https://api.example.com/weather", deps)
    expect(r).toMatchObject({ ok: true, payTo: PAY, amount: "10000", network: NET, asset: USDC, scheme: "exact", url: "https://api.example.com/weather" })
    expect(r.ok && r.service?.description).toBe("Weather")
    expect(calls[0].init.method).toBe("GET")
    expect(calls[0].init.redirect).toBe("manual")
    expect(calls[0].init.dispatcher).toBeUndefined()
  })

  it("retries once with POST after a non-402", async () => {
    const { deps, calls } = setup([new Response("", { status: 404 }), r402(header([entry()]))])
    const r = await resolveMerchant("https://api.example.com/x", deps)
    expect(r.ok).toBe(true)
    expect(calls[1].init.method).toBe("POST")
    expect(calls[1].init.body).toBe("{}")
  })

  it("reports not_x402 with the status when neither answers 402", async () => {
    const { deps } = setup([new Response("", { status: 200 }), new Response("", { status: 200 })])
    const r = await resolveMerchant("https://api.example.com/x", deps)
    expect(r).toMatchObject({ ok: false, code: "not_x402" })
    expect(!r.ok && r.message).toContain("HTTP 200")
  })

  it("blocks a redirect to a private address", async () => {
    const { deps } = setup([redirect("https://internal.example.org/")], {
      lookup: async (h) => (h === "internal.example.org" ? ["10.0.0.1"] : ["93.184.216.34"]),
    })
    const r = await resolveMerchant("https://api.example.com/x", deps)
    expect(r).toMatchObject({ ok: false, code: "blocked_url" })
  })

  it("follows up to 3 redirects and fails on the 4th", async () => {
    const hop = (n: number) => redirect(`https://api.example.com/${n}`)
    const { deps } = setup([hop(1), hop(2), hop(3), hop(4)])
    expect(await resolveMerchant("https://api.example.com/0", deps)).toMatchObject({ ok: false, code: "unreachable" })
    const ok = setup([hop(1), hop(2), hop(3), r402(header([entry()]))])
    const r = await resolveMerchant("https://api.example.com/0", ok.deps)
    expect(r).toMatchObject({ ok: true, url: "https://api.example.com/3" })
  })

  it("downgrades a 303 after POST to GET", async () => {
    const { deps, calls } = setup([
      new Response("", { status: 404 }),
      redirect("https://api.example.com/y", 303),
      r402(header([entry()])),
    ])
    const r = await resolveMerchant("https://api.example.com/x", deps)
    expect(r.ok).toBe(true)
    expect(calls[2].init.method).toBe("GET")
    expect(calls[2].init.body).toBeUndefined()
  })

  it("maps fetch rejection and abort to unreachable", async () => {
    const a = setup([new Error("boom")])
    expect(await resolveMerchant("https://api.example.com/x", a.deps)).toMatchObject({ ok: false, code: "unreachable" })
    const hang = setup([], {
      timeoutMs: 20,
      fetch: ((_u: unknown, init: RequestInit) =>
        new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(new Error("aborted"))))) as never,
    })
    expect(await resolveMerchant("https://api.example.com/x", hang.deps)).toMatchObject({ ok: false, code: "unreachable" })
  })

  it("returns no_match naming the networks found", async () => {
    const { deps } = setup([r402(header([entry("stellar:pubnet")]))])
    const r = await resolveMerchant("https://api.example.com/x", deps)
    expect(r).toMatchObject({ ok: false, code: "no_match" })
    if (!r.ok) {
      expect(r.found?.[0].network).toBe("stellar:pubnet")
      expect(r.message).toBe("This service accepts Stellar mainnet; this card holds Stellar testnet USDC.")
    }
  })

  it("returns ambiguous for several entries on the card network", async () => {
    const { deps } = setup([r402(header([entry(), { ...entry(), payTo: "GOTHER" }]))])
    const r = await resolveMerchant("https://api.example.com/x", deps)
    expect(r).toMatchObject({ ok: false, code: "ambiguous" })
  })

  it("treats a body over 64 KiB with no header as not_x402", async () => {
    const big = JSON.stringify({ x402Version: 1, accepts: [], pad: "a".repeat(70_000) })
    const { deps } = setup([r402(null, big), r402(null, big)])
    const r = await resolveMerchant("https://api.example.com/x", deps)
    expect(r).toMatchObject({ ok: false, code: "not_x402" })
  })

  it("reads a v1 body when there is no header", async () => {
    const body = JSON.stringify({ x402Version: 1, accepts: [{ scheme: "exact", network: "stellar:testnet", asset: USDC, payTo: PAY, maxAmountRequired: "5" }] })
    const { deps } = setup([r402(null, body)])
    const r = await resolveMerchant("https://api.example.com/x", deps)
    expect(r).toMatchObject({ ok: true, amount: "5" })
  })

  it("passes a pinned dispatcher only when dispatcherFor is given", async () => {
    const seen: Array<[string, string[]]> = []
    const sentinel = { sentinel: true }
    const { deps, calls } = setup([r402(header([entry()]))], {
      dispatcherFor: (h, a) => (seen.push([h, a]), sentinel as never),
    })
    await resolveMerchant("https://api.example.com/x", deps)
    expect(calls[0].init.dispatcher).toBe(sentinel)
    expect(seen).toEqual([["api.example.com", ["93.184.216.34"]]])
  })

  it("rejects invalid urls", async () => {
    const { deps } = setup([])
    expect(await resolveMerchant("nope", deps)).toMatchObject({ ok: false, code: "invalid_url" })
  })

  it("allows localhost with allowLocal", async () => {
    const { deps } = setup([r402(header([entry()]))], { allowLocal: true, lookup: async () => ["127.0.0.1"] })
    const r = await resolveMerchant("http://localhost:3001/weather", deps)
    expect(r.ok).toBe(true)
  })
})
