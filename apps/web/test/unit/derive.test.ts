import { describe, expect, it } from "vitest";

import { deriveCardAddress, saltBytes } from "../../lib/chain/derive";

const OWNER = "GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD";
const FACTORY = "CBMSK4OSNLBEXTJWNEWX422RPVDEUNFEWADTSPECGBI26ESDYW65AUSE";
const PASS = "Test SDF Network ; September 2015";

describe("derive", () => {
  it("encodes the counter big-endian in a 32-byte salt", () => {
    const s = saltBytes(1);
    expect(s.length).toBe(32);
    expect(Array.from(s.slice(28))).toEqual([0, 0, 0, 1]);
  });

  it("matches the factory's derivation for the shared vector", () => {
    // Shared with contracts/factory/src/test.rs::derivation_vector_matches_typescript.
    // Rust is authoritative: if this ever needs to change, fix this
    // implementation, then recompute and paste the new constant into both.
    expect(deriveCardAddress(OWNER, saltBytes(1), FACTORY, PASS)).toBe(
      "CBXHE6IOGUVDJEKAHPJGFXRPYSI7H6UFWQE2AYTE5HOSEOWFEXWJ6ULP",
    );
  });

  it("derives a different address for a different salt", () => {
    expect(deriveCardAddress(OWNER, saltBytes(0), FACTORY, PASS)).not.toBe(
      deriveCardAddress(OWNER, saltBytes(1), FACTORY, PASS),
    );
  });

  it("derives a different address for a different owner", () => {
    const otherOwner = "GCWVS52A6XGOKUUSO4X7A5KBI3FWBILM4DS7JYQT3Z4K5YB7V574YEQZ";
    expect(deriveCardAddress(otherOwner, saltBytes(1), FACTORY, PASS)).not.toBe(
      deriveCardAddress(OWNER, saltBytes(1), FACTORY, PASS),
    );
  });
});
