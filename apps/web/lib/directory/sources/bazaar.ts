/**
 * The CDP x402 Bazaar: ~40k resources across every chain, no network filter,
 * 1000 per page. Only `accepts[]` on `stellar:*` are kept. A full scan is ~40
 * requests of ~3 MB, so it runs under a page budget and is off by default
 * (`MOORING_DIRECTORY_BAZAAR=1`) until the indexer worker takes it over.
 */
import type { DirectoryEntry } from "../types";
import { arr, fetchJson, obj, type SourceFetchDeps } from "./common";
import { fromX402Item } from "./x402";

export const BAZAAR_URL = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";
const PAGE = 1000;

export function normalizeBazaar(json: unknown): DirectoryEntry[] {
  return arr(obj(json)?.items).flatMap((item) => {
    const accepts = arr(obj(item)?.accepts).filter((a) => String(obj(a)?.network ?? "").startsWith("stellar:"));
    if (!accepts.length) return [];
    return fromX402Item("bazaar", { ...(obj(item) as object), accepts });
  });
}

export async function fetchBazaar(deps: SourceFetchDeps & { maxPages?: number }): Promise<DirectoryEntry[]> {
  const out: DirectoryEntry[] = [];
  const maxPages = deps.maxPages ?? 45;
  for (let page = 0; page < maxPages; page++) {
    const json = await fetchJson(`${BAZAAR_URL}?limit=${PAGE}&offset=${page * PAGE}`, { ...deps, maxBytes: 8 * 1024 * 1024 });
    out.push(...normalizeBazaar(json));
    if (arr(obj(json)?.items).length < PAGE) break;
  }
  return out;
}
