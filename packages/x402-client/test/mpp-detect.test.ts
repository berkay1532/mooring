import { describe, expect, it } from "vitest";
import { detectProtocol, selectChargeChallenge } from "../src/mpp/detect.js";
import { PAY_TO, USDC_TESTNET, mppChallengeResponse, tempoChallengeResponse } from "./fixtures/mpp-challenge.js";

describe("detectProtocol", () => {
  it("detects an MPP stellar charge 402", () => {
    expect(detectProtocol(mppChallengeResponse())).toBe("mpp");
  });
  it("detects an x402 402 by header and by body", () => {
    expect(detectProtocol(new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": "e30" } }))).toBe("x402");
    expect(
      detectProtocol(
        new Response(JSON.stringify({ accepts: [] }), { status: 402, headers: { "content-type": "application/json" } }),
      ),
    ).toBe("x402");
  });
  it("is null for a plain 402, a non-402 and an unknown Payment method", () => {
    expect(detectProtocol(new Response("nope", { status: 402 }))).toBeNull();
    expect(detectProtocol(new Response("ok", { status: 200 }))).toBeNull();
    expect(detectProtocol(tempoChallengeResponse())).toBeNull();
  });
  it("never throws on a malformed WWW-Authenticate", () => {
    expect(detectProtocol(new Response(null, { status: 402, headers: { "WWW-Authenticate": "Payment garbage" } }))).toBeNull();
  });
});

describe("selectChargeChallenge", () => {
  it("returns the parsed stellar charge challenge", () => {
    const c = selectChargeChallenge(mppChallengeResponse());
    expect(c?.method).toBe("stellar");
    expect(c?.request.amount).toBe("10000");
    expect(c?.request.currency).toBe(USDC_TESTNET);
    expect(c?.request.recipient).toBe(PAY_TO);
  });
  it("is null for other responses", () => {
    expect(selectChargeChallenge(tempoChallengeResponse())).toBeNull();
    expect(selectChargeChallenge(new Response("ok", { status: 200 }))).toBeNull();
  });
});
