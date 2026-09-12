import { describe, expect, it } from "vitest";
import { precheck } from "../src/precheck.js";
import type { CardInfo } from "../src/card.js";

const USDC = 10_000_000n;
const TOKEN = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const MERCHANT = "GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG";
const NOW = 1_800_000_000;

function info(over: Partial<CardInfo> = {}): CardInfo {
  return {
    owner: "GOWNER", signer: new Uint8Array(32), token: TOKEN,
    policy: { period_amount: 50n * USDC, period_duration: 86_400n, max_per_tx: 10n * USDC, expiry: BigInt(NOW + 3600) },
    state: 0, period: { start: BigInt(NOW - 100), spent: 0n },
    remaining: 50n * USDC, balance: 20n * USDC, allow_count: 1,
    ...over,
  };
}
const req = (amount: bigint, payTo = MERCHANT, asset = TOKEN) => ({ payTo, amount: amount.toString(), asset });

describe("precheck", () => {
  it("accepts a payment within policy", () => {
    expect(precheck(info(), [MERCHANT], req(USDC), NOW)).toBeNull();
  });
  it("rejects a different asset", () => {
    expect(precheck(info(), [MERCHANT], req(USDC, MERCHANT, "CXYZ"), NOW)).toBe("wrong_token");
  });
  it("rejects frozen and cancelled", () => {
    expect(precheck(info({ state: 1 }), [MERCHANT], req(USDC), NOW)).toBe("frozen");
    expect(precheck(info({ state: 2 }), [MERCHANT], req(USDC), NOW)).toBe("cancelled");
  });
  it("rejects after expiry", () => {
    expect(precheck(info(), [MERCHANT], req(USDC), NOW + 3600)).toBe("expired");
  });
  it("rejects an unlisted merchant", () => {
    expect(precheck(info(), [MERCHANT], req(USDC, "GOTHER"), NOW)).toBe("not_allowlisted");
  });
  it("rejects over the per-tx cap", () => {
    expect(precheck(info(), [MERCHANT], req(10n * USDC + 1n), NOW)).toBe("over_per_tx_cap");
  });
  it("rejects over the remaining budget", () => {
    expect(precheck(info({ remaining: 3n * USDC }), [MERCHANT], req(4n * USDC), NOW)).toBe("over_budget");
  });
  it("rejects when the card balance is too low", () => {
    expect(precheck(info({ balance: 1n * USDC }), [MERCHANT], req(2n * USDC), NOW)).toBe("insufficient_balance");
  });
  it("checks in the documented order (state before allowlist)", () => {
    expect(precheck(info({ state: 1 }), [MERCHANT], req(USDC, "GOTHER"), NOW)).toBe("frozen");
  });
});
