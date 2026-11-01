import { describe, expect, it } from "vitest";

import { describeTerms } from "../../lib/merchants/describe";

const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const OTHER = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const PAY = "GBSVTVRQ4AEFRNGH2MIOOWZSAVLZKOKNKI4UAGSMBZSNRP4I3FL3ELYP";

describe("describeTerms", () => {
  it("names the other networks when none is the card's", () => {
    const r = describeTerms(
      [
        { network: "stellar:pubnet", asset: OTHER, payTo: PAY, scheme: "exact" },
        { network: "eip155:8453", asset: "0xabc", payTo: PAY, scheme: "exact" },
      ],
      "stellar:testnet",
      USDC,
    );
    expect(r.message).toBe("This service accepts Stellar mainnet, eip155:8453; this card holds Stellar testnet USDC.");
    expect(r.lines).toEqual(["Stellar mainnet · token CCW6…MI75 → GBSV…ELYP", "eip155:8453 · token 0xabc → GBSV…ELYP"]);
  });

  it("says a different token or scheme when the network matches but nothing is payable", () => {
    const token = describeTerms([{ network: "stellar:testnet", asset: OTHER, payTo: PAY, scheme: "exact" }], "stellar:testnet", USDC);
    expect(token.message).toBe("This service asks for a different token or scheme on Stellar testnet; this card holds USDC.");
    expect(token.lines).toEqual(["Stellar testnet · token CCW6…MI75 → GBSV…ELYP"]);
    const scheme = describeTerms([{ network: "stellar:testnet", asset: USDC, payTo: PAY, scheme: "upto" }], "stellar:testnet", USDC);
    expect(scheme.message).toBe(token.message);
    expect(scheme.lines).toEqual(["Stellar testnet · USDC → GBSV…ELYP"]);
  });
});
