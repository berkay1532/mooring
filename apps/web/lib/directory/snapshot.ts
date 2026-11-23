/** Loads every source, tolerating failures, into one `DirectorySnapshot`. */
import { mergeEntries } from "./merge";
import { fetchBazaar } from "./sources/bazaar";
import type { SourceFetchDeps } from "./sources/common";
import { fetchMppRouter } from "./sources/mpprouter";
import { fetchRail402 } from "./sources/rail402";
import { fetchStellarSight } from "./sources/stellarsight";
import type { DirectoryEntry, DirectorySnapshot, DirectorySource, SourceReport } from "./types";

export interface SnapshotDeps extends SourceFetchDeps {
  /** The Bazaar scan is heavy; off unless asked for. */
  bazaar?: boolean;
  now?: () => Date;
}

type Loader = (deps: SourceFetchDeps) => Promise<DirectoryEntry[]>;

export async function loadSnapshot(deps: SnapshotDeps): Promise<DirectorySnapshot> {
  const loaders: Array<[DirectorySource, Loader]> = [
    ["rail402", fetchRail402],
    ["stellarsight", fetchStellarSight],
    ["mpprouter", fetchMppRouter],
  ];
  if (deps.bazaar) loaders.push(["bazaar", (d) => fetchBazaar(d)]);
  const results = await Promise.all(
    loaders.map(async ([source, load]): Promise<[SourceReport, DirectoryEntry[]]> => {
      try {
        const entries = await load(deps);
        return [{ source, ok: true, count: entries.length }, entries];
      } catch (err) {
        return [{ source, ok: false, count: 0, error: err instanceof Error ? err.message : "failed" }, []];
      }
    }),
  );
  return {
    fetchedAt: (deps.now ?? (() => new Date()))().toISOString(),
    entries: mergeEntries(results.map(([, e]) => e)),
    sources: results.map(([r]) => r),
  };
}
