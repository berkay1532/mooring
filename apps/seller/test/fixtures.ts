import {
  Account,
  Address,
  Keypair,
  Operation,
  SorobanDataBuilder,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import type { FacilitatorClient } from "@x402/core/server";
import { Challenge, Credential } from "mppx";
import { vi } from "vitest";
import { createSellerApp } from "../src/app.js";
import type { ChargeRpc } from "../src/mpp-card-charge.js";

export const CARD = "CAJPWJBFBM6WMYZBRURA7VW3GKSLMHTHIIZIRFVFKUSAPWX4526YAHCJ";
export const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
export const PAY_TO = "GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG";
export const PASSPHRASE = "Test SDF Network ; September 2015";
/** The SDK's placeholder source, which a fee sponsor would replace. */
export const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
export const SECRET = "test-secret-key-at-least-32-bytes-long!!";
export const LATEST_LEDGER = 1000;
export const TX_HASH = "ab".repeat(32);

/** A facilitator that verifies and settles every x402 payment. */
export const fakeFacilitator: FacilitatorClient = {
  getSupported: async () => ({
    kinds: [{ x402Version: 2, scheme: "exact", network: "stellar:testnet", extra: { areFeesSponsored: true } }],
    extensions: [],
    signers: { "stellar:*": ["GFACILITATOR"] },
  }),
  verify: async () => ({ isValid: true }),
  settle: async () => ({ success: true, transaction: "abc", network: "stellar:testnet" }),
} as unknown as FacilitatorClient;

/** A `ChargeRpc` whose every call succeeds, with spies. */
export function fakeChargeRpc(over: Partial<ChargeRpc> = {}) {
  return {
    simulate: vi.fn(over.simulate ?? (async () => ({ ok: true as const }))),
    send: vi.fn(over.send ?? (async () => ({ hash: TX_HASH }))),
    wait: vi.fn(over.wait ?? (async () => "SUCCESS" as const)),
    latestLedger: vi.fn(over.latestLedger ?? (async () => LATEST_LEDGER)),
  };
}

export function sellerApp(rpcFake: ChargeRpc = fakeChargeRpc()) {
  return createSellerApp({
    network: "stellar:testnet",
    payTo: PAY_TO,
    usdc: USDC,
    rpcUrl: "https://soroban-testnet.stellar.org",
    facilitator: fakeFacilitator,
    mppSecretKey: SECRET,
    priceBaseUnits: "10000",
    rpc: rpcFake,
  });
}

/**
 * Stubs the RPC under the client's *real* `AssembledTransaction`: every
 * simulation succeeds and records the unsigned legacy (v1) address-credential
 * entry for `token.transfer(from, to, amount)`; `getAccount` returns sequence 5.
 */
export function stubClientRpc() {
  let calls = 0;
  vi.spyOn(rpc.Server.prototype as any, "_simulateTransaction").mockImplementation(async (...args: unknown[]) => {
    calls += 1;
    const tx = args[0] as { operations: Array<{ func: xdr.HostFunction }> };
    const invoke = (tx.operations[0]!.func as any).invokeContract as xdr.InvokeContractArgs;
    const [from, to, amount] = invoke.args.map((a) => scValToNative(a) as unknown);
    const entry = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
        new xdr.SorobanAddressCredentials({
          address: Address.fromString(String(from)).toScAddress(),
          nonce: xdr.Int64.fromString("7"),
          signatureExpirationLedger: 0,
          signature: xdr.ScVal.scvVoid(),
        }),
      ),
      rootInvocation: new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: invoke.contractAddress,
            functionName: "transfer",
            args: [
              nativeToScVal(Address.fromString(String(from)), { type: "address" }),
              nativeToScVal(Address.fromString(String(to)), { type: "address" }),
              nativeToScVal(amount as bigint, { type: "i128" }),
            ],
          }),
        ),
        subInvocations: [],
      }),
    });
    return {
      id: String(calls),
      latestLedger: LATEST_LEDGER,
      events: [],
      minResourceFee: "100",
      transactionData: new SorobanDataBuilder().build().toXDR("base64"),
      results: [{ auth: [entry.toXDR("base64")], xdr: xdr.ScVal.scvVoid().toXDR("base64") }],
    };
  });
  vi.spyOn(rpc.Server.prototype, "getAccount").mockImplementation(async (address: string) => new Account(address, "5"));
}

type TxPayload = { type: "transaction"; transaction: string };

/** The envelope a credential carries. */
export function envelopeOf(credential: string): Transaction {
  const parsed = Credential.deserialize<TxPayload>(credential);
  return TransactionBuilder.fromXDR(parsed.payload.transaction, PASSPHRASE) as Transaction;
}

/** Re-serializes a credential with a different envelope and/or source DID. */
export function withEnvelope(credential: string, change: { transaction?: string; source?: string }): string {
  const parsed = Credential.deserialize<TxPayload>(credential);
  return Credential.serialize({
    challenge: parsed.challenge,
    payload: { type: "transaction", transaction: change.transaction ?? parsed.payload.transaction },
    source: change.source ?? parsed.source,
  });
}

/**
 * Rebuilds `tx` with the same transfer (and signed auth entries) under a new
 * source, other auth entries and/or extra operations, signed by `signer` when given.
 */
export function rebuild(
  tx: Transaction,
  opts: { source?: string; auth?: xdr.SorobanAuthorizationEntry[]; extraOps?: xdr.Operation[]; signer?: Keypair },
): string {
  const op = tx.operations[0] as Operation.InvokeHostFunction;
  const envelope = tx.toEnvelope();
  if (envelope.type !== "envelopeTypeTx" || envelope.v1.tx.ext.type !== "sorobanData") {
    throw new Error("expected a Soroban v1 envelope");
  }
  const sorobanData = envelope.v1.tx.ext.sorobanData;
  const builder = new TransactionBuilder(new Account(opts.source ?? tx.source, (BigInt(tx.sequence) - 1n).toString()), {
    fee: tx.fee,
    networkPassphrase: PASSPHRASE,
    sorobanData,
    timebounds: tx.timeBounds!,
  }).addOperation(Operation.invokeHostFunction({ func: op.func, auth: opts.auth ?? op.auth ?? [] }));
  for (const extra of opts.extraOps ?? []) builder.addOperation(extra);
  const built = builder.build();
  if (opts.signer) built.sign(opts.signer);
  return built.toXDR();
}

/** The 402's Stellar charge challenge. */
export function challengeOf(res: Response) {
  return Challenge.fromResponse(res);
}
