import type { Account, Transaction, xdr } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";

import { config } from "../config";

/**
 * The ledger-entry lookup surface `discoverCards` depends on. A real
 * `rpc.Server` satisfies this structurally; tests pass a fake instead of
 * talking to a Soroban RPC endpoint.
 */
export interface LedgerEntriesRpc {
  getLedgerEntries(...keys: xdr.LedgerKey[]): Promise<{ entries: readonly unknown[] }>;
}

/**
 * The account + transaction-preparation surface `buildFundTransfer` depends
 * on. A real `rpc.Server` satisfies this structurally.
 */
export interface AccountRpc {
  getAccount(publicKey: string): Promise<Account>;
  prepareTransaction(tx: Transaction): Promise<Transaction>;
}

let sharedServer: Server | undefined;

/**
 * Lazily constructs (and memoizes) the shared RPC server for `config.rpcUrl`.
 * Card discovery and the write builders default to this when no RPC object
 * is passed in; tests pass their own fake instead.
 */
export function getRpcServer(): Server {
  if (!sharedServer) {
    sharedServer = new Server(config.rpcUrl);
  }
  return sharedServer;
}
