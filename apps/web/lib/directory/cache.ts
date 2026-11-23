/**
 * In-memory snapshot cache: fresh within `ttlMs`, served stale (while a refresh
 * runs in the background) up to `staleMs`, reloaded inline after that. `load`
 * is expected not to throw; if it does, the last snapshot is kept.
 */
export interface DirectoryCache<T> {
  get(): Promise<T>;
  /** For tests and the refresh route. */
  invalidate(): void;
}

export function createSnapshotCache<T>(opts: {
  load: () => Promise<T>;
  ttlMs: number;
  staleMs: number;
  now?: () => number;
}): DirectoryCache<T> {
  const now = opts.now ?? Date.now;
  let value: { at: number; data: T } | undefined;
  let inFlight: Promise<T> | undefined;

  const refresh = (): Promise<T> => {
    if (!inFlight) {
      inFlight = opts
        .load()
        .then((data) => {
          value = { at: now(), data };
          return data;
        })
        .finally(() => {
          inFlight = undefined;
        });
    }
    return inFlight;
  };

  return {
    async get() {
      const age = value ? now() - value.at : Infinity;
      if (value && age < opts.ttlMs) return value.data;
      if (value && age < opts.staleMs) {
        refresh().catch(() => {});
        return value.data;
      }
      if (value) {
        try {
          return await refresh();
        } catch {
          return value.data;
        }
      }
      return refresh();
    },
    invalidate() {
      value = undefined;
    },
  };
}
