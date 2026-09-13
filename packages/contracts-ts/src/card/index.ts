import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}












/**
 * One ed25519 signature as encoded by stellar-sdk `authorizeEntry`.
 */
export interface Sig {
  public_key: Buffer;
  signature: Buffer;
}

/**
 * Lifecycle state of a card.
 */
export enum State {
  Active = 0,
  Frozen = 1,
  Cancelled = 2,
}


/**
 * Mutable accounting for the current period.
 */
export interface Period {
  spent: i128;
  start: u64;
}


/**
 * Spending policy. Set at creation and replaceable by the owner via `set_policy`.
 */
export interface Policy {
  /**
 * Unix timestamp after which no payment is authorized.
 */
expiry: u64;
  /**
 * Max amount for a single payment, in token base units.
 */
max_per_tx: i128;
  /**
 * Max total spend per period, in token base units.
 */
period_amount: i128;
  /**
 * Period length in seconds.
 */
period_duration: u64;
}

export type DataKey = {tag: "Owner", values: void} | {tag: "Signer", values: void} | {tag: "Token", values: void} | {tag: "Policy", values: void} | {tag: "Period", values: void} | {tag: "State", values: void} | {tag: "Allowlist", values: void} | {tag: "Label", values: void};


/**
 * Everything a UI needs about a card in one call. `period` and `remaining`
 * are materialized against the current ledger timestamp, so a pending period
 * reset is already reflected (unlike the raw `period()` view). `label` is
 * the owner-chosen display name (1..=32 bytes). The contract only bounds its
 * length; it is opaque bytes with no content validation, so consumers must
 * treat it as untrusted text (escape it when rendering).
 */
export interface CardInfo {
  allow_count: u32;
  balance: i128;
  label: string;
  owner: string;
  period: Period;
  policy: Policy;
  remaining: i128;
  signer: Buffer;
  state: State;
  token: string;
}

export const CardError = {
  1: {message:"BadSignature"},
  2: {message:"WrongContext"},
  3: {message:"Frozen"},
  4: {message:"Cancelled"},
  5: {message:"Expired"},
  6: {message:"NotAllowlisted"},
  7: {message:"OverPerTxCap"},
  8: {message:"OverBudget"},
  9: {message:"InvalidAmount"},
  10: {message:"AllowlistFull"},
  11: {message:"InvalidPolicy"},
  12: {message:"InvalidState"},
  13: {message:"InvalidLabel"}
}

export interface Client {
  /**
   * Construct and simulate a bump transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Anyone: extend the card's instance *and code* TTL so it does not get archived.
   */
  bump: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a info transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * One-call snapshot of the whole card, for the app. `period` and
   * `remaining` reflect a pending period reset; `balance` reads the token.
   */
  info: (options?: MethodOptions) => Promise<AssembledTransaction<CardInfo>>

  /**
   * Construct and simulate a label transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  label: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a owner transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  owner: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a state transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  state: (options?: MethodOptions) => Promise<AssembledTransaction<State>>

  /**
   * Construct and simulate a token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  token: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a cancel transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner: permanently disable the card and sweep its full balance to the owner.
   */
  cancel: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a freeze transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner: pause agent payments. Active → Frozen.
   */
  freeze: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a period transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Raw stored period (may be stale if a period boundary has passed).
   */
  period: (options?: MethodOptions) => Promise<AssembledTransaction<Period>>

  /**
   * Construct and simulate a policy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  policy: (options?: MethodOptions) => Promise<AssembledTransaction<Policy>>

  /**
   * Construct and simulate a signer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  signer: (options?: MethodOptions) => Promise<AssembledTransaction<Buffer>>

  /**
   * Construct and simulate a balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Token balance held by this card.
   */
  balance: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a unfreeze transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner: resume agent payments. Frozen → Active.
   */
  unfreeze: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner: move `amount` of the token to the owner. Allowed in any state.
   */
  withdraw: ({amount}: {amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a merchants transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The full allowlist, in insertion order.
   */
  merchants: (options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a remaining transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Budget remaining in the current period, accounting for a pending reset.
   */
  remaining: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a set_label transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner: rename the card. Renaming is an on-chain transaction.
   */
  set_label: ({label}: {label: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a is_allowed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_allowed: ({merchant}: {merchant: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a set_policy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner: replace the spending policy. The spend already made in the period
   * that applies right now is carried over and a fresh period starts at the
   * current timestamp, so a change of `period_duration` never silently
   * resets (or silently extends) the budget. If the new `period_amount` is
   * below the carried spend, `remaining()` is 0 until the period rolls.
   */
  set_policy: ({policy}: {policy: Policy}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_signer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner: rotate the agent key. Signatures by the previous key stop validating immediately.
   */
  set_signer: ({signer}: {signer: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a allow_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  allow_count: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a add_merchant transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner: allow payments to `merchant`. Idempotent (a repeat add emits no
   * event). Bounded by MAX_ALLOWLIST.
   */
  add_merchant: ({merchant}: {merchant: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a remove_merchant transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner: disallow payments to `merchant`. No-op (and no event) if absent.
   */
  remove_merchant: ({merchant}: {merchant: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {owner, signer, token, policy, label}: {owner: string, signer: Buffer, token: string, policy: Policy, label: string},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({owner, signer, token, policy, label}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAE5BbnlvbmU6IGV4dGVuZCB0aGUgY2FyZCdzIGluc3RhbmNlICphbmQgY29kZSogVFRMIHNvIGl0IGRvZXMgbm90IGdldCBhcmNoaXZlZC4AAAAAAARidW1wAAAAAAAAAAA=",
        "AAAAAAAAAIVPbmUtY2FsbCBzbmFwc2hvdCBvZiB0aGUgd2hvbGUgY2FyZCwgZm9yIHRoZSBhcHAuIGBwZXJpb2RgIGFuZApgcmVtYWluaW5nYCByZWZsZWN0IGEgcGVuZGluZyBwZXJpb2QgcmVzZXQ7IGBiYWxhbmNlYCByZWFkcyB0aGUgdG9rZW4uAAAAAAAABGluZm8AAAAAAAAAAQAAB9AAAAAIQ2FyZEluZm8=",
        "AAAAAAAAAAAAAAAFbGFiZWwAAAAAAAAAAAAAAQAAABA=",
        "AAAAAAAAAAAAAAAFb3duZXIAAAAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAAAAAAAFc3RhdGUAAAAAAAAAAAAAAQAAB9AAAAAFU3RhdGUAAAA=",
        "AAAAAAAAAAAAAAAFdG9rZW4AAAAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAExPd25lcjogcGVybWFuZW50bHkgZGlzYWJsZSB0aGUgY2FyZCBhbmQgc3dlZXAgaXRzIGZ1bGwgYmFsYW5jZSB0byB0aGUgb3duZXIuAAAABmNhbmNlbAAAAAAAAAAAAAEAAAPpAAAAAgAAB9AAAAAJQ2FyZEVycm9yAAAA",
        "AAAAAAAAAC9Pd25lcjogcGF1c2UgYWdlbnQgcGF5bWVudHMuIEFjdGl2ZSDihpIgRnJvemVuLgAAAAAGZnJlZXplAAAAAAAAAAAAAQAAA+kAAAACAAAH0AAAAAlDYXJkRXJyb3IAAAA=",
        "AAAAAAAAAEFSYXcgc3RvcmVkIHBlcmlvZCAobWF5IGJlIHN0YWxlIGlmIGEgcGVyaW9kIGJvdW5kYXJ5IGhhcyBwYXNzZWQpLgAAAAAAAAZwZXJpb2QAAAAAAAAAAAABAAAH0AAAAAZQZXJpb2QAAA==",
        "AAAAAAAAAAAAAAAGcG9saWN5AAAAAAAAAAAAAQAAB9AAAAAGUG9saWN5AAA=",
        "AAAAAAAAAAAAAAAGc2lnbmVyAAAAAAAAAAAAAQAAA+4AAAAg",
        "AAAAAAAAACBUb2tlbiBiYWxhbmNlIGhlbGQgYnkgdGhpcyBjYXJkLgAAAAdiYWxhbmNlAAAAAAAAAAABAAAACw==",
        "AAAAAAAAADBPd25lcjogcmVzdW1lIGFnZW50IHBheW1lbnRzLiBGcm96ZW4g4oaSIEFjdGl2ZS4AAAAIdW5mcmVlemUAAAAAAAAAAQAAA+kAAAACAAAH0AAAAAlDYXJkRXJyb3IAAAA=",
        "AAAAAAAAAEVPd25lcjogbW92ZSBgYW1vdW50YCBvZiB0aGUgdG9rZW4gdG8gdGhlIG93bmVyLiBBbGxvd2VkIGluIGFueSBzdGF0ZS4AAAAAAAAId2l0aGRyYXcAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAAAIAAAfQAAAACUNhcmRFcnJvcgAAAA==",
        "AAAAAAAAACdUaGUgZnVsbCBhbGxvd2xpc3QsIGluIGluc2VydGlvbiBvcmRlci4AAAAACW1lcmNoYW50cwAAAAAAAAAAAAABAAAD6gAAABM=",
        "AAAAAAAAAEdCdWRnZXQgcmVtYWluaW5nIGluIHRoZSBjdXJyZW50IHBlcmlvZCwgYWNjb3VudGluZyBmb3IgYSBwZW5kaW5nIHJlc2V0LgAAAAAJcmVtYWluaW5nAAAAAAAAAAAAAAEAAAAL",
        "AAAAAAAAADxPd25lcjogcmVuYW1lIHRoZSBjYXJkLiBSZW5hbWluZyBpcyBhbiBvbi1jaGFpbiB0cmFuc2FjdGlvbi4AAAAJc2V0X2xhYmVsAAAAAAAAAQAAAAAAAAAFbGFiZWwAAAAAAAAQAAAAAQAAA+kAAAACAAAH0AAAAAlDYXJkRXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAKaXNfYWxsb3dlZAAAAAAAAQAAAAAAAAAIbWVyY2hhbnQAAAATAAAAAQAAAAE=",
        "AAAAAAAAAV5Pd25lcjogcmVwbGFjZSB0aGUgc3BlbmRpbmcgcG9saWN5LiBUaGUgc3BlbmQgYWxyZWFkeSBtYWRlIGluIHRoZSBwZXJpb2QKdGhhdCBhcHBsaWVzIHJpZ2h0IG5vdyBpcyBjYXJyaWVkIG92ZXIgYW5kIGEgZnJlc2ggcGVyaW9kIHN0YXJ0cyBhdCB0aGUKY3VycmVudCB0aW1lc3RhbXAsIHNvIGEgY2hhbmdlIG9mIGBwZXJpb2RfZHVyYXRpb25gIG5ldmVyIHNpbGVudGx5CnJlc2V0cyAob3Igc2lsZW50bHkgZXh0ZW5kcykgdGhlIGJ1ZGdldC4gSWYgdGhlIG5ldyBgcGVyaW9kX2Ftb3VudGAgaXMKYmVsb3cgdGhlIGNhcnJpZWQgc3BlbmQsIGByZW1haW5pbmcoKWAgaXMgMCB1bnRpbCB0aGUgcGVyaW9kIHJvbGxzLgAAAAAACnNldF9wb2xpY3kAAAAAAAEAAAAAAAAABnBvbGljeQAAAAAH0AAAAAZQb2xpY3kAAAAAAAEAAAPpAAAAAgAAB9AAAAAJQ2FyZEVycm9yAAAA",
        "AAAAAAAAAFhPd25lcjogcm90YXRlIHRoZSBhZ2VudCBrZXkuIFNpZ25hdHVyZXMgYnkgdGhlIHByZXZpb3VzIGtleSBzdG9wIHZhbGlkYXRpbmcgaW1tZWRpYXRlbHkuAAAACnNldF9zaWduZXIAAAAAAAEAAAAAAAAABnNpZ25lcgAAAAAD7gAAACAAAAAA",
        "AAAAAAAAAAAAAAALYWxsb3dfY291bnQAAAAAAAAAAAEAAAAE",
        "AAAAAAAAAGhPd25lcjogYWxsb3cgcGF5bWVudHMgdG8gYG1lcmNoYW50YC4gSWRlbXBvdGVudCAoYSByZXBlYXQgYWRkIGVtaXRzIG5vCmV2ZW50KS4gQm91bmRlZCBieSBNQVhfQUxMT1dMSVNULgAAAAxhZGRfbWVyY2hhbnQAAAABAAAAAAAAAAhtZXJjaGFudAAAABMAAAABAAAD6QAAAAIAAAfQAAAACUNhcmRFcnJvcgAAAA==",
        "AAAABQAAAAAAAAAAAAAACVdpdGhkcmF3bgAAAAAAAAEAAAAJd2l0aGRyYXduAAAAAAAAAgAAAAAAAAACdG8AAAAAABMAAAAAAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==",
        "AAAAAAAAAEZEZXBsb3ktdGltZSBpbml0aWFsaXphdGlvbi4gUnVucyBleGFjdGx5IG9uY2UgKGNvbnN0cnVjdG9yIHNlbWFudGljcykuAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAUAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAAGc2lnbmVyAAAAAAPuAAAAIAAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAAZwb2xpY3kAAAAAB9AAAAAGUG9saWN5AAAAAAAAAAAABWxhYmVsAAAAAAAAEAAAAAA=",
        "AAAAAAAAAEdPd25lcjogZGlzYWxsb3cgcGF5bWVudHMgdG8gYG1lcmNoYW50YC4gTm8tb3AgKGFuZCBubyBldmVudCkgaWYgYWJzZW50LgAAAAAPcmVtb3ZlX21lcmNoYW50AAAAAAEAAAAAAAAACG1lcmNoYW50AAAAEwAAAAA=",
        "AAAABQAAAAAAAAAAAAAADExhYmVsQ2hhbmdlZAAAAAEAAAANbGFiZWxfY2hhbmdlZAAAAAAAAAEAAAAAAAAABWxhYmVsAAAAAAAAEAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADFN0YXRlQ2hhbmdlZAAAAAEAAAANc3RhdGVfY2hhbmdlZAAAAAAAAAEAAAAAAAAABXN0YXRlAAAAAAAH0AAAAAVTdGF0ZQAAAAAAAAAAAAAC",
        "AAAABQAAADxgbWVyY2hhbnRgIGlzIGEgdG9waWMgc28gdGhlIGFwcCBjYW4gc3Vic2NyaWJlIHBlciBtZXJjaGFudC4AAAAAAAAADU1lcmNoYW50QWRkZWQAAAAAAAABAAAADm1lcmNoYW50X2FkZGVkAAAAAAABAAAAAAAAAAhtZXJjaGFudAAAABMAAAABAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADVBvbGljeUNoYW5nZWQAAAAAAAABAAAADnBvbGljeV9jaGFuZ2VkAAAAAAABAAAAAAAAAAZwb2xpY3kAAAAAB9AAAAAGUG9saWN5AAAAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADVNpZ25lckNoYW5nZWQAAAAAAAABAAAADnNpZ25lcl9jaGFuZ2VkAAAAAAABAAAAAAAAAAZzaWduZXIAAAAAA+4AAAAgAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAD01lcmNoYW50UmVtb3ZlZAAAAAABAAAAEG1lcmNoYW50X3JlbW92ZWQAAAABAAAAAAAAAAhtZXJjaGFudAAAABMAAAABAAAAAg==",
        "AAAAAAAAAPlBdXRob3JpemF0aW9uIGJvdW5kYXJ5IGZvciBldmVyeSBhY3Rpb24gdGFrZW4gKmFzKiB0aGUgY2FyZC4KQWNjZXB0cyBleGFjdGx5IG9uZSBhZ2VudCBzaWduYXR1cmUgb3ZlciBleGFjdGx5IG9uZSBjb250ZXh0OgpgdG9rZW4udHJhbnNmZXIoc2VsZiwgdG8sIGFtb3VudClgLiBFdmVyeXRoaW5nIGVsc2UgaXMgcmVqZWN0ZWQuCk11c3Qgbm90IGVtaXQgZXZlbnRzICh4NDAyIGZhY2lsaXRhdG9yIHJlamVjdHMgZXh0cmEgZXZlbnRzKS4AAAAAAAAMX19jaGVja19hdXRoAAAAAwAAAAAAAAARc2lnbmF0dXJlX3BheWxvYWQAAAAAAAPuAAAAIAAAAAAAAAAKc2lnbmF0dXJlcwAAAAAD6gAAB9AAAAADU2lnAAAAAAAAAAANYXV0aF9jb250ZXh0cwAAAAAAA+oAAAfQAAAAB0NvbnRleHQAAAAAAQAAA+kAAAACAAAH0AAAAAlDYXJkRXJyb3IAAAA=",
        "AAAAAQAAAEFPbmUgZWQyNTUxOSBzaWduYXR1cmUgYXMgZW5jb2RlZCBieSBzdGVsbGFyLXNkayBgYXV0aG9yaXplRW50cnlgLgAAAAAAAAAAAAADU2lnAAAAAAIAAAAAAAAACnB1YmxpY19rZXkAAAAAA+4AAAAgAAAAAAAAAAlzaWduYXR1cmUAAAAAAAPuAAAAQA==",
        "AAAAAwAAABpMaWZlY3ljbGUgc3RhdGUgb2YgYSBjYXJkLgAAAAAAAAAAAAVTdGF0ZQAAAAAAAAMAAAAAAAAABkFjdGl2ZQAAAAAAAAAAAAAAAAAGRnJvemVuAAAAAAABAAAAAAAAAAlDYW5jZWxsZWQAAAAAAAAC",
        "AAAAAQAAACpNdXRhYmxlIGFjY291bnRpbmcgZm9yIHRoZSBjdXJyZW50IHBlcmlvZC4AAAAAAAAAAAAGUGVyaW9kAAAAAAACAAAAAAAAAAVzcGVudAAAAAAAAAsAAAAAAAAABXN0YXJ0AAAAAAAABg==",
        "AAAAAQAAAE9TcGVuZGluZyBwb2xpY3kuIFNldCBhdCBjcmVhdGlvbiBhbmQgcmVwbGFjZWFibGUgYnkgdGhlIG93bmVyIHZpYSBgc2V0X3BvbGljeWAuAAAAAAAAAAAGUG9saWN5AAAAAAAEAAAANFVuaXggdGltZXN0YW1wIGFmdGVyIHdoaWNoIG5vIHBheW1lbnQgaXMgYXV0aG9yaXplZC4AAAAGZXhwaXJ5AAAAAAAGAAAANU1heCBhbW91bnQgZm9yIGEgc2luZ2xlIHBheW1lbnQsIGluIHRva2VuIGJhc2UgdW5pdHMuAAAAAAAACm1heF9wZXJfdHgAAAAAAAsAAAAwTWF4IHRvdGFsIHNwZW5kIHBlciBwZXJpb2QsIGluIHRva2VuIGJhc2UgdW5pdHMuAAAADXBlcmlvZF9hbW91bnQAAAAAAAALAAAAGVBlcmlvZCBsZW5ndGggaW4gc2Vjb25kcy4AAAAAAAAPcGVyaW9kX2R1cmF0aW9uAAAAAAY=",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAACAAAAAAAAAAAAAAABU93bmVyAAAAAAAAAAAAAAAAAAAGU2lnbmVyAAAAAAAAAAAAAAAAAAVUb2tlbgAAAAAAAAAAAAAAAAAABlBvbGljeQAAAAAAAAAAAAAAAAAGUGVyaW9kAAAAAAAAAAAAAAAAAAVTdGF0ZQAAAAAAAAAAAAAAAAAACUFsbG93bGlzdAAAAAAAAAAAAAAAAAAABUxhYmVsAAAA",
        "AAAAAQAAAaZFdmVyeXRoaW5nIGEgVUkgbmVlZHMgYWJvdXQgYSBjYXJkIGluIG9uZSBjYWxsLiBgcGVyaW9kYCBhbmQgYHJlbWFpbmluZ2AKYXJlIG1hdGVyaWFsaXplZCBhZ2FpbnN0IHRoZSBjdXJyZW50IGxlZGdlciB0aW1lc3RhbXAsIHNvIGEgcGVuZGluZyBwZXJpb2QKcmVzZXQgaXMgYWxyZWFkeSByZWZsZWN0ZWQgKHVubGlrZSB0aGUgcmF3IGBwZXJpb2QoKWAgdmlldykuIGBsYWJlbGAgaXMKdGhlIG93bmVyLWNob3NlbiBkaXNwbGF5IG5hbWUgKDEuLj0zMiBieXRlcykuIFRoZSBjb250cmFjdCBvbmx5IGJvdW5kcyBpdHMKbGVuZ3RoOyBpdCBpcyBvcGFxdWUgYnl0ZXMgd2l0aCBubyBjb250ZW50IHZhbGlkYXRpb24sIHNvIGNvbnN1bWVycyBtdXN0CnRyZWF0IGl0IGFzIHVudHJ1c3RlZCB0ZXh0IChlc2NhcGUgaXQgd2hlbiByZW5kZXJpbmcpLgAAAAAAAAAAAAhDYXJkSW5mbwAAAAoAAAAAAAAAC2FsbG93X2NvdW50AAAAAAQAAAAAAAAAB2JhbGFuY2UAAAAACwAAAAAAAAAFbGFiZWwAAAAAAAAQAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAABnBlcmlvZAAAAAAH0AAAAAZQZXJpb2QAAAAAAAAAAAAGcG9saWN5AAAAAAfQAAAABlBvbGljeQAAAAAAAAAAAAlyZW1haW5pbmcAAAAAAAALAAAAAAAAAAZzaWduZXIAAAAAA+4AAAAgAAAAAAAAAAVzdGF0ZQAAAAAAB9AAAAAFU3RhdGUAAAAAAAAAAAAABXRva2VuAAAAAAAAEw==",
        "AAAABAAAAAAAAAAAAAAACUNhcmRFcnJvcgAAAAAAAA0AAAAAAAAADEJhZFNpZ25hdHVyZQAAAAEAAAAAAAAADFdyb25nQ29udGV4dAAAAAIAAAAAAAAABkZyb3plbgAAAAAAAwAAAAAAAAAJQ2FuY2VsbGVkAAAAAAAABAAAAAAAAAAHRXhwaXJlZAAAAAAFAAAAAAAAAA5Ob3RBbGxvd2xpc3RlZAAAAAAABgAAAAAAAAAMT3ZlclBlclR4Q2FwAAAABwAAAAAAAAAKT3ZlckJ1ZGdldAAAAAAACAAAAAAAAAANSW52YWxpZEFtb3VudAAAAAAAAAkAAAAAAAAADUFsbG93bGlzdEZ1bGwAAAAAAAAKAAAAAAAAAA1JbnZhbGlkUG9saWN5AAAAAAAACwAAAAAAAAAMSW52YWxpZFN0YXRlAAAADAAAAAAAAAAMSW52YWxpZExhYmVsAAAADQ==" ]),
      options
    )
  }
  public readonly fromJSON = {
    bump: this.txFromJSON<null>,
        info: this.txFromJSON<CardInfo>,
        label: this.txFromJSON<string>,
        owner: this.txFromJSON<string>,
        state: this.txFromJSON<State>,
        token: this.txFromJSON<string>,
        cancel: this.txFromJSON<Result<void>>,
        freeze: this.txFromJSON<Result<void>>,
        period: this.txFromJSON<Period>,
        policy: this.txFromJSON<Policy>,
        signer: this.txFromJSON<Buffer>,
        balance: this.txFromJSON<i128>,
        unfreeze: this.txFromJSON<Result<void>>,
        withdraw: this.txFromJSON<Result<void>>,
        merchants: this.txFromJSON<Array<string>>,
        remaining: this.txFromJSON<i128>,
        set_label: this.txFromJSON<Result<void>>,
        is_allowed: this.txFromJSON<boolean>,
        set_policy: this.txFromJSON<Result<void>>,
        set_signer: this.txFromJSON<null>,
        allow_count: this.txFromJSON<u32>,
        add_merchant: this.txFromJSON<Result<void>>,
        remove_merchant: this.txFromJSON<null>
  }
}