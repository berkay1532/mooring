import { Address, contract, nativeToScVal, rpc } from "@stellar/stellar-sdk";

export interface CardTransferParams {
  /** SEP-41 token contract (the SAC for USDC). */
  asset: string;
  /** The payer: the card's `C…` address. */
  from: string;
  /** The merchant. */
  to: string;
  /** Base units. */
  amount: bigint;
  rpcUrl: string;
  passphrase: string;
  /**
   * Transaction source account. Omitted, the SDK uses its all-zeros
   * placeholder account (a sponsor swaps in its own); set, the SDK fetches
   * that account's sequence from the RPC.
   */
  publicKey?: string;
}

/**
 * Builds and simulates `asset.transfer(from, to, amount)` (SEP-41) — the one
 * operation a card's `__check_auth` lets the agent key authorize. Shared by the
 * x402 scheme and the MPP charge method.
 */
export async function buildCardTransfer(
  params: CardTransferParams,
): Promise<contract.AssembledTransaction<unknown>> {
  const tx = await contract.AssembledTransaction.build({
    contractId: params.asset,
    method: "transfer",
    args: [
      nativeToScVal(Address.fromString(params.from), { type: "address" }),
      nativeToScVal(Address.fromString(params.to), { type: "address" }),
      nativeToScVal(params.amount, { type: "i128" }),
    ],
    networkPassphrase: params.passphrase,
    rpcUrl: params.rpcUrl,
    ...(params.publicKey ? { publicKey: params.publicKey } : {}),
    parseResultXdr: (r) => r,
    // Record legacy (v1) address credentials rather than the CAP-71 v2 ones
    // stellar-sdk 17 asks for by default. Measured 2026-09-12 against OZ
    // Channels testnet: a v2 payload is rejected as
    // `invalid_exact_stellar_payload_malformed`, the identical v1 payload
    // verifies. The `@x402/stellar` JS library does understand v2, so the
    // refusal comes from somewhere else in the deployed facilitator stack —
    // most likely a Rust `stellar-xdr` decoder, since `stellar xdr decode`
    // (CLI 26.1.0) also fails on a v2 envelope. Both formats are valid
    // on-chain and carry the same agent signature; only the signed preimage
    // differs (v2 binds the address). Drop this once OZ Channels accepts
    // ADDRESS_V2 — and note the SDK flag is transitional: it becomes a no-op
    // in protocol 28, so that has to happen first.
    useUpgradedAuth: false,
  });
  assertSimulationOk(tx.simulation);
  return tx;
}

/** Throws unless a simulation succeeded outright (no error, no restore). */
export function assertSimulationOk(sim?: rpc.Api.SimulateTransactionResponse): void {
  if (!sim) throw new Error("Stellar simulation result is undefined");
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Stellar simulation failed${sim.error ? `: ${sim.error}` : ""}`);
  }
  if (rpc.Api.isSimulationRestore(sim)) {
    throw new Error("Stellar simulation requires a ledger entry restore");
  }
}
