// @vitest-environment node
import { describe, expect, it } from "vitest";

import bazaar from "../fixtures/directory/bazaar.json";
import mpprouter from "../fixtures/directory/mpprouter.json";
import rail402 from "../fixtures/directory/rail402.json";
import stellarsight from "../fixtures/directory/stellarsight.json";
import { normalizeBazaar } from "@/lib/directory/sources/bazaar";
import { decimalToBaseUnits, baseUnits, normalizeUrl } from "@/lib/directory/sources/common";
import { MPPROUTER_PAYTO, normalizeMppRouter } from "@/lib/directory/sources/mpprouter";
import { normalizeRail402 } from "@/lib/directory/sources/rail402";
import { normalizeStellarSight } from "@/lib/directory/sources/stellarsight";
import { USDC_BY_NETWORK } from "@/lib/directory/types";

describe("Rail402 normaliser", () => {
  const entries = normalizeRail402(rail402);
  it("yields one entry per Stellar accept, both networks, with the x402 fields", () => {
    expect(entries.map((e) => [e.url, e.network])).toEqual([
      ["https://demo.rail402.dev/weather", "stellar:testnet"],
      ["https://demo.rail402.dev/mcp", "stellar:testnet"],
      ["https://try-cli-1.onrender.com/sketch", "stellar:testnet"],
      ["https://demo-mainnet.rail402.dev/weather", "stellar:pubnet"],
    ]);
    const weather = entries[0];
    expect(weather).toMatchObject({
      source: "rail402",
      host: "demo.rail402.dev",
      payTo: "GBSVTVRQ4AEFRNGH2MIOOWZSAVLZKOKNKI4UAGSMBZSNRP4I3FL3ELYP",
      asset: USDC_BY_NETWORK["stellar:testnet"],
      amount: "10000",
      scheme: "exact",
      kind: "http",
      method: "GET",
      proxy: false,
    });
  });
  it("names MCP rows after the tool and reads trust/settlements from the rail402 block", () => {
    const mcp = entries[1];
    expect(mcp.kind).toBe("mcp");
    expect(mcp.name).toMatch(/· forecast$/);
    expect(mcp.id).toMatch(/#forecast$/);
    const sketch = entries[2];
    expect(sketch.name).toBe("Pet Pen Portraits");
    expect(typeof sketch.settlements).toBe("number");
    expect(sketch.verified).toBe(false); // origin_verified only
  });
  it("ignores garbage", () => {
    expect(normalizeRail402(null)).toEqual([]);
    expect(normalizeRail402({ items: [{ resource: "ftp://x", accepts: [] }, 5, { accepts: [{ network: "eip155:1" }] }] })).toEqual([]);
  });
});

describe("StellarSight normaliser", () => {
  it("keeps the live rows with their non-standard asset (the merge decides payability)", () => {
    const entries = normalizeStellarSight(stellarsight);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ source: "stellarsight", network: "stellar:testnet", name: "stellarsight-ocr", method: "POST" });
    expect(entries[0].asset).not.toBe(USDC_BY_NETWORK["stellar:testnet"]);
    expect(entries[0].tags).toContain("ocr");
  });
});

describe("MPP Router normaliser", () => {
  const entries = normalizeMppRouter(mpprouter);
  it("builds the URL from base_url + public_path, converts $ prices to base units and flags the router as proxy", () => {
    const rozo = entries.find((e) => e.id.endsWith("rozo-agent-api_pay-invoice"))!;
    expect(rozo.url).toBe("https://apiserver.mpprouter.dev/v1/services/rozo-agent-api/pay-invoice");
    expect(rozo.amount).toBe("100000");
    expect(rozo.payTo).toBe(MPPROUTER_PAYTO);
    expect(rozo.proxy).toBe(true);
    expect(rozo.network).toBe("stellar:pubnet");
    expect(rozo.asset).toBe(USDC_BY_NETWORK["stellar:pubnet"]);
  });
  it("keeps direct-settlement sellers unproxied and verified when Rozo verified them", () => {
    const mercury = entries.find((e) => e.id.includes("mercury"))!;
    expect(mercury.proxy).toBe(false);
    expect(mercury.verified).toBe(true);
    expect(mercury.amount).toBe("10000");
  });
  it("drops rows that are not payable", () => {
    expect(entries.some((e) => e.id.includes("allium"))).toBe(false);
  });
});

describe("Bazaar normaliser", () => {
  it("keeps only items with a Stellar accept and only those accepts", () => {
    const entries = normalizeBazaar(bazaar);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ source: "bazaar", network: "stellar:pubnet", amount: "10000", settlements: 13 });
  });
});

describe("helpers", () => {
  it("decimalToBaseUnits", () => {
    expect(decimalToBaseUnits("$0.010")).toBe("100000");
    expect(decimalToBaseUnits("0.0100000")).toBe("100000");
    expect(decimalToBaseUnits("1")).toBe("10000000");
    expect(decimalToBaseUnits("0.00000001")).toBeUndefined();
    expect(decimalToBaseUnits("abc")).toBeUndefined();
  });
  it("baseUnits", () => {
    expect(baseUnits("0010000")).toBe("10000");
    expect(baseUnits(25)).toBe("25");
    expect(baseUnits("1.5")).toBeUndefined();
    expect(baseUnits("-1")).toBeUndefined();
  });
  it("normalizeUrl strips query, hash and trailing slash", () => {
    expect(normalizeUrl("https://a.b/c/?x=1#f")).toBe("https://a.b/c");
  });
});
