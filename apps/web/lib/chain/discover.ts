import { contractInstanceKey, deriveCardAddress, saltBytes } from "./derive";
import type { LedgerEntriesRpc } from "./rpc";

export interface DiscoverCardsOptions {
  rpc: LedgerEntriesRpc;
  factory: string;
  passphrase: string;
  /** Never probes past this many salts. Default 32. */
  max?: number;
  /** How many salts to probe per round — one `getLedgerEntries` call. Default 8. */
  batch?: number;
}

/**
 * The base64 XDR of a returned ledger entry's key, or `null` if the entry
 * does not carry one. `getLedgerEntries` answers only for the keys that
 * exist, in no guaranteed order, so the key is how a returned entry is
 * matched back to the salt that asked for it.
 */
function entryKeyBase64(entry: unknown): string | null {
  const key = (entry as { key?: { toXDR?: (format: string) => string } } | null)?.key;
  if (key && typeof key.toXDR === "function") return key.toXDR("base64");
  return null;
}

/**
 * Discovers `owner`'s cards by probing deterministic salts (0, 1, 2, ...)
 * for a deployed contract instance.
 *
 * `create_card` is always invoked with the next unused salt (see
 * `contracts/factory/src/lib.rs`), so an owner's cards are dense from salt 0
 * with no holes — the first missing salt is therefore the end of the list,
 * not just a hole in it. Probing stops there rather than scanning to `max`.
 *
 * Each round asks for `batch` keys in a single `getLedgerEntries` call (the
 * RPC method takes a key array), and never probes more than `max` salts in
 * total. The result is ordered by salt (0, 1, 2, ...).
 *
 * Failures are never read as "no card here": an RPC/network error rejects,
 * and so does a response that resolved without an `entries` array — an
 * absent card is an empty `entries`, never a missing one.
 */
export async function discoverCards(
  owner: string,
  { rpc, factory, passphrase, max = 32, batch = 8 }: DiscoverCardsOptions,
): Promise<string[]> {
  const found: string[] = [];
  let next = 0;

  while (next < max) {
    const roundSize = Math.min(batch, max - next);
    const candidates = Array.from({ length: roundSize }, (_, k) =>
      deriveCardAddress(owner, saltBytes(next + k), factory, passphrase),
    );
    const keys = candidates.map((address) => contractInstanceKey(address));

    const response = await rpc.getLedgerEntries(...keys);
    if (!Array.isArray(response?.entries)) {
      throw new Error("Malformed getLedgerEntries response: no entries array");
    }
    const present = new Set(
      response.entries.map(entryKeyBase64).filter((key): key is string => key !== null),
    );

    let hitGap = false;
    for (let k = 0; k < roundSize; k++) {
      if (present.has(keys[k].toXDR("base64"))) {
        found.push(candidates[k]);
      } else {
        hitGap = true;
        break;
      }
    }
    if (hitGap) break;
    next += roundSize;
  }

  return found;
}
