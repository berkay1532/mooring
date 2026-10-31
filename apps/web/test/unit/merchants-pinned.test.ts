// @vitest-environment node
import { describe, expect, it } from "vitest"
import { pinnedLookup } from "@/lib/merchants/pinned"

type Result = { err: Error | null; address?: string; family?: number }

function run(hostname: string, addresses: string[]): Promise<Result> {
  return new Promise((resolve) => {
    pinnedLookup(hostname, addresses)(hostname, {}, (err, address, family) =>
      resolve({ err, address: address as string, family }),
    )
  })
}

describe("pinnedLookup", () => {
  it("answers with the first pinned address and its family", async () => {
    const r = await run("api.example.com", ["93.184.216.34", "93.184.216.35"])
    expect(r).toEqual({ err: null, address: "93.184.216.34", family: 4 })
  })

  it("reports family 6 for IPv6", async () => {
    const r = await run("api.example.com", ["2606:2800:220:1::1"])
    expect(r.family).toBe(6)
  })

  it("errors for any other hostname", async () => {
    const r = await new Promise<Result>((resolve) => {
      pinnedLookup("api.example.com", ["93.184.216.34"])("evil.example.net", {}, (err) =>
        resolve({ err }),
      )
    })
    expect(r.err).toBeInstanceOf(Error)
  })

  it("honours options.all", async () => {
    const out = await new Promise<unknown>((resolve) => {
      pinnedLookup("a.com", ["1.2.3.4"])("a.com", { all: true }, (_e, a) => resolve(a))
    })
    expect(out).toEqual([{ address: "1.2.3.4", family: 4 }])
  })
})
