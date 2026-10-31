import type { ResolveResult } from "@/lib/merchants/resolve";

const UNREACHABLE: ResolveResult = {
  ok: false,
  code: "unreachable",
  message: "Could not reach the lookup service.",
};

/** Human label for a CAIP-2 network id; unknown ids are returned verbatim. */
export function networkLabel(network: string): string {
  if (network === "stellar:testnet") return "Stellar testnet";
  if (network === "stellar:pubnet") return "Stellar mainnet";
  return network;
}

/**
 * Asks the server to look up a service URL (`POST /api/resolve-merchant`).
 * A non-2xx answer that still carries the JSON result shape is returned as-is;
 * a network failure or a non-JSON body becomes an `unreachable` failure.
 */
export async function resolveMerchantUrl(
  url: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ResolveResult> {
  try {
    const res = await fetchImpl("/api/resolve-merchant", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ url }),
    });
    const body = (await res.json()) as unknown;
    if (body && typeof body === "object" && typeof (body as { ok?: unknown }).ok === "boolean") {
      return body as ResolveResult;
    }
    return UNREACHABLE;
  } catch {
    return UNREACHABLE;
  }
}
