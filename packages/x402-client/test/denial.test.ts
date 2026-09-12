import { describe, expect, it } from "vitest";
import { CARD_ERROR_CODES, CardPolicyDenied, classifyContractError } from "../src/denial.js";

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
