/** StellarSight (`stellarsight.xyz`): a small testnet x402 catalogue; `seeded=false` hides its demo rows. */
import type { DirectoryEntry } from "../types";
import { arr, fetchJson, num, obj, type SourceFetchDeps } from "./common";
import { fromX402Item } from "./x402";

export const STELLARSIGHT_URL = "https://stellarsight.xyz/discovery/resources?seeded=false&limit=100";

export function normalizeStellarSight(json: unknown): DirectoryEntry[] {
  return arr(obj(json)?.items).flatMap((item) =>
    fromX402Item("stellarsight", item, { settlements: num(obj(item)?.settlements) }),
  );
}

export async function fetchStellarSight(deps: SourceFetchDeps): Promise<DirectoryEntry[]> {
  return normalizeStellarSight(await fetchJson(STELLARSIGHT_URL, deps));
}
