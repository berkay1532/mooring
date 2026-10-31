import { describe, expect, it } from "vitest";
import {
  CARD_ERROR_CODES,
  CARD_ERRORS,
  CardPolicyDenied,
  DEFAULT_APP_URL,
  allowMerchantUrl,
  isAbsoluteHttpUrl,
  stripQuery,
  PaymentError,
  cardDenialFromEvents,
  classifyContractError,
} from "../src/denial.js";
import { authFailureEvents, tokenFailureEvents } from "./fixtures/events.js";

const CARD = "CAJPWJBFBM6WMYZBRURA7VW3GKSLMHTHIIZIRFVFKUSAPWX4526YAHCJ";
const OTHER_CARD = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

describe("classifyContractError", () => {
  it("maps card error codes", () => {
    expect(classifyContractError("HostError: Error(Contract, #8)\n...")).toEqual({ code: 8, reason: "over_budget" });
    expect(classifyContractError("Error(Contract, #6)")).toEqual({ code: 6, reason: "not_allowlisted" });
    expect(classifyContractError("Error(Contract, #3)")).toEqual({ code: 3, reason: "frozen" });
  });
  it("returns unknown for codes the card does not define as denials", () => {
    expect(classifyContractError("Error(Contract, #10)")).toEqual({ code: 10, reason: "unknown" });
  });
  it("returns null when no contract error is present", () => {
    expect(classifyContractError("Error(Auth, InvalidAction)")).toBeNull();
  });
  it("covers every documented denial code", () => {
    expect(Object.keys(CARD_ERROR_CODES).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("CARD_ERRORS", () => {
  it("has a sentence for every contract error code 1..13", () => {
    const codes = Object.keys(CARD_ERRORS).map(Number).sort((a, b) => a - b);
    expect(codes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    for (const code of codes) {
      expect(typeof CARD_ERRORS[code]).toBe("string");
      expect(CARD_ERRORS[code].length).toBeGreaterThan(0);
    }
  });

  it("does not narrow classifyContractError, which still maps only codes 1..8", () => {
    expect(classifyContractError("Error(Contract, #13)")).toEqual({ code: 13, reason: "unknown" });
    expect(classifyContractError("Error(Contract, #1)")).toEqual({ code: 1, reason: "bad_signature" });
  });
});

describe("CardPolicyDenied", () => {
  it("carries reason, stage and code", () => {
    const e = new CardPolicyDenied("over_budget", "verify", { contractError: 8, detail: "x" });
    expect(e.reason).toBe("over_budget");
    expect(e.stage).toBe("verify");
    expect(e.contractError).toBe(8);
    expect(e.message).toContain("over_budget");
    expect(e).toBeInstanceOf(Error);
  });
});

describe("PaymentError", () => {
  it("carries kind, transaction and detail", () => {
    const e = new PaymentError({ kind: "unconfirmed", transaction: "cafe", detail: "why" });
    expect(e.name).toBe("PaymentError");
    expect(e.kind).toBe("unconfirmed");
    expect(e.transaction).toBe("cafe");
    expect(e.detail).toBe("why");
    expect(e.message).toContain("unconfirmed");
    expect(e.message).toContain("cafe");
    expect(e.message).toContain("why");
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(CardPolicyDenied);
  });

  it("is a rejection when the facilitator refused before submitting", () => {
    const e = new PaymentError({ kind: "rejected", detail: "fee_exceeds_maximum" });
    expect(e.kind).toBe("rejected");
    expect(e.transaction).toBeUndefined();
  });
});

describe("cardDenialFromEvents", () => {
  it("reads the card's error out of the host's account-authentication event", () => {
    expect(cardDenialFromEvents(authFailureEvents(CARD, 8), CARD)).toEqual({
      code: 8,
      reason: "over_budget",
    });
  });

  it("ignores an authentication failure that is not the card's", () => {
    expect(cardDenialFromEvents(authFailureEvents(OTHER_CARD, 8), CARD)).toBeNull();
  });

  it("ignores a token-level failure that merely names the card", () => {
    expect(cardDenialFromEvents(tokenFailureEvents(CARD), CARD)).toBeNull();
  });

  it("returns null for no events at all", () => {
    expect(cardDenialFromEvents([], CARD)).toBeNull();
  });

  it("maps a code the card does not define to unknown", () => {
    expect(cardDenialFromEvents(authFailureEvents(CARD, 42), CARD)).toEqual({
      code: 42,
      reason: "unknown",
    });
  });
});

describe("stripQuery", () => {
  it("keeps origin + path of an absolute URL", () => {
    expect(stripQuery("https://api.x.dev/weather?key=SECRET#frag")).toBe("https://api.x.dev/weather");
  });

  it("cuts unparseable input at the first ? or #", () => {
    expect(stripQuery("/weather?key=SECRET")).toBe("/weather");
    expect(stripQuery("weather#frag?x")).toBe("weather");
    expect(stripQuery("api.x.dev/w?key=SECRET#f")).toBe("api.x.dev/w");
    expect(stripQuery("/plain")).toBe("/plain");
  });
});

describe("isAbsoluteHttpUrl", () => {
  it("accepts only absolute http(s) URLs", () => {
    expect(isAbsoluteHttpUrl("https://api.x.dev/w")).toBe(true);
    expect(isAbsoluteHttpUrl("http://localhost:3001/w")).toBe(true);
    expect(isAbsoluteHttpUrl("/weather")).toBe(false);
    expect(isAbsoluteHttpUrl("ftp://x/y")).toBe(false);
    expect(isAbsoluteHttpUrl("data:text/plain,hi")).toBe(false);
  });
});

describe("allowMerchantUrl and CardPolicyDenied.merchant", () => {
  it("allowMerchantUrl strips the query string and fragment", () => {
    expect(allowMerchantUrl("https://app.mooring.live/", "CBOO", "https://api.x.dev/weather?key=SECRET#frag"))
      .toBe("https://app.mooring.live/allow?card=CBOO&url=https%3A%2F%2Fapi.x.dev%2Fweather");
  });
  it("not_allowlisted with merchant.url appends the allow link to the message", () => {
    const err = new CardPolicyDenied("not_allowlisted", "precheck", {
      merchant: { payTo: "GBSV", url: "https://demo.rail402.dev/weather?x=1", amount: "10000", network: "stellar:testnet" },
      card: "CBOO", appUrl: "https://app.mooring.live",
    });
    expect(err.merchant?.payTo).toBe("GBSV");
    expect(err.message).toContain("allow it: https://app.mooring.live/allow?card=CBOO&url=https%3A%2F%2Fdemo.rail402.dev%2Fweather");
    expect(err.message).not.toContain("x=1");
  });
  it("no link without a url, and never for other reasons", () => {
    expect(new CardPolicyDenied("not_allowlisted", "simulate", { merchant: { payTo: "GBSV" }, card: "CBOO" }).message).not.toContain("allow it");
    expect(new CardPolicyDenied("over_budget", "precheck", { merchant: { payTo: "GBSV", url: "https://a.b/c" }, card: "CBOO" }).message).not.toContain("allow it");
  });
  it("falls back to the default app URL", () => {
    const err = new CardPolicyDenied("not_allowlisted", "precheck", { merchant: { payTo: "G", url: "https://a.b/c" }, card: "CBOO" });
    expect(err.message).toContain(` — allow it: ${DEFAULT_APP_URL}/allow?card=CBOO&url=`);
  });
});
