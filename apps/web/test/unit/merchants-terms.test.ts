import { describe, expect, it } from "vitest";
import { encodePaymentRequiredHeader } from "@x402/core/http";

import { parsePaymentRequired, selectTerms } from "../../lib/merchants/terms";

const TESTNET = "stellar:testnet";
const PUBNET = "stellar:pubnet";
const TESTNET_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const PUBNET_SAC = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const PAY_A = "GBSVTVRQ4AEFRNGH2MIOOWZSAVLZKOKNKI4UAGSMBZSNRP4I3FL3ELYP";
const PAY_B = "GDK3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const entry = (over: Record<string, unknown> = {}) => ({
  scheme: "exact",
  network: TESTNET,
  asset: TESTNET_SAC,
  payTo: PAY_A,
  amount: "10000",
  maxTimeoutSeconds: 60,
  ...over,
});

function header(extra: Record<string, unknown> = {}, accepts = [
  entry({ extra: { areFeesSponsored: true } }),
  entry({ network: PUBNET, asset: PUBNET_SAC, payTo: PAY_B }),
]): string {
  return encodePaymentRequiredHeader({
    x402Version: 2,
    accepts,
    resource: { url: "https://x.test/weather", description: "Current weather for a city" },
    ...extra,
  } as never);
}

describe("parsePaymentRequired", () => {
  it("parses a v2 header and keeps resource metadata", () => {
    const p = parsePaymentRequired(header(), null)!;
    expect(p.accepts).toHaveLength(2);
    expect(p.accepts[0]).toEqual({
      scheme: "exact", network: TESTNET, asset: TESTNET_SAC, payTo: PAY_A, amount: "10000",
    });
    expect(p.service.description).toBe("Current weather for a city");
    expect(p.feesSponsored).toBe(true);
  });

  it("parses a v1 body when there is no header", () => {
    const body = JSON.stringify({
      x402Version: 1,
      accepts: [{ scheme: "exact", network: TESTNET, asset: TESTNET_SAC, payTo: PAY_A, maxAmountRequired: "10000" }],
    });
    const p = parsePaymentRequired(null, body)!;
    expect(p.accepts[0].amount).toBe("10000");
    expect(p.feesSponsored).toBeUndefined();
  });

  it("falls back to the body when the header is malformed", () => {
    const body = JSON.stringify({ accepts: [entry()] });
    expect(parsePaymentRequired("@@@", body)!.accepts).toHaveLength(1);
  });

  it("returns null for garbage", () => expect(parsePaymentRequired("@@@", "not json")).toBeNull());
  it("returns null for nothing", () => expect(parsePaymentRequired(null, null)).toBeNull());

  it("returns empty accepts for a valid document with none valid", () => {
    const p = parsePaymentRequired(null, JSON.stringify({ accepts: [] }))!;
    expect(p.accepts).toEqual([]);
  });

  it("drops entries whose amount is not an integer string", () => {
    const p = parsePaymentRequired(header({}, [entry({ amount: "0.001" }), entry()]), null)!;
    expect(p.accepts).toHaveLength(1);
    expect(p.accepts[0].amount).toBe("10000");
  });

  it("drops entries missing a field and converts safe integer numbers", () => {
    const body = JSON.stringify({ accepts: [entry({ payTo: "" }), entry({ amount: 5 }), entry({ amount: 1.5 })] });
    const p = parsePaymentRequired(null, body)!;
    expect(p.accepts.map((a) => a.amount)).toEqual(["5"]);
  });

  it("does not fall back to maxAmountRequired when amount is invalid", () => {
    const body = JSON.stringify({ accepts: [entry({ amount: "0.5", maxAmountRequired: "10" })] });
    expect(parsePaymentRequired(null, body)!.accepts).toEqual([]);
  });

  it("treats whitespace-only names as missing", () => {
    const p = parsePaymentRequired(header({ resource: { url: "u", serviceName: " \t " } }), null)!;
    expect(p.service.name).toBeUndefined();
  });

  it("caps and sanitises service strings", () => {
    const p = parsePaymentRequired(
      header({
        resource: { url: "u", serviceName: "a\u0000b" + "x".repeat(100), description: "d".repeat(400), iconUrl: "http://i.test/a.png" },
      }),
      null,
    )!;
    expect(p.service.name).toHaveLength(64);
    expect(p.service.name!.startsWith("ab")).toBe(true);
    expect(p.service.description).toHaveLength(280);
    expect(p.service.iconUrl).toBeUndefined();
  });

  it("keeps https icons and falls back to bazaar/top-level names", () => {
    const p = parsePaymentRequired(
      header({
        resource: { url: "u", iconUrl: "https://i.test/a.png" },
        extensions: { bazaar: { info: { serviceName: "Bazaar Svc" } } },
        description: "top desc",
      }),
      null,
    )!;
    expect(p.service).toEqual({ name: "Bazaar Svc", description: "top desc", iconUrl: "https://i.test/a.png" });
  });
});

describe("selectTerms", () => {
  const parsed = () => parsePaymentRequired(header(), null)!;

  it("picks the single network+asset match", () => {
    const s = selectTerms(parsed(), TESTNET, TESTNET_SAC);
    expect(s.kind === "one" && s.terms.payTo).toBe(PAY_A);
  });

  it("reports none with nothing matching", () => {
    expect(selectTerms(parsed(), "stellar:other", TESTNET_SAC)).toEqual({ kind: "none" });
  });

  it("reports many when two matches pay different addresses", () => {
    const p = parsePaymentRequired(header({}, [entry(), entry({ payTo: PAY_B })]), null)!;
    const s = selectTerms(p, TESTNET, TESTNET_SAC);
    expect(s.kind).toBe("many");
  });

  it("collapses matches with the same payTo", () => {
    const p = parsePaymentRequired(header({}, [entry(), entry({ amount: "20000" })]), null)!;
    const s = selectTerms(p, TESTNET, TESTNET_SAC);
    expect(s.kind === "one" && s.terms.amount).toBe("10000");
  });

  it("ignores non-exact schemes", () => {
    const p = parsePaymentRequired(header({}, [entry({ scheme: "upto" })]), null)!;
    expect(selectTerms(p, TESTNET, TESTNET_SAC)).toEqual({ kind: "none" });
  });
});
