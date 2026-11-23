import type { DirectoryNetwork, DirectoryResponse } from "./types";

/** Fetches the directory for `network` from `GET /api/directory`; throws on a non-2xx or non-JSON answer. */
export async function fetchDirectory(network: DirectoryNetwork, fetchImpl: typeof fetch = globalThis.fetch): Promise<DirectoryResponse> {
  const res = await fetchImpl(`/api/directory?network=${encodeURIComponent(network)}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`directory ${res.status}`);
  return (await res.json()) as DirectoryResponse;
}

/** What `BrowseServices` needs: a function that resolves to the directory response. */
export type DirectoryLoader = () => Promise<DirectoryResponse>;

const TTL_MS = 10 * 60 * 1000;
const memo = new Map<string, { at: number; p: Promise<DirectoryResponse> }>();

/**
 * `fetchDirectory`, memoised per network for ten minutes so opening the
 * resolver on several screens does not refetch; a failed load is forgotten so
 * the next open retries.
 */
export function loadDirectory(network: DirectoryNetwork, fetchImpl?: typeof fetch): Promise<DirectoryResponse> {
  const hit = memo.get(network);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
  const p = fetchDirectory(network, fetchImpl).catch((err: unknown) => {
    memo.delete(network);
    throw err;
  });
  memo.set(network, { at: Date.now(), p });
  return p;
}

/** For tests. */
export function resetDirectoryMemo(): void {
  memo.clear();
}
