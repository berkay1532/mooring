import { Address, BASE_FEE, Contract, Keypair, TransactionBuilder, nativeToScVal, xdr, type Transaction } from "@stellar/stellar-sdk";
import type { rpc } from "@stellar/stellar-sdk";
import type { CardPolicy } from "./card.js";
import { deriveCardAddress, saltBytes } from "./derive.js";

/** The RPC surface `createCard` uses; a real `rpc.Server` satisfies it structurally. */
export interface CreateCardRpc {
  getAccount(publicKey: string): Promise<ConstructorParameters<typeof TransactionBuilder>[0]>;
  prepareTransaction(tx: Transaction): Promise<Transaction>;
  sendTransaction(tx: Transaction): Promise<rpc.Api.SendTransactionResponse>;
  getTransaction(hash: string): Promise<rpc.Api.GetTransactionResponse>;
}

export interface CreateCardParams {
  /** Signs the transaction; `create_card` requires the owner's auth. */
  owner: Keypair;
  /** The agent's 32-byte public key. */
  signer: Uint8Array;
  /** Token the card holds (USDC SAC). */
  token: string;
  /** 1..=32 bytes. */
  label: string;
  policy: CardPolicy;
  /** Deployer salt index (the app's next unused index keeps the card discoverable). */
  saltIndex: number;
  factory: string;
  networkPassphrase: string;
  /** Transaction fee in stroops; default `BASE_FEE`. */
  fee?: string;
}

export interface CreateCardResult {
  card: string;
  saltIndex: number;
  txHash: string;
  owner: string;
}

/** `Policy` as the contract declares it: a map with sorted symbol keys. */
export function encodePolicy(p: CardPolicy): xdr.ScVal {
  const entry = (k: string, v: xdr.ScVal) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v });
  return xdr.ScVal.scvMap([
    entry("expiry", nativeToScVal(p.expiry, { type: "u64" })),
    entry("max_per_tx", nativeToScVal(p.max_per_tx, { type: "i128" })),
    entry("period_amount", nativeToScVal(p.period_amount, { type: "i128" })),
    entry("period_duration", nativeToScVal(p.period_duration, { type: "u64" })),
  ]);
}

/** The `create_card` arguments in the contract's order. */
export function createCardArgs(p: Omit<CreateCardParams, "networkPassphrase" | "fee">): xdr.ScVal[] {
  if (p.signer.length !== 32) throw new Error("signer must be 32 bytes");
  const labelBytes = new TextEncoder().encode(p.label).length;
  if (labelBytes < 1 || labelBytes > 32) throw new Error("label must be 1 to 32 bytes");
  return [
    Address.fromString(p.owner.publicKey()).toScVal(),
    nativeToScVal(Buffer.from(p.signer), { type: "bytes" }),
    Address.fromString(p.token).toScVal(),
    encodePolicy(p.policy),
    nativeToScVal(p.label, { type: "string" }),
    nativeToScVal(Buffer.from(saltBytes(p.saltIndex)), { type: "bytes" }),
  ];
}

export interface CreateCardDeps {
  rpc: CreateCardRpc;
  /** Polling delay; tests shorten it. */
  sleep?: (ms: number) => Promise<void>;
  /** Poll attempts at one per second. Default 60. */
  attempts?: number;
}

/**
 * Deploys a card through the factory, signed by the owner, and returns its
 * address once the transaction is final. The address is also derived locally
 * and must match what the factory returned.
 */
export async function createCard(p: CreateCardParams, deps: CreateCardDeps): Promise<CreateCardResult> {
  const expected = deriveCardAddress(p.owner.publicKey(), saltBytes(p.saltIndex), p.factory, p.networkPassphrase);
  const account = await deps.rpc.getAccount(p.owner.publicKey());
  const built = new TransactionBuilder(account, { fee: p.fee ?? BASE_FEE, networkPassphrase: p.networkPassphrase })
    .addOperation(new Contract(p.factory).call("create_card", ...createCardArgs(p)))
    .setTimeout(120)
    .build();
  const tx = await deps.rpc.prepareTransaction(built);
  tx.sign(p.owner);
  const sent = await deps.rpc.sendTransaction(tx);
  if (sent.status !== "PENDING") {
    throw new Error(`create_card was not accepted: ${sent.status}${sent.errorResult ? ` (${sent.errorResult.toXDR("base64")})` : ""}`);
  }
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const attempts = deps.attempts ?? 60;
  for (let i = 0; i < attempts; i++) {
    const r = await deps.rpc.getTransaction(sent.hash);
    if (r.status === "NOT_FOUND") {
      await sleep(1000);
      continue;
    }
    if (r.status !== "SUCCESS") throw new Error(`create_card failed on-chain (tx ${sent.hash}, status ${r.status})`);
    const rv = r.returnValue;
    const card = rv ? Address.fromScVal(rv).toString() : expected;
    if (card !== expected) throw new Error(`factory returned ${card}, expected ${expected} for salt ${p.saltIndex}`);
    return { card, saltIndex: p.saltIndex, txHash: sent.hash, owner: p.owner.publicKey() };
  }
  throw new Error(`tx ${sent.hash} not found after ${attempts}s`);
}
