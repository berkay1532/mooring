// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { createSnapshotCache } from "@/lib/directory/cache";

describe("createSnapshotCache", () => {
  it("loads once while fresh, serves stale and refreshes in the background, reloads inline after staleMs", async () => {
    let t = 0;
    let n = 0;
    const load = vi.fn(async () => ++n);
    const cache = createSnapshotCache({ load, ttlMs: 100, staleMs: 1000, now: () => t });
    expect(await cache.get()).toBe(1);
    expect(await cache.get()).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);
    t = 150; // stale: old value now, refresh kicked off
    expect(await cache.get()).toBe(1);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0));
    expect(await cache.get()).toBe(2);
    t = 2000; // past staleMs: inline reload
    expect(await cache.get()).toBe(3);
  });
  it("keeps the last snapshot when a reload throws and coalesces concurrent loads", async () => {
    let fail = false;
    let t = 0;
    const load = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      if (fail) throw new Error("boom");
      return "ok";
    });
    const cache = createSnapshotCache({ load, ttlMs: 10, staleMs: 20, now: () => t });
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    expect([a, b]).toEqual(["ok", "ok"]);
    expect(load).toHaveBeenCalledTimes(1);
    fail = true;
    t = 100;
    expect(await cache.get()).toBe("ok");
  });
});
