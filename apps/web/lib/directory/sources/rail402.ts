/** Rail402's Stellar bazaar (`testnet.rail402.dev`): testnet and pubnet sellers in one catalogue. */
import type { DirectoryEntry } from "../types";
import { arr, fetchJson, num, obj, str, type SourceFetchDeps, method } from "./common";
import { fromX402Item } from "./x402";

export const RAIL402_URL = "https://testnet.rail402.dev/discovery/resources";
const PAGE = 100;
const MAX_PAGES = 10;

export function normalizeRail402(json: unknown): DirectoryEntry[] {
  return arr(obj(json)?.items).flatMap((item) => {
    const meta = obj(obj(item)?.rail402);
    return fromX402Item("rail402", item, {
      verified: meta?.trust === "domain_verified",
      settlements: num(meta?.settlements),
      tool: str(meta?.toolName, 48),
      method: method(meta?.method),
    });
  });
}

export async function fetchRail402(deps: SourceFetchDeps): Promise<DirectoryEntry[]> {
  const out: DirectoryEntry[] = [];
  let asOf: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const u = new URL(RAIL402_URL);
    u.searchParams.set("limit", String(PAGE));
    u.searchParams.set("offset", String(page * PAGE));
    if (asOf) u.searchParams.set("asOf", asOf);
    const json = await fetchJson(u.toString(), deps);
    out.push(...normalizeRail402(json));
    const p = obj(obj(json)?.pagination);
    asOf = str(p?.asOf, 40) ?? asOf;
    const total = num(p?.total) ?? 0;
    if ((page + 1) * PAGE >= total || arr(obj(json)?.items).length < PAGE) break;
  }
  return out;
}
