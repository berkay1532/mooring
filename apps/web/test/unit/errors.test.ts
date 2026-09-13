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
  it("recognizes the SAC's own insufficient-balance diagnostic (#10) over the card's allowlist-full sentence", () => {
    // The real shape of a Soroban RPC simulation failure diagnostic, as
    // rendered by soroban-env-host and captured verbatim in
    // packages/x402-client/test/scheme.test.ts (same fn_call/error event
    // pair, here with the SAC's BalanceError #10 and its exact phrase).
    const usdc = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
    const card = "CBOOOQDW4YA7JHDW4ELMKRFUUBJFBOJZGB4IXZJTHSAGUE4TWKJXUH5W";
    const merchant = "CDMERCHANTEXAMPLE0000000000000000000000000000000000000";
    const t = translateError(
      new Error(
        [
          "HostError: Error(Contract, #10)",
          "",
          "Event log (newest first):",
          `   0: [Diagnostic Event] contract:${usdc}, topics:[error, Error(Contract, #10)], ` +
            `data:["balance is not sufficient to spend", 500000, 1000000]`,
          `   1: [Diagnostic Event] topics:[fn_call, ${usdc}, transfer], ` +
            `data:[${card}, ${merchant}, 1000000]`,
        ].join("\n"),
      ),
    );
    expect(t.title).toMatch(/insufficient/i);
    expect(t.title).not.toMatch(/allowlist/i);
    expect(t.code).toBe(10);
  });
  it("still maps a bare #10 with no SAC balance phrase to the card's allowlist-full sentence", () => {
    const t = translateError(new Error("HostError: Error(Contract, #10)"));
    expect(t.code).toBe(10);
    expect(t.title).toMatch(/allowlist/i);
  });
  it("resolves the #10 collision by contract identity when the token address is given", () => {
    const usdc = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
    // No SAC balance phrase in the text at all — identity alone must resolve it.
    const t = translateError(
      new Error(`HostError: Error(Contract, #10): contract:${usdc}, topics:[error, Error(Contract, #10)]`),
      { token: usdc },
    );
    expect(t.title).toMatch(/insufficient/i);
  });
  it("maps a simulation-restore message to a dedicated title", () => {
    const t = translateError(new Error("This card's state needs to be restored before it can be used."));
    expect(t.title).toMatch(/restored/i);
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
