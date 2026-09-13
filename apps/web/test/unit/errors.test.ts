import { describe, expect, it } from "vitest";
import { translateError } from "../../lib/chain/errors";

describe("translateError", () => {
  it("maps card contract errors with their code", () => {
    const t = translateError(new Error("HostError: Error(Contract, #11)"));
    expect(t.code).toBe(11);
    expect(t.title).toMatch(/policy/i);
  });
  it("maps a Freighter rejection", () => {
    expect(translateError({ code: -4, message: "User declined access" }).title).toMatch(/declined/i);
  });
  it("maps auth failures and falls back", () => {
    expect(translateError(new Error("Error(Auth, InvalidAction)")).title).toMatch(/owner/i);
    expect(translateError(new Error("boom")).title).toMatch(/went wrong/i);
  });

  // Extra edge cases beyond the brief.
  it("maps every card contract error code to its own sentence", () => {
    for (let code = 1; code <= 13; code++) {
      const t = translateError(new Error(`Error(Contract, #${code})`));
      expect(t.code).toBe(code);
      expect(t.title.length).toBeGreaterThan(0);
    }
  });
  it("maps the on-chain label error (#13)", () => {
    const t = translateError(new Error("Error(Contract, #13)"));
    expect(t.code).toBe(13);
    expect(t.title).toMatch(/label/i);
  });
  it("recognizes a message-based Freighter rejection without a code", () => {
    expect(translateError(new Error("User declined access")).title).toMatch(/declined/i);
  });
  it("recognizes Freighter not installed / not allowed", () => {
    expect(translateError(new Error("Freighter is not installed")).title).toMatch(/freighter/i);
    expect(translateError(new Error("Freighter access has not been granted")).title).toMatch(/freighter|access/i);
  });
  it("recognizes a wrong-network mismatch", () => {
    const t = translateError(new Error("wrong network: expected TESTNET, got PUBLIC"));
    expect(t.title).toMatch(/network/i);
  });
  it("recognizes SAC insufficient balance diagnostics naming the token contract", () => {
    const t = translateError(
      new Error(
        "HostError: Error(Contract, #10): contract call failed: token contract CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA balance is not sufficient",
      ),
    );
    expect(t.title).toMatch(/insufficient|balance/i);
  });
  it("never throws on non-Error inputs", () => {
    expect(() => translateError(undefined)).not.toThrow();
    expect(() => translateError(null)).not.toThrow();
    expect(() => translateError("plain string error")).not.toThrow();
    expect(() => translateError(42)).not.toThrow();
    expect(() => translateError({})).not.toThrow();
    expect(() => translateError({ foo: "bar" })).not.toThrow();
    expect(translateError(undefined).title).toMatch(/went wrong/i);
    expect(translateError("plain string error").title.length).toBeGreaterThan(0);
  });
});
