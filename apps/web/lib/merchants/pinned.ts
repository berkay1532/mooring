/**
 * DNS-rebinding defence: an undici dispatcher whose connections can only go
 * to addresses the SSRF guard already validated. This is the only module that
 * imports undici.
 */
import { isIP } from "node:net"
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici"

type LookupCallback = (
  err: Error | null,
  address: string | Array<{ address: string; family: number }>,
  family?: number,
) => void

/**
 * Builds a `net`-style lookup function that answers only for `hostname`,
 * with the pinned `addresses`; any other hostname is an error.
 */
export function pinnedLookup(hostname: string, addresses: string[]) {
  return (
    host: string,
    options: { all?: boolean } | undefined,
    callback: LookupCallback,
  ): void => {
    if (host.toLowerCase() !== hostname.toLowerCase() || addresses.length === 0) {
      callback(new Error("host is not pinned"), "")
      return
    }
    const entries = addresses.map((address) => ({ address, family: isIP(address) === 6 ? 6 : 4 }))
    if (options?.all) {
      callback(null, entries)
      return
    }
    callback(null, entries[0].address, entries[0].family)
  }
}

/** A fresh undici Agent that connects to `hostname` only via `addresses`. */
export function pinnedDispatcher(hostname: string, addresses: string[]): Dispatcher {
  return new Agent({ connect: { lookup: pinnedLookup(hostname, addresses) as never } })
}

/** undici's `fetch`, which honours the `dispatcher` init option. */
export const pinnedFetch = undiciFetch as unknown as typeof globalThis.fetch

/** Closes a dispatcher built by `pinnedDispatcher`. */
export async function closePinned(dispatcher: unknown): Promise<void> {
  await (dispatcher as Dispatcher).close()
}
