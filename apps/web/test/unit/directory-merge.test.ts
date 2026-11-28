// @vitest-environment node
import { describe, expect, it } from "vitest";

import { byRelevance, matches, mergeEntries, payableOn, PROXY_HOSTS_THRESHOLD } from "@/lib/directory/merge";
import type { DirectoryEntry } from "@/lib/directory/types";
import { SOURCE_PRIORITY, USDC_BY_NETWORK } from "@/lib/directory/types";

const base = (over: Partial<DirectoryEntry>): DirectoryEntry => ({
  id: "x",
  source: "rail402",
  url: "https://a.example/w",
  host: "a.example",
  name: "A",
  payTo: "GA",
  network: "stellar:testnet",
  asset: USDC_BY_NETWORK["stellar:testnet"],
  amount: "1",
  scheme: "exact",
  kind: "http",
  protocol: "x402",
  tags: [],
  proxy: false,
  verified: false,
  ...over,
});

describe("mergeEntries", () => {
  it("dedupes the same network/payTo/url across sources, keeping the higher-priority source", () => {
    const a = base({ source: "stellarsight", name: "from ss" });
    const b = base({ source: "rail402", name: "from rail", url: "https://a.example/w/?utm=1" });
    const out = mergeEntries([[a], [b]]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("from rail");
  });
  it("prefers the first-party mooring source over every other source", () => {
    const rail = base({ source: "rail402", name: "from rail" });
    const mine = base({ source: "mooring", name: "from mooring" });
    const out = mergeEntries([[rail], [mine]]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("from mooring");
    expect(SOURCE_PRIORITY[0]).toBe("mooring");
  });
  it("keeps MCP tools apart by their tool suffix", () => {
    const a = base({ id: "rail402:n:GA:u#forecast", url: "https://a.example/mcp" });
    const b = base({ id: "rail402:n:GA:u#weather", url: "https://a.example/mcp" });
    expect(mergeEntries([[a, b]])).toHaveLength(2);
  });
  it("flags a payTo fronting many hosts as proxy", () => {
    const many = Array.from({ length: PROXY_HOSTS_THRESHOLD }, (_, i) =>
      base({ id: `b${i}`, host: `h${i}.example`, url: `https://h${i}.example/x`, payTo: "GPROXY" }),
    );
    const lone = base({ id: "lone", payTo: "GLONE" });
    const out = mergeEntries([[...many, lone]]);
    expect(out.filter((e) => e.payTo === "GPROXY").every((e) => e.proxy)).toBe(true);
    expect(out.find((e) => e.payTo === "GLONE")!.proxy).toBe(false);
  });
  it("sorts verified first, then by settlements, then name", () => {
    const out = [
      base({ id: "1", name: "b" }),
      base({ id: "2", name: "a" }),
      base({ id: "3", name: "c", settlements: 9 }),
      base({ id: "4", name: "d", verified: true }),
    ].sort(byRelevance);
    expect(out.map((e) => e.id)).toEqual(["4", "3", "2", "1"]);
  });
});

describe("payableOn / matches", () => {
  it("keeps only the network's USDC entries", () => {
    const ok = base({ id: "ok" });
    const wrongAsset = base({ id: "asset", asset: "CAYC" });
    const pubnet = base({ id: "pub", network: "stellar:pubnet", asset: USDC_BY_NETWORK["stellar:pubnet"] });
    expect(payableOn([ok, wrongAsset, pubnet], "stellar:testnet").map((e) => e.id)).toEqual(["ok"]);
    expect(payableOn([ok, wrongAsset, pubnet], "stellar:pubnet").map((e) => e.id)).toEqual(["pub"]);
  });
  it("matches on name, host, description and tags, case-insensitively", () => {
    const e = base({ name: "Pet Portraits", host: "try-cli.onrender.com", description: "SVG sketches", tags: ["dog"] });
    for (const q of ["pet", "ONRENDER", "svg", "dog", ""]) expect(matches(e, q)).toBe(true);
    expect(matches(e, "weather")).toBe(false);
  });
});
