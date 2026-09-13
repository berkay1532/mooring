import { describe, expect, it } from "vitest";
import { Card, Factory } from "../src/index.js";

describe("generated bindings", () => {
  it("exposes the card client with the label-aware surface", () => {
    const c = new Card.Client({ contractId: "CBOOOQDW4YA7JHDW4ELMKRFUUBJFBOJZGB4IXZJTHSAGUE4TWKJXUH5W", networkPassphrase: "Test SDF Network ; September 2015", rpcUrl: "http://localhost", allowHttp: true });
    for (const m of ["info", "merchants", "set_label", "set_policy", "set_signer", "freeze", "unfreeze", "cancel", "withdraw", "add_merchant", "remove_merchant", "bump"]) {
      expect(typeof (c as unknown as Record<string, unknown>)[m]).toBe("function");
    }
    expect(Card.State.Frozen).toBe(1);
  });
  it("exposes the factory client", () => {
    const f = new Factory.Client({ contractId: "CBMSK4OSNLBEXTJWNEWX422RPVDEUNFEWADTSPECGBI26ESDYW65AUSE", networkPassphrase: "Test SDF Network ; September 2015", rpcUrl: "http://localhost", allowHttp: true });
    expect(typeof (f as unknown as Record<string, unknown>).create_card).toBe("function");
    expect(typeof (f as unknown as Record<string, unknown>).card_wasm_hash).toBe("function");
  });
});
