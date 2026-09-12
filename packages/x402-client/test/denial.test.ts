import { describe, expect, it } from "vitest";
import {
  CARD_ERROR_CODES,
  CardPolicyDenied,
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
