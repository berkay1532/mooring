// @vitest-environment node
import { describe, expect, it } from "vitest"
import { createRateLimiter } from "@/lib/merchants/ratelimit"

describe("createRateLimiter", () => {
  it("allows 30 takes, rejects the 31st, then recovers after the window", () => {
    let t = 1000
    const l = createRateLimiter({ limit: 30, windowMs: 60_000, now: () => t })
    for (let i = 0; i < 30; i++) expect(l.take("a")).toBe(true)
    expect(l.take("a")).toBe(false)
    expect(l.take("b")).toBe(true)
    t += 60_000
    expect(l.take("a")).toBe(true)
  })
})
