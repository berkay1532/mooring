import type { xdr } from "@stellar/stellar-sdk";
import { contractInstanceKey, deriveCardAddress, saltBytes } from "./derive.js";

/** The one RPC method discovery needs; a real `rpc.Server` satisfies it structurally. */
export interface LedgerEntriesRpc {
  getLedgerEntries(...keys: xdr.LedgerKey[]): Promise<{ entries: readonly unknown[] }>;
}

export interface DiscoverCardsOptions {
  rpc: LedgerEntriesRpc;
  factory: string;
  passphrase: string;
  /** Never probes past this many salts. Default 32. */
  max?: number;
  /** Salts per `getLedgerEntries` call. Default 8. */
  batch?: number;
}

function entryKeyBase64(entry: unknown): string | null {
  const key = (entry as { key?: { toXDR?: (format: string) => string } } | null)?.key;
  return key && typeof key.toXDR === "function" ? key.toXDR("base64") : null;
}

/**
 * `owner`'s cards at salts 0, 1, 2, … up to the first gap (the app always
 * creates at the next unused index, so the list is dense). An RPC error or a
 * malformed response throws; it is never read as "no cards".
 */
export async function discoverCards(owner: string, { rpc, factory, passphrase, max = 32, batch = 8 }: DiscoverCardsOptions): Promise<string[]> {
  const found: string[] = [];
  let next = 0;
  while (next < max) {
    const size = Math.min(batch, max - next);
    const candidates = Array.from({ length: size }, (_, k) => deriveCardAddress(owner, saltBytes(next + k), factory, passphrase));
    const keys = candidates.map(contractInstanceKey);
    const response = await rpc.getLedgerEntries(...keys);
    if (!Array.isArray(response?.entries)) throw new Error("Malformed getLedgerEntries response: no entries array");
    const present = new Set(response.entries.map(entryKeyBase64).filter((k): k is string => k !== null));
    let gap = false;
    for (let k = 0; k < size; k++) {
      if (present.has(keys[k].toXDR("base64"))) found.push(candidates[k]);
      else {
        gap = true;
        break;
      }
    }
    if (gap) break;
    next += size;
  }
  return found;
}

/** The salt index the next card for `owner` should use. */
export async function nextCardIndex(owner: string, opts: DiscoverCardsOptions): Promise<number> {
  return (await discoverCards(owner, opts)).length;
}
