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






export interface Policy {
  expiry: u64;
  max_per_tx: i128;
  period_amount: i128;
  period_duration: u64;
}

export interface Client {
  /**
   * Construct and simulate a create_card transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Deploys a new card owned by `owner` with agent key `signer`.
   * 
   * The deploy salt is `sha256(owner_xdr || salt)`, so the resulting address
   * is deterministic from `(factory, owner, salt)`. Binding it to the owner
   * means a `salt` another user is about to use cannot be front-run, and it
   * lets the app enumerate one owner's cards from a salt it chose.
   * `label` is the card's owner-chosen display name, passed straight to
   * the card constructor (1..=32 bytes, validated there).
   * Emits `card_created`.
   */
  create_card: ({owner, signer, token, policy, label, salt}: {owner: string, signer: Buffer, token: string, policy: Policy, label: string, salt: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a card_wasm_hash transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  card_wasm_hash: (options?: MethodOptions) => Promise<AssembledTransaction<Buffer>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {card_wasm_hash}: {card_wasm_hash: Buffer},
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
    return ContractClient.deploy({card_wasm_hash}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAeVEZXBsb3lzIGEgbmV3IGNhcmQgb3duZWQgYnkgYG93bmVyYCB3aXRoIGFnZW50IGtleSBgc2lnbmVyYC4KClRoZSBkZXBsb3kgc2FsdCBpcyBgc2hhMjU2KG93bmVyX3hkciB8fCBzYWx0KWAsIHNvIHRoZSByZXN1bHRpbmcgYWRkcmVzcwppcyBkZXRlcm1pbmlzdGljIGZyb20gYChmYWN0b3J5LCBvd25lciwgc2FsdClgLiBCaW5kaW5nIGl0IHRvIHRoZSBvd25lcgptZWFucyBhIGBzYWx0YCBhbm90aGVyIHVzZXIgaXMgYWJvdXQgdG8gdXNlIGNhbm5vdCBiZSBmcm9udC1ydW4sIGFuZCBpdApsZXRzIHRoZSBhcHAgZW51bWVyYXRlIG9uZSBvd25lcidzIGNhcmRzIGZyb20gYSBzYWx0IGl0IGNob3NlLgpgbGFiZWxgIGlzIHRoZSBjYXJkJ3Mgb3duZXItY2hvc2VuIGRpc3BsYXkgbmFtZSwgcGFzc2VkIHN0cmFpZ2h0IHRvCnRoZSBjYXJkIGNvbnN0cnVjdG9yICgxLi49MzIgYnl0ZXMsIHZhbGlkYXRlZCB0aGVyZSkuCkVtaXRzIGBjYXJkX2NyZWF0ZWRgLgAAAAAAAAtjcmVhdGVfY2FyZAAAAAAGAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAABnNpZ25lcgAAAAAD7gAAACAAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAGcG9saWN5AAAAAAfQAAAABlBvbGljeQAAAAAAAAAAAAVsYWJlbAAAAAAAABAAAAAAAAAABHNhbHQAAAPuAAAAIAAAAAEAAAAT",
        "AAAABQAAAEBgb3duZXJgIGlzIGEgdG9waWMgc28gdGhlIGFwcCBjYW4gc3Vic2NyaWJlIHRvIG9uZSB1c2VyJ3MgY2FyZHMuAAAAAAAAAAtDYXJkQ3JlYXRlZAAAAAABAAAADGNhcmRfY3JlYXRlZAAAAAIAAAAAAAAABW93bmVyAAAAAAAAEwAAAAEAAAAAAAAABGNhcmQAAAATAAAAAAAAAAI=",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAEAAAAAAAAADmNhcmRfd2FzbV9oYXNoAAAAAAPuAAAAIAAAAAA=",
        "AAAAAAAAAAAAAAAOY2FyZF93YXNtX2hhc2gAAAAAAAAAAAABAAAD7gAAACA=",
        "AAAAAQAAAAAAAAAAAAAABlBvbGljeQAAAAAABAAAAAAAAAAGZXhwaXJ5AAAAAAAGAAAAAAAAAAptYXhfcGVyX3R4AAAAAAALAAAAAAAAAA1wZXJpb2RfYW1vdW50AAAAAAAACwAAAAAAAAAPcGVyaW9kX2R1cmF0aW9uAAAAAAY=" ]),
      options
    )
  }
  public readonly fromJSON = {
    create_card: this.txFromJSON<string>,
        card_wasm_hash: this.txFromJSON<Buffer>
  }
}