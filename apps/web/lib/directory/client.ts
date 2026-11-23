import type { DirectoryNetwork, DirectoryResponse } from "./types";

/** Fetches the directory for `network` from `GET /api/directory`; throws on a non-2xx or non-JSON answer. */
export async function fetchDirectory(network: DirectoryNetwork, fetchImpl: typeof fetch = globalThis.fetch): Promise<DirectoryResponse> {
  const res = await fetchImpl(`/api/directory?network=${encodeURIComponent(network)}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`directory ${res.status}`);
  return (await res.json()) as DirectoryResponse;
}
