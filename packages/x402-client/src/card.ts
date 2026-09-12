import { Address, contract, scValToNative, xdr } from "@stellar/stellar-sdk";

export type CardState = 0 | 1 | 2; // Active, Frozen, Cancelled

export interface CardPolicy {
  period_amount: bigint;
  period_duration: bigint;
  max_per_tx: bigint;
  expiry: bigint;
}

export interface CardInfo {
  owner: string;
  signer: Uint8Array;
  token: string;
  policy: CardPolicy;
  state: CardState;
  period: { start: bigint; spent: bigint };
  remaining: bigint;
  balance: bigint;
  allow_count: number;
}

/** `CardInfo` as `scValToNative` hands it back, before normalization. */
type RawInfo = {
  owner: string;
  signer: Buffer | Uint8Array;
  token: string;
  policy: CardPolicy;
  state: number;
  period: { start: bigint; spent: bigint };
  remaining: bigint;
  balance: bigint;
  allow_count: number;
};

/**
 * Simulates a read-only contract method and returns its parsed result.
 *
 * `AssembledTransaction.build` without a `publicKey` simulates from a null
 * account, so nothing is signed, submitted or charged.
 */
async function simulateView<T>(
  rpcUrl: string,
  networkPassphrase: string,
  card: string,
  method: string,
): Promise<T> {
  const tx = await contract.AssembledTransaction.build<T>({
    contractId: card,
    method,
    args: [],
    networkPassphrase,
    rpcUrl,
    parseResultXdr: (v: xdr.ScVal) => scValToNative(v) as T,
  });
  return tx.result;
}

/** Reads the card's `info()` view via simulation (no signing, no fees). */
export async function readCardInfo(
  rpcUrl: string,
  networkPassphrase: string,
  card: string,
): Promise<CardInfo> {
  const raw = await simulateView<RawInfo>(rpcUrl, networkPassphrase, card, "info");
  return {
    owner: raw.owner,
    signer: new Uint8Array(raw.signer),
    token: raw.token,
    policy: raw.policy,
    state: raw.state as CardState,
    period: raw.period,
    remaining: raw.remaining,
    balance: raw.balance,
    allow_count: Number(raw.allow_count),
  };
}

/** Reads the card's `merchants()` view via simulation. */
export async function readMerchants(
  rpcUrl: string,
  networkPassphrase: string,
  card: string,
): Promise<string[]> {
  const list = await simulateView<string[]>(rpcUrl, networkPassphrase, card, "merchants");
  // `scValToNative` already renders `ScAddress` as a strkey; the guard keeps
  // the reader honest if a future SDK hands back the raw XDR instead.
  return list.map((a) =>
    typeof a === "string" ? a : Address.fromScAddress(a as unknown as xdr.ScAddress).toString(),
  );
}
