import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";

const TOKEN = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

/** One diagnostic event, as the RPC returns them on a failed transaction. */
function event(topics: xdr.ScVal[], data: xdr.ScVal): xdr.DiagnosticEvent {
  return new xdr.DiagnosticEvent({
    inSuccessfulContractCall: false,
    event: new xdr.ContractEvent({
      ext: xdr.ExtensionPoint.v0(),
      contractId: null,
      type: xdr.ContractEventType.contract,
      body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({ topics, data })),
    }),
  });
}

const authInvalid = xdr.ScVal.scvError(xdr.ScError.sceAuth(xdr.ScErrorCode.scecInvalidAction));
const contractError = (code: number) => xdr.ScVal.scvError(xdr.ScError.sceContract(code));

/**
 * The host refusing `account`'s authorization with contract error `code` — the
 * shape a card's `__check_auth` rejection takes in a settled transaction's
 * diagnostics.
 */
export function authFailureEvents(account: string, code: number): xdr.DiagnosticEvent[] {
  return [
    event(
      [xdr.ScVal.scvSymbol("error"), authInvalid],
      xdr.ScVal.scvVec([
        xdr.ScVal.scvString("failed account authentication with error"),
        nativeToScVal(Address.fromString(account), { type: "address" }),
        contractError(code),
      ]),
    ),
  ];
}

/**
 * The token (not the card) refusing the transfer. The card's address is in the
 * `transfer` arguments of every such diagnostic and the SAC's own error codes
 * overlap the card's 1-8 range, so only the account-authentication phrase
 * distinguishes a policy decision from this.
 */
export function tokenFailureEvents(card: string): xdr.DiagnosticEvent[] {
  return [
    event(
      [xdr.ScVal.scvSymbol("fn_call"), xdr.ScVal.scvSymbol("transfer")],
      xdr.ScVal.scvVec([
        nativeToScVal(Address.fromString(card), { type: "address" }),
        nativeToScVal(Address.fromString(TOKEN), { type: "address" }),
        nativeToScVal(10_000n, { type: "i128" }),
      ]),
    ),
    event(
      [xdr.ScVal.scvSymbol("error"), contractError(8)],
      xdr.ScVal.scvVec([
        xdr.ScVal.scvString("resulting balance is not within the allowed range"),
        nativeToScVal(0n, { type: "i128" }),
      ]),
    ),
  ];
}
