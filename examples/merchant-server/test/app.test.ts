import { describe, expect, it } from "vitest";
import request from "supertest";
import { createMerchantApp } from "../src/app.js";
import type { FacilitatorClient } from "@x402/core/server";

const MERCHANT = "GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

const fakeFacilitator: FacilitatorClient = {
  getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: "stellar:testnet", extra: { areFeesSponsored: true } }], extensions: [], signers: { "stellar:*": ["GFACILITATOR"] } }),
  verify: async () => ({ isValid: true }),
  settle: async () => ({ success: true, transaction: "abc", network: "stellar:testnet" }),
} as unknown as FacilitatorClient;

describe("merchant app", () => {
  const app = createMerchantApp({ network: "stellar:testnet", payTo: MERCHANT, facilitator: fakeFacilitator });

  it("serves /health without payment", async () => {
    await request(app).get("/health").expect(200);
  });

  it("answers 402 with Stellar exact terms for /weather", async () => {
    const res = await request(app).get("/weather").expect(402);
    const header = res.headers["payment-required"];
    expect(header).toBeTruthy();
    const body = JSON.parse(Buffer.from(header, "base64").toString());
    expect(body.x402Version).toBe(2);
    const accept = body.accepts[0];
    expect(accept).toMatchObject({ scheme: "exact", network: "stellar:testnet", payTo: MERCHANT, asset: USDC, amount: "10000" });
    expect(accept.extra.areFeesSponsored).toBe(true);
  });

  it("prices /premium at 20 USDC", async () => {
    const res = await request(app).get("/premium").expect(402);
    const body = JSON.parse(Buffer.from(res.headers["payment-required"], "base64").toString());
    expect(body.accepts[0].amount).toBe("200000000");
  });
});
