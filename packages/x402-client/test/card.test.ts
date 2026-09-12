import { describe, expect, it } from "vitest";
import { Address, xdr } from "@stellar/stellar-sdk";
import { normalizeInfo, normalizeMerchants, type RawCardInfo } from "../src/card.js";

const OWNER = "GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD";
const TOKEN = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const MERCHANT = "GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG";

// Shaped exactly as `scValToNative` hands back the contract's `CardInfo`:
// `BytesN<32>` as a node Buffer, `u32` as a number, `u64`/`i128` as bigints.
const raw = (over: Partial<RawCardInfo> = {}): RawCardInfo => ({
  owner: OWNER,
  signer: Buffer.alloc(32, 7),
  token: TOKEN,
  policy: {
    period_amount: 100_000_000n,
    period_duration: 86_400n,
    max_per_tx: 100_000_000n,
    expiry: 1_791_498_217n,
  },
  state: 0,
  period: { start: 1_789_165_817n, spent: 0n },
  remaining: 100_000_000n,
  balance: 110_000_000n,
  allow_count: 1,
  ...over,
});

describe("normalizeInfo", () => {
  it("converts the signer to a 32-byte Uint8Array and leaves the bigints alone", () => {
    const info = normalizeInfo(raw());

    expect(info.signer).toBeInstanceOf(Uint8Array);
    expect(Buffer.isBuffer(info.signer)).toBe(false);
    expect(info.signer.length).toBe(32);
    expect([...info.signer]).toEqual(new Array(32).fill(7));

    expect(info.owner).toBe(OWNER);
    expect(info.token).toBe(TOKEN);
    expect(info.policy).toEqual({
      period_amount: 100_000_000n,
      period_duration: 86_400n,
      max_per_tx: 100_000_000n,
      expiry: 1_791_498_217n,
    });
    expect(info.period).toEqual({ start: 1_789_165_817n, spent: 0n });
    expect(info.remaining).toBe(100_000_000n);
    expect(info.balance).toBe(110_000_000n);
    expect(typeof info.remaining).toBe("bigint");
    expect(typeof info.policy.expiry).toBe("bigint");
  });

  it("narrows every known state and forces allow_count to a number", () => {
    expect(normalizeInfo(raw({ state: 0 })).state).toBe(0);
    expect(normalizeInfo(raw({ state: 1 })).state).toBe(1);
    expect(normalizeInfo(raw({ state: 2 })).state).toBe(2);

    const info = normalizeInfo(raw({ allow_count: "3" as unknown as number }));
    expect(info.allow_count).toBe(3);
    expect(typeof info.allow_count).toBe("number");
  });

  it("rejects a state outside the contract's three variants", () => {
    expect(() => normalizeInfo(raw({ state: 3 }))).toThrow(/Unknown card state: 3/);
    expect(() => normalizeInfo(raw({ state: -1 }))).toThrow(/Unknown card state/);
  });

  it("accepts a Uint8Array signer as well as a Buffer", () => {
    const signer = new Uint8Array(32).fill(9);
    const info = normalizeInfo(raw({ signer }));
    expect(info.signer).toBeInstanceOf(Uint8Array);
    expect([...info.signer]).toEqual([...signer]);
  });
});

describe("normalizeMerchants", () => {
  it("passes strkeys through unchanged", () => {
    expect(normalizeMerchants([MERCHANT, TOKEN])).toEqual([MERCHANT, TOKEN]);
  });

  it("renders raw ScAddress values as strkeys", () => {
    const scAddresses: xdr.ScAddress[] = [
      Address.fromString(MERCHANT).toScAddress(),
      Address.fromString(TOKEN).toScAddress(),
    ];
    expect(normalizeMerchants(scAddresses)).toEqual([MERCHANT, TOKEN]);
  });

  it("returns an empty list for an empty allowlist", () => {
    expect(normalizeMerchants([])).toEqual([]);
  });
});

/**
 * Compile-time guard (checked by `npm run typecheck`): the published card
 * types must not mention node's `Buffer`, or the package cannot be consumed
 * from a browser build. `scValToNative` hands back a `Buffer` at runtime,
 * which is a `Uint8Array` and so still assignable.
 */
type WithoutBuffer<T> = [Extract<T, Buffer>] extends [never] ? true : false;
const _signerIsBufferFree: WithoutBuffer<RawCardInfo["signer"]> = true;
void _signerIsBufferFree;
