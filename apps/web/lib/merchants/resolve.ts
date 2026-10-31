/**
 * Server-side resolver: fetches an owner-supplied x402 service URL, reads its
 * `402` terms and returns the entry this card can pay. Every hop is checked by
 * the SSRF guard and (when `dispatcherFor` is given) pinned to the addresses
 * the guard validated, so DNS cannot change between check and connect.
 */
import { assertHostAllowed, validateUrl } from "./guard"
import { parsePaymentRequired, selectTerms, type MerchantTerms, type ServiceMeta } from "./terms"

/** A resolved, payable merchant entry. */
export type ResolveOk = {
  ok: true
  url: string
  payTo: string
  network: string
  asset: string
  amount: string
  scheme: string
  service?: ServiceMeta
  feesSponsored?: boolean
}
/** Failure codes surfaced to the UI. */
export type ResolveErrCode =
  | "invalid_url"
  | "blocked_url"
  | "unreachable"
  | "not_x402"
  | "no_match"
  | "ambiguous"
/** A resolution failure; `found` lists the entries the service did offer. */
export type ResolveErr = {
  ok: false
  code: ResolveErrCode
  message: string
  found?: Array<Pick<MerchantTerms, "network" | "asset" | "payTo" | "amount">>
}
/** Outcome of `resolveMerchant`. */
export type ResolveResult = ResolveOk | ResolveErr

/** Injectable collaborators; tests script `fetch` and `lookup`. */
export interface ResolveDeps {
  fetch: typeof globalThis.fetch
  lookup: (host: string) => Promise<string[]>
  network: string
  asset: string
  allowLocal: boolean
  userAgent: string
  /** Per-hop timeout, default 5000. */
  timeoutMs?: number
  /** Builds a connection-pinning dispatcher for a hop; omitted in tests. */
  dispatcherFor?: (hostname: string, addresses: string[]) => unknown
  /** Releases a dispatcher built by `dispatcherFor`. */
  closeDispatcher?: (dispatcher: unknown) => Promise<void> | void
}

const MAX_REDIRECTS = 3
const MAX_BODY = 64 * 1024
const REDIRECTS = new Set([301, 302, 303, 307, 308])
const UNREACHABLE = "Could not reach that service."

const NETWORK_NAMES: Record<string, string> = {
  "stellar:testnet": "Stellar testnet",
  "stellar:pubnet": "Stellar mainnet",
}
const networkName = (id: string) => NETWORK_NAMES[id] ?? id

const fail = (code: ResolveErrCode, message: string, found?: ResolveErr["found"]): ResolveErr =>
  found ? { ok: false, code, message, found } : { ok: false, code, message }

async function readCapped(res: Response): Promise<string | null> {
  const reader = res.body?.getReader()
  if (!reader) return ""
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString("utf8")
}

/**
 * Resolves `rawUrl` to the x402 entry matching `deps.network` / `deps.asset`.
 * GET first, one POST `{}` retry when GET is not a 402; never throws.
 */
export async function resolveMerchant(rawUrl: string, deps: ResolveDeps): Promise<ResolveResult> {
  const checked = validateUrl(rawUrl, { allowLocal: deps.allowLocal })
  if (!checked.ok) return fail(checked.code, checked.message)
  let url = checked.url
  let method: "GET" | "POST" = "GET"
  let posted = false
  let redirects = 0
  let status = 0

  for (;;) {
    // One lookup per hop: the guard and the pinned connection share its answer.
    let addrs: string[] | undefined
    const lookup = async (host: string) => (addrs ??= await deps.lookup(host))
    const denied = await assertHostAllowed(url, { allowLocal: deps.allowLocal, lookup })
    if (denied) return fail(denied.code, denied.message)

    let dispatcher: unknown
    if (deps.dispatcherFor) {
      const bare = url.hostname.replace(/^\[|\]$/g, "")
      try {
        const pinned = /^[\d.]+$|:/.test(bare) ? [bare] : await lookup(url.hostname)
        if (pinned.length === 0) return fail("unreachable", UNREACHABLE)
        dispatcher = deps.dispatcherFor(url.hostname, pinned)
      } catch {
        return fail("unreachable", UNREACHABLE)
      }
    }

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 5000)
    const headers: Record<string, string> = { Accept: "application/json", "User-Agent": deps.userAgent }
    if (method === "POST") headers["Content-Type"] = "application/json"
    const init: Record<string, unknown> = { method, headers, redirect: "manual", signal: ctrl.signal }
    if (method === "POST") init.body = "{}"
    if (dispatcher !== undefined) init.dispatcher = dispatcher

    let res: Response
    let outcome: ResolveResult | "again" | "redirect"
    try {
      res = await deps.fetch(url.href, init as RequestInit)
      status = res.status
      if (REDIRECTS.has(status)) {
        await res.body?.cancel().catch(() => {})
        outcome = "redirect"
      } else if (status === 402) {
        outcome = await interpret(res, url, deps)
      } else {
        await res.body?.cancel().catch(() => {})
        outcome = "again"
      }
    } catch {
      return fail("unreachable", UNREACHABLE)
    } finally {
      clearTimeout(timer)
      if (dispatcher !== undefined) await Promise.resolve(deps.closeDispatcher?.(dispatcher)).catch(() => {})
    }

    if (outcome === "redirect") {
      redirects += 1
      const location = res.headers.get("location")
      if (redirects > MAX_REDIRECTS || !location) return fail("unreachable", UNREACHABLE)
      let next: string
      try {
        next = new URL(location, url).href
      } catch {
        return fail("unreachable", UNREACHABLE)
      }
      const v = validateUrl(next, { allowLocal: deps.allowLocal })
      if (!v.ok) return fail(v.code, v.message)
      url = v.url
      if (status === 303 || ((status === 301 || status === 302) && method === "POST")) method = "GET"
      continue
    }
    if (outcome === "again") {
      if (posted) break
      posted = true
      method = "POST"
      continue
    }
    return outcome
  }
  return fail("not_x402", `That URL did not answer with x402 payment terms (HTTP ${status}).`)
}

async function interpret(res: Response, url: URL, deps: ResolveDeps): Promise<ResolveResult> {
  const notX402 = fail("not_x402", "That URL did not answer with usable x402 payment terms.")
  const header = res.headers.get("payment-required")
  let body: string | null = null
  if (header === null) {
    body = await readCapped(res)
    if (body === null) return notX402
  } else {
    await res.body?.cancel().catch(() => {})
  }
  const parsed = parsePaymentRequired(header, body)
  if (!parsed || parsed.accepts.length === 0) return notX402

  const sel = selectTerms(parsed, deps.network, deps.asset)
  if (sel.kind === "many") {
    return fail(
      "ambiguous",
      "This service lists more than one address for this network — add it by address instead.",
      sel.found.map(({ network, asset, payTo, amount }) => ({ network, asset, payTo, amount })),
    )
  }
  if (sel.kind === "none") {
    const nets = [...new Set(parsed.accepts.map((a) => a.network))].map(networkName).join(", ")
    return fail(
      "no_match",
      `This service accepts ${nets}; this card holds ${networkName(deps.network)} USDC.`,
      parsed.accepts.map(({ network, asset, payTo, amount }) => ({ network, asset, payTo, amount })),
    )
  }
  const { terms } = sel
  const ok: ResolveOk = {
    ok: true,
    url: url.href,
    payTo: terms.payTo,
    network: terms.network,
    asset: terms.asset,
    amount: terms.amount,
    scheme: terms.scheme,
  }
  if (Object.keys(parsed.service).length > 0) ok.service = parsed.service
  if (parsed.feesSponsored !== undefined) ok.feesSponsored = parsed.feesSponsored
  return ok
}
