/** Dedupe across sources, flag proxy addresses, and split a snapshot per network. */
import type { DirectoryEntry, DirectoryNetwork } from "./types";
import { SOURCE_PRIORITY, USDC_BY_NETWORK } from "./types";
import { normalizeUrl } from "./sources/common";

/** An address fronting this many hosts is treated as a proxy even if its source did not say so. */
export const PROXY_HOSTS_THRESHOLD = 25;

export function mergeEntries(lists: readonly (readonly DirectoryEntry[])[]): DirectoryEntry[] {
  const byKey = new Map<string, DirectoryEntry>();
  const rank = (e: DirectoryEntry) => SOURCE_PRIORITY.indexOf(e.source);
  for (const list of lists) {
    for (const e of list) {
      const key = `${e.network}|${e.payTo}|${normalizeUrl(e.url)}|${e.id.split("#")[1] ?? ""}`;
      const cur = byKey.get(key);
      if (!cur || rank(e) < rank(cur)) byKey.set(key, e);
    }
  }
  const merged = [...byKey.values()];
  const hosts = new Map<string, Set<string>>();
  for (const e of merged) {
    const k = `${e.network}|${e.payTo}`;
    (hosts.get(k) ?? hosts.set(k, new Set()).get(k)!).add(e.host);
  }
  return merged
    .map((e) => ({ ...e, proxy: e.proxy || (hosts.get(`${e.network}|${e.payTo}`)?.size ?? 0) >= PROXY_HOSTS_THRESHOLD }))
    .sort(byRelevance);
}

/** Verified first, then by recorded settlements, then name. */
export function byRelevance(a: DirectoryEntry, b: DirectoryEntry): number {
  if (a.verified !== b.verified) return a.verified ? -1 : 1;
  const sa = a.settlements ?? 0, sb = b.settlements ?? 0;
  if (sa !== sb) return sb - sa;
  return a.name.localeCompare(b.name);
}

/** Entries a card on `network` can pay: same network and its USDC. */
export function payableOn(entries: readonly DirectoryEntry[], network: DirectoryNetwork): DirectoryEntry[] {
  const usdc = USDC_BY_NETWORK[network];
  return entries.filter((e) => e.network === network && e.asset === usdc);
}

/** Case-insensitive match on name, host, description and tags. */
export function matches(e: DirectoryEntry, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [e.name, e.host, e.description ?? "", ...e.tags].some((s) => s.toLowerCase().includes(needle));
}
