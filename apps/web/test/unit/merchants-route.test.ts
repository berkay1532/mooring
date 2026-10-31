// @vitest-environment node
import { describe, expect, it } from "vitest"
import { createHandler } from "@/lib/merchants/handler"
import { createRateLimiter } from "@/lib/merchants/ratelimit"
import { rateKey } from "@/lib/merchants/handler"
import { config } from "@/lib/config"

const h = Buffer.from(
  JSON.stringify({ x402Version: 2, accepts: [{ scheme: "exact", network: config.network, asset: config.usdc, payTo: "GBSVTVRQ4AEFRNGH2MIOOWZSAVLZKOKNKI4UAGSMBZSNRP4I3FL3ELYP", amount: "1" }] }),
).toString("base64")

function handler() {
  return createHandler({
    fetch: (async () => new Response("", { status: 402, headers: { "payment-required": h } })) as never,
    lookup: async () => ["93.184.216.34"],
    allowLocal: false,
    limiter: createRateLimiter({ limit: 30, windowMs: 60_000 }),
  })
}
const req = (body: unknown, ip = "1.1.1.1") =>
  new Request("http://x/api/resolve-merchant", {
    method: "POST",
    headers: { "x-forwarded-for": `${ip}, 10.0.0.1`, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })

describe("POST /api/resolve-merchant", () => {
  it("400 invalid_url for a bad url or body", async () => {
    const p = handler()
    for (const b of [{ url: "nope" }, {}, "not json"]) {
      const res = await p(req(b))
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ ok: false, code: "invalid_url" })
    }
  })

  it("200 ok with no-store", async () => {
    const res = await handler()(req({ url: "https://api.example.com/w" }))
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await res.json()).toMatchObject({ ok: true, payTo: "GBSVTVRQ4AEFRNGH2MIOOWZSAVLZKOKNKI4UAGSMBZSNRP4I3FL3ELYP", amount: "1" })
  })

  it("429 on the 31st request from one ip", async () => {
    const p = handler()
    let last!: Response
    for (let i = 0; i < 31; i++) last = await p(req({ url: "https://api.example.com/w" }))
    expect(last.status).toBe(429)
    expect(last.headers.get("retry-after")).toBe("60")
    expect(await last.json()).toEqual({ ok: false, code: "unreachable", message: "Too many lookups, try again in a minute." })
    expect((await p(req({ url: "https://api.example.com/w" }, "2.2.2.2"))).status).toBe(200)
  })

  it("answers 200 unreachable when the resolver throws", async () => {
    const p = createHandler({
      fetch: fetch as never,
      lookup: async () => [],
      allowLocal: false,
      limiter: createRateLimiter({ limit: 30, windowMs: 60_000 }),
      resolve: async () => {
        throw new Error("boom")
      },
    })
    const res = await p(req({ url: "https://api.example.com/w" }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: false, code: "unreachable" })
  })

  it("buckets IPv6 clients to their /64", () => {
    expect(rateKey("2001:db8:1:2:aaaa::1")).toBe(rateKey("2001:db8:1:2:bbbb::2"))
    expect(rateKey("2001:db8:1:3::1")).not.toBe(rateKey("2001:db8:1:2::1"))
    expect(rateKey("1.2.3.4")).toBe("1.2.3.4")
    expect(rateKey(undefined)).toBe("local")
  })
})
