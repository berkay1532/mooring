import {
  Account,
  Address,
  SorobanDataBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { vi } from "vitest";
import { buildCardTransfer, type CardTransferParams } from "../../src/transfer.js";

export const CARD = "CAJPWJBFBM6WMYZBRURA7VW3GKSLMHTHIIZIRFVFKUSAPWX4526YAHCJ";
export const TOKEN = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
export const MERCHANT = "GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG";
export const PASSPHRASE = "Test SDF Network ; September 2015";

/** The card's `__check_auth` rejecting a payment, as the RPC reports it. */
export const cardRejection = (code: number, card = CARD, token = TOKEN) =>
  [
    "HostError: Error(Auth, InvalidAction)",
    "",
    "Event log (newest first):",
    `   0: [Diagnostic Event] contract:${token}, topics:[error, Error(Auth, InvalidAction)], ` +
      `data:["failed account authentication with error", ${card}, Error(Contract, #${code})]`,
  ].join("\n");

/** The unsigned legacy (v1) auth entry the RPC records for `token.transfer(from, to, amount)`. */
export function unsignedTransferEntry(
  from: string,
  to: string,
  amount: bigint,
  token = TOKEN,
): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(from).toScAddress(),
        nonce: xdr.Int64.fromString("7"),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: Address.fromString(token).toScAddress(),
          functionName: "transfer",
          args: [
            nativeToScVal(Address.fromString(from), { type: "address" }),
            nativeToScVal(Address.fromString(to), { type: "address" }),
            nativeToScVal(amount, { type: "i128" }),
          ],
        }),
      ),
      subInvocations: [],
    }),
  });
}

/**
 * Stubs the RPC under a *real* `AssembledTransaction`: every simulation
 * succeeds and records the card's unsigned transfer entry, except that the
 * re-simulation after signing fails with `enforcingError` when one is given.
 * `getAccount` returns sequence 5 for whichever account is asked for.
 *
 * Returns a `buildTransfer` that runs the real `buildCardTransfer` against
 * that RPC, and the spies so tests can see what was asked.
 */
export function stubCardTransferRpc(opts: { enforcingError?: string } = {}) {
  let calls = 0;
  const simulate = vi
    .spyOn(rpc.Server.prototype as any, "_simulateTransaction")
    .mockImplementation(async (...args: unknown[]) => {
      calls += 1;
      const base = { id: String(calls), latestLedger: 1000, events: [] };
      if (calls > 1 && opts.enforcingError) return { ...base, error: opts.enforcingError };
      const tx = args[0] as { operations: Array<{ func: xdr.HostFunction }> };
      const invoke = (tx.operations[0]!.func as any).invokeContract as xdr.InvokeContractArgs;
      const [from, to, amount] = invoke.args.map((a) => scValToNative(a) as unknown);
      const entry = unsignedTransferEntry(
        String(from),
        String(to),
        amount as bigint,
        Address.fromScAddress(invoke.contractAddress).toString(),
      );
      return {
        ...base,
        minResourceFee: "100",
        transactionData: new SorobanDataBuilder().build().toXDR("base64"),
        results: [{ auth: [entry.toXDR("base64")], xdr: xdr.ScVal.scvVoid().toXDR("base64") }],
      };
    });
  const getAccount = vi
    .spyOn(rpc.Server.prototype, "getAccount")
    .mockImplementation(async (address: string) => new Account(address, "5"));
  const buildTransfer = vi.fn((params: CardTransferParams) => buildCardTransfer(params));
  return { buildTransfer, simulate, getAccount };
}
