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
export type RawCardInfo = {
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

/**
 * Normalizes a raw `info()` result into `CardInfo`: `signer` becomes a
 * `Uint8Array` (it arrives as a node `Buffer`), `allow_count` a `number`, and
 * `state` is range-checked before it is narrowed. Every other field is already
 * the `bigint` the contract declared, and is passed through untouched.
 *
 * @throws if `state` is not one of the contract's three variants.
 */
export function normalizeInfo(raw: RawCardInfo): CardInfo {
  const state = Number(raw.state);
  if (state !== 0 && state !== 1 && state !== 2) {
    throw new Error(`Unknown card state: ${raw.state}`);
  }
  return {
    owner: raw.owner,
    signer: new Uint8Array(raw.signer),
    token: raw.token,
    policy: raw.policy,
    state: state as CardState,
    period: raw.period,
    remaining: raw.remaining,
    balance: raw.balance,
    allow_count: Number(raw.allow_count),
  };
}

/**
 * Normalizes a raw `merchants()` result into strkeys. `scValToNative` already
 * renders an `ScAddress` as a strkey, so the guard is a no-op today; it keeps
 * the reader honest if a future SDK hands back the raw XDR instead.
 */
export function normalizeMerchants(list: readonly unknown[]): string[] {
  return list.map((a) =>
    typeof a === "string" ? a : Address.fromScAddress(a as xdr.ScAddress).toString(),
  );
}

/** Reads the card's `info()` view via simulation (no signing, no fees). */
export async function readCardInfo(
  rpcUrl: string,
  networkPassphrase: string,
  card: string,
): Promise<CardInfo> {
  return normalizeInfo(await simulateView<RawCardInfo>(rpcUrl, networkPassphrase, card, "info"));
}

/** Reads the card's `merchants()` view via simulation. */
export async function readMerchants(
  rpcUrl: string,
  networkPassphrase: string,
  card: string,
): Promise<string[]> {
  return normalizeMerchants(await simulateView<unknown[]>(rpcUrl, networkPassphrase, card, "merchants"));
}
