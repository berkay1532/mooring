// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import { assertHostAllowed, isBlockedAddress, validateUrl } from "@/lib/merchants/guard"

describe("validateUrl", () => {
  it("accepts a plain https URL", () => {
    const r = validateUrl("  https://api.example.com/x?y=1  ", { allowLocal: false })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.url.hostname).toBe("api.example.com")
  })
  it("rejects credentials without echoing them", () => {
    const r = validateUrl("https://user:pass@a.b/x", { allowLocal: false })
    expect(r).toMatchObject({ ok: false, code: "invalid_url" })
    if (!r.ok) {
      expect(r.message).not.toContain("pass")
      expect(r.message).not.toContain("user")
    }
  })
  it("rejects http without allowLocal, allows it with", () => {
    expect(validateUrl("http://a.b/x", { allowLocal: false })).toMatchObject({ ok: false, code: "invalid_url" })
    expect(validateUrl("http://a.b/x", { allowLocal: true }).ok).toBe(true)
  })
  it("rejects other schemes, garbage and over-long input", () => {
    for (const raw of ["javascript:alert(1)", "ftp://a.b/x", "not a url", ""]) {
      expect(validateUrl(raw, { allowLocal: true })).toMatchObject({ ok: false, code: "invalid_url" })
    }
    const long = "https://a.b/" + "x".repeat(2048)
    expect(validateUrl(long, { allowLocal: false })).toMatchObject({ ok: false, code: "invalid_url" })
  })
  it("uses the one-sentence message", () => {
    const r = validateUrl("nope", { allowLocal: false })
    if (!r.ok) expect(r.message).toBe("Enter a full https:// URL.")
  })
})

describe("isBlockedAddress", () => {
  it.each([
    "0.0.0.0", "0.1.2.3", "127.0.0.1", "10.1.2.3", "169.254.169.254", "172.16.0.1", "172.31.0.1",
    "192.168.0.1", "100.64.0.1", "100.127.255.255", "224.0.0.1", "239.1.1.1", "240.0.0.1", "255.255.255.255",
    "::", "::1", "fd00::1", "fc00::1", "fe80::1", "febf::1", "::ffff:192.168.0.1", "::ffff:c0a8:1",
    "[::1]", "::7f00:1", "64:ff9b::7f00:1", "::ffff:0:7f00:1", "::ffff:0:127.0.0.1",
    "198.18.0.1", "198.19.255.255", "192.0.0.1", "192.0.0.255", "2002:7f00:1::", "2002:c0a8:101::1",
    "2002:a9fe:a9fe::1",
  ])("blocks %s", (ip) => expect(isBlockedAddress(ip)).toBe(true))

  it.each([
    "93.184.216.34", "172.15.0.1", "172.32.0.1", "100.63.0.1", "100.128.0.1", "223.255.255.255",
    "2606:4700::1", "::ffff:93.184.216.34", "fec0::1", "64:ff9b::5db8:d822",
    "198.17.255.255", "198.20.0.1", "192.0.1.1", "192.0.2.1", "2002:5db8:d822::1",
  ])("allows %s", (ip) => expect(isBlockedAddress(ip)).toBe(false))

  it("treats non-IPs as not blocked", () => {
    expect(isBlockedAddress("example.com")).toBe(false)
  })
})

describe("assertHostAllowed", () => {
  const url = (s: string) => new URL(s)
  const pub = async () => ["93.184.216.34"]

  it("blocks when any resolved address is blocked, without echoing the host", async () => {
    const e = await assertHostAllowed(url("https://a.example/"), {
      allowLocal: false,
      lookup: async () => ["93.184.216.34", "10.0.0.5"],
    })
    expect(e).toEqual({ code: "blocked_url", message: "That address is not allowed." })
  })
  it("allows when all addresses are public", async () => {
    expect(await assertHostAllowed(url("https://a.example/"), { allowLocal: false, lookup: pub })).toBeNull()
  })
  it("blocks localhost and *.localhost without lookup", async () => {
    const lookup = async () => { throw new Error("should not be called") }
    for (const h of ["localhost", "foo.localhost"]) {
      const e = await assertHostAllowed(url(`https://${h}/`), { allowLocal: false, lookup })
      expect(e?.code).toBe("blocked_url")
    }
  })
  it("checks IP literals directly, including bracketed IPv6", async () => {
    const lookup = async () => { throw new Error("no lookup") }
    for (const h of ["127.0.0.1", "[::1]", "[::ffff:192.168.0.1]"]) {
      const e = await assertHostAllowed(url(`https://${h}/`), { allowLocal: false, lookup })
      expect(e?.code).toBe("blocked_url")
    }
    expect(await assertHostAllowed(url("https://93.184.216.34/"), { allowLocal: false, lookup })).toBeNull()
  })
  it("reports unreachable on lookup failure or empty result", async () => {
    const want = { code: "unreachable", message: "Could not reach that service." }
    expect(await assertHostAllowed(url("https://a.example/"), { allowLocal: false, lookup: async () => { throw new Error("x") } })).toEqual(want)
    expect(await assertHostAllowed(url("https://a.example/"), { allowLocal: false, lookup: async () => [] })).toEqual(want)
  })
  it("allowLocal skips every check", async () => {
    const lookup = async () => { throw new Error("no lookup") }
    expect(await assertHostAllowed(url("http://localhost:3000/"), { allowLocal: true, lookup })).toBeNull()
    expect(await assertHostAllowed(url("http://127.0.0.1/"), { allowLocal: true, lookup })).toBeNull()
  })

  it("blocks trailing-dot localhost without lookup", async () => {
    const lookup = vi.fn(async () => ["93.184.216.34"])
    for (const h of ["localhost.", "a.localhost."]) {
      const e = await assertHostAllowed(url(`https://${h}/`), { allowLocal: false, lookup })
      expect(e?.code).toBe("blocked_url")
    }
    expect(lookup).not.toHaveBeenCalled()
  })
  it("fails closed on a non-IP lookup answer", async () => {
    const e = await assertHostAllowed(url("https://a.example/"), { allowLocal: false, lookup: async () => ["not-an-ip"] })
    expect(e?.code).toBe("blocked_url")
  })
  it("blocks encoded loopback end to end", async () => {
    const lookup = vi.fn(async () => ["93.184.216.34"])
    for (const raw of ["https://2130706433/", "https://[0:0:0:0:0:ffff:127.0.0.1]/"]) {
      const v = validateUrl(raw, { allowLocal: false })
      expect(v.ok).toBe(true)
      if (v.ok) expect((await assertHostAllowed(v.url, { allowLocal: false, lookup }))?.code).toBe("blocked_url")
    }
    expect(lookup).not.toHaveBeenCalled()
  })
})
