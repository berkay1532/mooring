// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = "GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD";
const A = "CBI3L3KLF63F2I72ZGHVC766JZCDPBCTLQVLP7X36G5MB3DVD62CV7RY";
const B = "CAXB2N4XYXXIUJNOCJVRAHVZJD262GSBIEJRHVW6BD3GY5LGPVDVD2D5";
const C = "CBOOOQDW4YA7JHDW4ELMKRFUUBJFBOJZGB4IXZJTHSAGUE4TWKJXUH5W";

describe("loadCards (indexer first, probe fallback)", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    store.set(`mooring:${OWNER}:added`, JSON.stringify([C, A]));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses the indexer's list and appends locally-added cards it did not return", async () => {
    const { loadCards } = await import("../../lib/query/hooks");
    const probe = vi.fn();
    const r = await loadCards(OWNER, {
      indexed: async () => ({ owner: OWNER, stale: false, cards: [{ card: A, label: null, createdAt: null, createdTx: null, trackedBy: "factory" }, { card: B, label: "x", createdAt: null, createdTx: null, trackedBy: "factory" }] }),
      probe,
    });
    expect(r).toEqual({ cards: [A, B, C], source: "indexer" });
    expect(probe).not.toHaveBeenCalled();
  });

  it("falls back to the salt probe when the indexer is unavailable", async () => {
    const { loadCards } = await import("../../lib/query/hooks");
    const probe = vi.fn(async () => [A]);
    const r = await loadCards(OWNER, { indexed: async () => null, probe });
    expect(r).toEqual({ cards: [A, C], source: "probe" });
    expect(probe).toHaveBeenCalledWith(OWNER, expect.objectContaining({ factory: expect.any(String) }));
  });

  it("lets a probe failure surface instead of returning an empty list", async () => {
    const { loadCards } = await import("../../lib/query/hooks");
    await expect(loadCards(OWNER, { indexed: async () => null, probe: async () => { throw new Error("rpc"); } })).rejects.toThrow("rpc");
  });
});
