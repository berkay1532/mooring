import { afterEach, describe, expect, it, vi } from "vitest";
import { Challenge } from "mppx";
import { PAY_TO, USDC, fakeChargeRpc, sellerApp } from "./fixtures.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const decode = (header: string | null) => JSON.parse(Buffer.from(header ?? "", "base64").toString());

describe("seller app", () => {
  it("GET / lists both resources with their protocols", async () => {
    const res = await sellerApp().request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: "Mooring example seller",
      network: "stellar:testnet",
      payTo: PAY_TO,
      resources: [
        { path: "/quote", protocol: "x402", amount: "10000", asset: USDC },
        { path: "/quote/mpp", protocol: "mpp", amount: "10000", asset: USDC },
      ],
      docs: "https://github.com/berkay1532/mooring/blob/main/docs/seller.md",
    });
  });

  it("GET /health answers ok without payment", async () => {
    const res = await sellerApp().request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("GET /quote answers 402 with x402 terms, then 200 with a settlement after payment", async () => {
    const app = sellerApp();
    const first = await app.request("/quote");
    expect(first.status).toBe(402);
    const required = decode(first.headers.get("payment-required"));
    expect(required.x402Version).toBe(2);
    const accepted = required.accepts[0];
    expect(accepted).toMatchObject({
      scheme: "exact",
      network: "stellar:testnet",
      payTo: PAY_TO,
      asset: USDC,
      amount: "10000",
    });

    const payment = { x402Version: 2, resource: required.resource, accepted, payload: { transaction: "AAAA" } };
    const paid = await app.request("/quote", {
      headers: { "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(payment)).toString("base64") },
    });
    expect(paid.status).toBe(200);
    const body = await paid.json();
    expect(body).toMatchObject({ paidWith: "x402", quote: expect.any(String), author: expect.any(String) });
    expect(typeof body.ts).toBe("string");
    expect(decode(paid.headers.get("payment-response"))).toMatchObject({ success: true, transaction: "abc" });
  });

  it("GET /quote/mpp answers 402 with a WWW-Authenticate Payment challenge for stellar/charge", async () => {
    const rpc = fakeChargeRpc();
    const res = await sellerApp(rpc).request("/quote/mpp");
    expect(res.status).toBe(402);
    expect(res.headers.get("WWW-Authenticate")).toMatch(/^Payment /);
    const challenge = Challenge.fromResponse(res);
    expect(challenge.method).toBe("stellar");
    expect(challenge.intent).toBe("charge");
    expect(challenge.request).toMatchObject({
      amount: "10000",
      currency: USDC,
      recipient: PAY_TO,
      methodDetails: { network: "stellar:testnet", credentialTypes: ["transaction"] },
    });
    expect(rpc.send).not.toHaveBeenCalled();
  });
});
