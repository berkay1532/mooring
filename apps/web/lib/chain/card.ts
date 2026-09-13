import { Card, Factory } from "@mooring/contracts-ts";
import { readCardInfo, readMerchants as readCardMerchants } from "@mooring/x402-client";
import type { CardInfo } from "@mooring/x402-client";
import {
  Address,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  type Transaction,
  type xdr,
} from "@stellar/stellar-sdk";
import { AssembledTransaction, DEFAULT_TIMEOUT } from "@stellar/stellar-sdk/contract";

import { config } from "../config";
import { getRpcServer, type AccountRpc } from "./rpc";

export type { CardInfo };

/**
 * The signing adapter every write path in this module accepts. Shaped to
 * match `@stellar/freighter-api` 6's `signTransaction` return (`{
 * signedTxXdr, signerAddress? }`) so a Freighter-backed wallet (Task 5)
 * satisfies it directly, and a fake satisfying the same shape can stand in
 * for it in tests.
 */
export interface Wallet {
  publicKey: string;
  signTransaction(
    xdr: string,
    opts: { networkPassphrase: string; address?: string },
  ): Promise<{ signedTxXdr: string; signerAddress?: string }>;
}

/**
 * Adapts {@link Wallet.signTransaction} (a required `opts` with a required
 * `networkPassphrase`, per the brief Task 5 implements) to the SDK's
 * `SignTransactionLike` (an optional `opts` with every field optional): the
 * generated `Client` always calls with `opts.networkPassphrase` set, so this
 * only needs a fallback for the type, never for an actual missing value.
 */
function adaptSignTransaction(wallet: Wallet) {
  return (
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string; submit?: boolean; submitUrl?: string },
  ) =>
    wallet.signTransaction(xdr, {
      networkPassphrase: opts?.networkPassphrase ?? config.networkPassphrase,
      address: opts?.address,
    });
}

function clientOptions(wallet?: Wallet) {
  return {
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    publicKey: wallet?.publicKey,
    signTransaction: wallet ? adaptSignTransaction(wallet) : undefined,
  };
}

/** A card client bound to `address`, optionally able to sign as `wallet`. */
export function cardClient(address: string, wallet?: Wallet): Card.Client {
  return new Card.Client({ contractId: address, ...clientOptions(wallet) });
}

/** The factory client, optionally able to sign as `wallet`. */
export function factoryClient(wallet?: Wallet): Factory.Client {
  return new Factory.Client({ contractId: config.factory, ...clientOptions(wallet) });
}

/** Reads a card's `info()` view via simulation (no signing, no fees). */
export function readInfo(address: string): Promise<CardInfo> {
  return readCardInfo(config.rpcUrl, config.networkPassphrase, address);
}

/** Reads a card's `merchants()` view via simulation. */
export function readMerchants(address: string): Promise<string[]> {
  return readCardMerchants(config.rpcUrl, config.networkPassphrase, address);
}

/**
 * Reads `balance(address)` on the USDC SAC by simulation (no signing, no
 * fees), in base units.
 *
 * A *card's* balance already arrives inside `info()` (`CardInfo.balance`),
 * so this exists for the one balance `info()` cannot give us: the **owner's
 * own** wallet balance, which the Fund sheet needs for its quick picks and
 * "max", and which the withdraw/cancel flows use as a trustline probe — the
 * SAC panics when an account holds no trustline for the asset, so a rejected
 * read is itself the answer (see `lib/query/hooks.ts`'s `useUsdcBalance`).
 */
export async function readBalance(address: string, token: string = config.usdc): Promise<bigint> {
  const tx = await AssembledTransaction.build<bigint>({
    contractId: token,
    method: "balance",
    args: [Address.fromString(address).toScVal()],
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    parseResultXdr: (v: xdr.ScVal) => scValToNative(v) as bigint,
  });
  return tx.result;
}

/**
 * Confirms `address` is both a valid contract address and a card owned by
 * `owner`, returning its `info()` in the same call. `read` defaults to
 * {@link readInfo}; tests inject a fake to avoid a network round trip.
 *
 * @throws if `address` is not a valid Stellar contract (`C...`) address.
 * @throws `Error("This card belongs to another owner")` if the card's owner
 *   does not match `owner`.
 */
export async function verifyOwnedCard(
  address: string,
  owner: string,
  read: (address: string) => Promise<CardInfo> = readInfo,
): Promise<CardInfo> {
  if (!StrKey.isValidContract(address)) {
    throw new Error(`"${address}" is not a valid Stellar contract address`);
  }
  const info = await read(address);
  if (info.owner !== owner) {
    throw new Error("This card belongs to another owner");
  }
  return info;
}

// --- Write builders -------------------------------------------------------
//
// Each of these simulates its call (a bindings `Client` method call, per
// `MethodOptions.simulate` defaulting to `true`) and returns the resulting
// `AssembledTransaction`, unsigned and unsent. The caller (Task 6's
// `useContractAction`) signs it with a wallet and submits it.

export interface CreateCardParams {
  owner: string;
  signer: Buffer;
  token: string;
  policy: Card.Policy;
  label: string;
  salt: Buffer;
}

export function buildCreateCard(params: CreateCardParams, wallet?: Wallet) {
  return factoryClient(wallet).create_card(params);
}

export function buildSetLabel(address: string, label: string, wallet?: Wallet) {
  return cardClient(address, wallet).set_label({ label });
}

export function buildSetPolicy(address: string, policy: Card.Policy, wallet?: Wallet) {
  return cardClient(address, wallet).set_policy({ policy });
}

export function buildAddMerchant(address: string, merchant: string, wallet?: Wallet) {
  return cardClient(address, wallet).add_merchant({ merchant });
}

export function buildRemoveMerchant(address: string, merchant: string, wallet?: Wallet) {
  return cardClient(address, wallet).remove_merchant({ merchant });
}

export function buildSetSigner(address: string, signer: Buffer, wallet?: Wallet) {
  return cardClient(address, wallet).set_signer({ signer });
}

export function buildFreeze(address: string, wallet?: Wallet) {
  return cardClient(address, wallet).freeze();
}

export function buildUnfreeze(address: string, wallet?: Wallet) {
  return cardClient(address, wallet).unfreeze();
}

export function buildWithdraw(address: string, amount: bigint, wallet?: Wallet) {
  return cardClient(address, wallet).withdraw({ amount });
}

export function buildCancel(address: string, wallet?: Wallet) {
  return cardClient(address, wallet).cancel();
}

/**
 * Builds a USDC SAC `transfer(from=owner, to=card, amount)`, simulated and
 * prepared (footprint + resource fee attached) but not signed or sent.
 *
 * This is the one write path that is *not* built through the generated
 * bindings' `Client`: the bindings model the card contract, not the token
 * contract, so this constructs the `invokeContractFunction` operation by
 * hand on the owner's own account and prepares it with `rpc.prepareTransaction`.
 * The result is therefore a plain `Transaction`, not an `AssembledTransaction`
 * — Task 6's signing helper must handle both shapes (an `AssembledTransaction`
 * exposes `.sign`/`.signAndSend`; a `Transaction` is signed directly with the
 * wallet's `signTransaction` and submitted via the RPC server).
 */
export async function buildFundTransfer(
  owner: string,
  card: string,
  amount: bigint,
  rpc: AccountRpc = getRpcServer(),
): Promise<Transaction> {
  const account = await rpc.getAccount(owner);
  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: config.usdc,
        function: "transfer",
        args: [
          Address.fromString(owner).toScVal(),
          Address.fromString(card).toScVal(),
          nativeToScVal(amount, { type: "i128" }),
        ],
      }),
    )
    // The same window every other write gets: the bindings' own
    // `AssembledTransaction` builds with `DEFAULT_TIMEOUT` (300 s). The time
    // bound starts when the transaction is *built*, i.e. when the owner
    // clicks "Send with my wallet" — a 30 s window expires while the
    // Freighter popup is still open (unlock, read, approve) and the network
    // then rejects a perfectly valid transfer with `txTooLate`.
    .setTimeout(DEFAULT_TIMEOUT)
    .build();
  return (await rpc.prepareTransaction(tx)) as Transaction;
}

export { Card, Factory };
