/**
 * XDR/ScVal builders for the route-intercepted Soroban RPC (see
 * `./rpc-mock.ts`).
 *
 * The app decodes a simulation's `results[0].xdr` with the SDK's own
 * `scValToNative` (`@mooring/x402-client`'s `readCardInfo`) or with the
 * generated bindings' `Spec.funcResToNative`, so the canned results here are
 * built as real `xdr.ScVal`s and serialized to base64 — never hand-written
 * strings. A contract struct is an `ScMap` keyed by symbols, which is exactly
 * what `scValToNative` turns back into a plain object.
 */
import { Address, Keypair, StrKey, xdr } from "@stellar/stellar-sdk";

/** `scvSymbol` — a contract struct's field name. */
export function sym(value: string): xdr.ScVal {
  return xdr.ScVal.scvSymbol(value);
}

/** `scvI128` from a bigint (the type every USDC amount uses). */
export function i128(value: bigint): xdr.ScVal {
  const lo = BigInt.asUintN(64, value);
  const hi = BigInt.asIntN(64, value >> 64n);
  return xdr.ScVal.scvI128(
    new xdr.Int128Parts({
      hi: xdr.Int64.fromString(hi.toString()),
      lo: xdr.Uint64.fromString(lo.toString()),
    }),
  );
}

/** `scvU64` — `Policy.expiry`, `Policy.period_duration`, `Period.start`. */
export function u64(value: bigint | number): xdr.ScVal {
  return xdr.ScVal.scvU64(xdr.Uint64.fromString(BigInt(value).toString()));
}

/** `scvU32` — `CardInfo.allow_count` and the `State` unit enum. */
export function u32(value: number): xdr.ScVal {
  return xdr.ScVal.scvU32(value);
}

/** `scvString` — the card's `label` (a Soroban `String`, not a `Symbol`). */
export function str(value: string): xdr.ScVal {
  return xdr.ScVal.scvString(value);
}

/** An `ScAddress` value for a `G…` or `C…` strkey. */
export function address(value: string): xdr.ScVal {
  return Address.fromString(value).toScVal();
}

/** `scvBytes` — the card's raw 32-byte ed25519 signer. */
export function bytes(value: Uint8Array): xdr.ScVal {
  return xdr.ScVal.scvBytes(Buffer.from(value));
}

/** `scvVec` — `merchants()` returns a vector of addresses. */
export function vec(items: xdr.ScVal[]): xdr.ScVal {
  return xdr.ScVal.scvVec(items);
}

/**
 * A contract struct as an `ScMap`. Fields are sorted by name, matching the
 * ordering the host uses, so the encoding is byte-identical to a real one.
 */
export function struct(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  return xdr.ScVal.scvMap(
    Object.keys(fields)
      .sort()
      .map((key) => new xdr.ScMapEntry({ key: sym(key), val: fields[key] })),
  );
}

/** The unit result a `Result<(), CardError>` write returns on success. */
export function unit(): xdr.ScVal {
  return xdr.ScVal.scvVoid();
}

export function toBase64(value: xdr.ScVal): string {
  return value.toXDR("base64");
}

/** The ledger key for a contract's instance entry, as base64 (the discovery probe). */
export function contractInstanceKeyB64(contract: string): string {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(contract).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent,
    }),
  ).toXDR("base64");
}

/** The ledger key the SDK's `getAccount` looks up, as base64. */
export function accountKeyB64(publicKey: string): string {
  return xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({ accountId: Keypair.fromPublicKey(publicKey).xdrPublicKey() }),
  ).toXDR("base64");
}

/** A contract-instance `LedgerEntryData`, as base64 — the body of a discovery hit. */
export function contractInstanceEntryB64(contract: string): string {
  return xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: xdr.ExtensionPoint.v0(),
      contract: Address.fromString(contract).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent,
      val: xdr.ScVal.scvContractInstance(
        new xdr.ScContractInstance({
          executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32, 7)),
          storage: null,
        }),
      ),
    }),
  ).toXDR("base64");
}

/** An account `LedgerEntryData`, as base64 — what `rpc.Server.getAccount` parses. */
export function accountEntryB64(publicKey: string, sequence: string): string {
  return xdr.LedgerEntryData.account(
    new xdr.AccountEntry({
      accountId: Keypair.fromPublicKey(publicKey).xdrAccountId(),
      balance: xdr.Int64.fromString("100000000"),
      seqNum: xdr.Int64.fromString(sequence),
      numSubEntries: 0,
      inflationDest: null,
      flags: 0,
      homeDomain: "",
      thresholds: Buffer.from([1, 0, 0, 0]),
      signers: [],
      ext: xdr.AccountEntryExt.v0(),
    }),
  ).toXDR("base64");
}

/**
 * An empty, valid `SorobanTransactionData` — `parseSuccessful` in the SDK's
 * RPC parsers feeds `transactionData` straight into `SorobanDataBuilder`, and
 * `assembleTransaction` then stamps it onto the transaction it builds.
 */
export function emptySorobanDataB64(): string {
  return new xdr.SorobanTransactionData({
    ext: xdr.SorobanTransactionDataExt.v0(),
    resources: new xdr.SorobanResources({
      footprint: new xdr.LedgerFootprint({ readOnly: [], readWrite: [] }),
      instructions: 0,
      diskReadBytes: 0,
      writeBytes: 0,
    }),
    resourceFee: xdr.Int64.fromString("0"),
  }).toXDR("base64");
}

/** A successful `TransactionResult`, as base64 — `getTransaction` parses this. */
export function successResultB64(): string {
  return new xdr.TransactionResult({
    feeCharged: xdr.Int64.fromString("100"),
    result: xdr.TransactionResultResult.txSuccess([
      xdr.OperationResult.opInner(
        xdr.OperationResultTr.invokeHostFunction(
          xdr.InvokeHostFunctionResult.invokeHostFunctionSuccess(Buffer.alloc(32)),
        ),
      ),
    ]),
    ext: xdr.TransactionResultExt.v0(),
  }).toXDR("base64");
}

/**
 * A minimal `TransactionMeta`, as base64. The SDK's `parseTransactionInfo`
 * only reaches into `sorobanMeta` for the `v3`/`v4` arms, so the legacy
 * `operations` arm is the smallest thing it can parse without inventing a
 * return value the app never reads.
 */
export function emptyMetaB64(): string {
  return xdr.TransactionMeta.operations([]).toXDR("base64");
}

/** The raw 32-byte ed25519 public key behind a `G…` strkey. */
export function signerBytes(publicKey: string): Uint8Array {
  return StrKey.decodeEd25519PublicKey(publicKey);
}
