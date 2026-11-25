/**
 * Browser-side client for the indexer API. Every call returns `null` when the
 * indexer is unavailable (503 without a database, network error, non-2xx), so
 * callers fall back to the on-chain probe / localStorage without branching on
 * error types. `fetchImpl` is injectable for tests.
 */
import type { ActivityRow, MerchantRow } from "./store";

export interface IndexedCard {
  card: string;
  label: string | null;
  createdAt: string | null;
  createdTx: string | null;
  trackedBy: "factory" | "manual";
}

export interface CardsResponse {
  owner: string;
  cards: IndexedCard[];
  stale: boolean;
}

export type ActivityItem = ActivityRow & { merchantName: string | null };

export interface ActivityResponse {
  card: string;
  items: ActivityItem[];
  nextCursor: string | null;
  stale: boolean;
}

export interface MerchantsResponse {
  card: string;
  merchants: MerchantRow[];
}

type Fetch = typeof globalThis.fetch;

async function getJson<T>(url: string, fetchImpl: Fetch): Promise<T | null> {
  try {
    const res = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function fetchIndexedCards(owner: string, fetchImpl: Fetch = fetch): Promise<CardsResponse | null> {
  return getJson<CardsResponse>(`/api/cards?owner=${encodeURIComponent(owner)}`, fetchImpl);
}

export function fetchActivity(card: string, cursor?: string | null, fetchImpl: Fetch = fetch): Promise<ActivityResponse | null> {
  const qs = new URLSearchParams({ limit: "25", ...(cursor ? { cursor } : {}) });
  return getJson<ActivityResponse>(`/api/cards/${encodeURIComponent(card)}/activity?${qs}`, fetchImpl);
}

export function fetchIndexedMerchants(card: string, fetchImpl: Fetch = fetch): Promise<MerchantsResponse | null> {
  return getJson<MerchantsResponse>(`/api/cards/${encodeURIComponent(card)}/merchants`, fetchImpl);
}

/** Verified server-side against the live 402; resolves to the stored name or null. */
export async function postMerchantLabel(
  card: string,
  payTo: string,
  url: string,
  fetchImpl: Fetch = fetch,
): Promise<{ name: string; url: string } | null> {
  try {
    const res = await fetchImpl(`/api/cards/${encodeURIComponent(card)}/merchants/${encodeURIComponent(payTo)}/label`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { name: string; url: string };
    return { name: body.name, url: body.url };
  } catch {
    return null;
  }
}

/** Registers a manually added card so its history is indexed. Fire-and-forget safe. */
export async function trackCard(card: string, fetchImpl: Fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`/api/cards/${encodeURIComponent(card)}/track`, { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}
