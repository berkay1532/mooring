import { contractInstanceKey, deriveCardAddress, saltBytes } from "./derive";
import type { LedgerEntriesRpc } from "./rpc";

export interface DiscoverCardsOptions {
  rpc: LedgerEntriesRpc;
  factory: string;
  passphrase: string;
  /** Never probes past this many salts. Default 32. */
  max?: number;
  /** How many salts to probe per round. Default 8. */
  batch?: number;
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
 * Probes run in rounds of `batch` (in parallel within a round), and never
 * more than `max` salts total. The result is ordered by salt (0, 1, 2, ...).
 *
 * RPC failures (a network error, a malformed response) propagate to the
 * caller as a rejected promise — they are never treated as "no card here".
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

    const responses = await Promise.all(
      candidates.map((address) => rpc.getLedgerEntries(contractInstanceKey(address))),
    );

    let hitGap = false;
    for (let k = 0; k < roundSize; k++) {
      if ((responses[k]?.entries?.length ?? 0) > 0) {
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
