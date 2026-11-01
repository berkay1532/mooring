import { isIP } from "node:net"

/** A guard rejection. Messages never echo the host or any credentials. */
export type GuardError = {
  code: "invalid_url" | "blocked_url" | "unreachable"
  message: string
}

const MAX_URL_LENGTH = 2048
const INVALID: GuardError = { code: "invalid_url", message: "Enter a full https:// URL." }
const BLOCKED: GuardError = { code: "blocked_url", message: "That address is not allowed." }
const UNREACHABLE: GuardError = { code: "unreachable", message: "Could not reach that service." }

/**
 * Validates the shape of an owner-supplied URL: parsable, https (http only
 * with `allowLocal`), no credentials, at most 2048 characters.
 */
export function validateUrl(
  raw: string,
  opts: { allowLocal: boolean },
): { ok: true; url: URL } | ({ ok: false } & GuardError) {
  const fail = { ok: false as const, ...INVALID }
  const trimmed = raw.trim()
  if (trimmed.length === 0 || raw.length > MAX_URL_LENGTH) return fail
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return fail
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && opts.allowLocal)) return fail
  if (url.username !== "" || url.password !== "") return fail
  return { ok: true, url }
}

function v4Blocked(n: number): boolean {
  const a = n >>> 24
  const b = (n >>> 16) & 0xff
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0 && ((n >>> 8) & 0xff) === 0) || // 192.0.0.0/24 IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 benchmarking
    a >= 224 // multicast 224/4 and reserved 240/4
  )
}

function parseV4(s: string): number {
  const p = s.split(".").map(Number)
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0
}

/** Expands a valid IPv6 literal into eight 16-bit groups. */
function parseV6(s: string): number[] {
  let str = s
  const dot = str.lastIndexOf(".")
  if (dot !== -1) {
    const colon = str.lastIndexOf(":")
    const v4 = parseV4(str.slice(colon + 1))
    str = `${str.slice(0, colon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`
  }
  const [head, tail] = str.split("::")
  const h = head ? head.split(":") : []
  const t = tail !== undefined && tail ? tail.split(":") : []
  const fill = tail === undefined ? 0 : 8 - h.length - t.length
  return [...h, ...Array<string>(fill).fill("0"), ...t].map((g) => parseInt(g, 16))
}

/**
 * True for loopback, link-local, private, unique-local, CGNAT, multicast,
 * reserved and unspecified addresses (IPv4-mapped, -compatible, SIIT, NAT64
 * and 6to4 IPv6 are judged by their embedded IPv4 part). Returns false for input that is not an IP literal.
 */
export function isBlockedAddress(ip: string): boolean {
  let addr = ip
  if (addr.startsWith("[") && addr.endsWith("]")) addr = addr.slice(1, -1)
  const zone = addr.indexOf("%")
  if (zone !== -1) addr = addr.slice(0, zone)
  const kind = isIP(addr)
  if (kind === 4) return v4Blocked(parseV4(addr))
  if (kind !== 6) return false
  const g = parseV6(addr)
  const zeros = (from: number, to: number) => g.slice(from, to).every((x) => x === 0)
  const embedsV4 =
    (zeros(0, 4) && g[4] === 0 && g[5] === 0xffff) || // ::ffff:0:0/96 mapped
    (zeros(0, 4) && g[4] === 0xffff && g[5] === 0) || // ::ffff:0:0:0/96 SIIT
    zeros(0, 6) || // ::/96 IPv4-compatible
    (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) // 64:ff9b::/96 NAT64
  // `::` and `::1` fall inside ::/96 above and are judged as 0.0.0.0 / 0.0.0.1
  // (both in 0.0.0.0/8), so they need no separate checks.
  if (embedsV4) return v4Blocked(((g[6] << 16) | g[7]) >>> 0)
  if (g[0] === 0x2002) return v4Blocked(((g[1] << 16) | g[2]) >>> 0) // 2002::/16 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true // fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true // fe80::/10
  return false
}

/**
 * Checks the URL's host: `localhost`, `*.localhost` and blocked IP literals
 * are refused; any other name is resolved and every address must pass.
 * `allowLocal` skips all checks. Returns null when the host is allowed.
 */
export async function assertHostAllowed(
  url: URL,
  opts: { allowLocal: boolean; lookup: (host: string) => Promise<string[]> },
): Promise<GuardError | null> {
  if (opts.allowLocal) return null
  const lowered = url.hostname.toLowerCase()
  const host = lowered.endsWith(".") ? lowered.slice(0, -1) : lowered
  if (host === "localhost" || host.endsWith(".localhost")) return BLOCKED
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host
  if (isIP(bare) !== 0) return isBlockedAddress(bare) ? BLOCKED : null
  let addrs: string[]
  try {
    addrs = await opts.lookup(host)
  } catch {
    return UNREACHABLE
  }
  if (addrs.length === 0) return UNREACHABLE
  return addrs.some((a) => isIP(a) === 0 || isBlockedAddress(a)) ? BLOCKED : null
}
