import { getState } from "./store";
import { tick, type TickDeps, type TickOptions } from "./tick";

export interface Freshness {
  /** Whether this call ran a tick. */
  ran: boolean;
  /** True when the data served may be behind: the tick failed or another one is mid-flight. */
  stale: boolean;
  error?: string;
}

/**
 * Runs a bounded tick when the index is older than `maxAgeMs`. Never throws: a
 * read must still be answered from whatever is in the database.
 */
export async function ensureFresh(deps: TickDeps, maxAgeMs = 20_000, opts: TickOptions = {}): Promise<Freshness> {
  const now = deps.now ?? Date.now;
  try {
    const state = await getState(deps.sql);
    const age = state.last_tick ? now() - new Date(state.last_tick).getTime() : Infinity;
    if (age < maxAgeMs) return { ran: false, stale: false };
    const r = await tick(deps, opts);
    if (r.skipped) return { ran: false, stale: age > maxAgeMs * 3 };
    return { ran: true, stale: !r.caughtUp };
  } catch (e) {
    deps.log?.("indexer: ensureFresh failed", { error: e instanceof Error ? e.message : String(e) });
    return { ran: false, stale: true, error: e instanceof Error ? e.message : String(e) };
  }
}
