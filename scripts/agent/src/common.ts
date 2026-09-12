import "dotenv/config";
import { readFileSync } from "node:fs";
import {
  Address,
  contract,
  humanizeEvents,
  Keypair,
  nativeToScVal,
  Networks,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";

export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const RPC_URL = "https://soroban-testnet.stellar.org";
export const server = new rpc.Server(RPC_URL);

export type Deployed = {
  factory: string;
  card: string;
  token: string;
  owner: string;
  agent: string;
  merchant: string;
  funder: string;
};

export function loadDeployed(): Deployed {
  const path = new URL("../../../deployed.testnet.json", import.meta.url);
  return JSON.parse(readFileSync(path, "utf8")) as Deployed;
}

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export const agentKeypair = () => Keypair.fromSecret(env("AGENT_SECRET"));

export async function waitForTx(
  hash: string,
  attempts = 20,
): Promise<rpc.Api.GetTransactionResponse> {
  for (let i = 0; i < attempts; i++) {
    const r = await server.getTransaction(hash);
    if (r.status !== "NOT_FOUND") return r;
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error(`tx ${hash} not found after ${attempts}s`);
}

/**
 * Builds the one call both scripts make: `token.transfer(card, merchant, amount)`
 * paid by the card, with `submitterPublicKey` as the fee-paying source account.
 *
 * The recording simulation that `AssembledTransaction.build` runs must succeed:
 * on failure it leaves the built transaction with an empty `auth` array, and a
 * later `signAuthEntries` would then silently sign nothing. Both conditions are
 * asserted here so callers can rely on the card's auth entry being present.
 */
export async function buildCardTransfer(
  d: Deployed,
  submitterPublicKey: string,
  amount: bigint,
): Promise<contract.AssembledTransaction<unknown>> {
  const tx = await contract.AssembledTransaction.build({
    contractId: d.token,
    method: "transfer",
    args: [
      nativeToScVal(Address.fromString(d.card), { type: "address" }),
      nativeToScVal(Address.fromString(d.merchant), { type: "address" }),
      nativeToScVal(amount, { type: "i128" }),
    ],
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    publicKey: submitterPublicKey,
    parseResultXdr: (r) => r,
  });

  if (!tx.simulation || rpc.Api.isSimulationError(tx.simulation)) {
    throw new Error(
      `initial simulation failed: ${tx.simulation ? tx.simulation.error : "not simulated"}`,
    );
  }

  const needs = tx.needsNonInvokerSigningBy();
  if (!needs.includes(d.card)) {
    throw new Error(
      `expected the card ${d.card} to need an auth signature, got ${JSON.stringify(needs)}`,
    );
  }

  return tx;
}

/**
 * Prints everything the RPC response carries about why a transaction failed:
 * the transaction result XDR and any diagnostic events (which is where a card
 * contract error such as `#8 OverBudget` becomes visible).
 */
export function reportFailure(hash: string, r: rpc.Api.GetTransactionResponse): void {
  console.error(`tx ${hash} status: ${r.status}`);
  if (r.status === rpc.Api.GetTransactionStatus.NOT_FOUND) return;

  console.error("result code:", r.resultXdr.result.type);
  console.error("resultXdr:", r.resultXdr.toXDR("base64"));

  const diagnostics: xdr.DiagnosticEvent[] = r.diagnosticEventsXdr ?? [];
  if (diagnostics.length === 0) {
    console.error("diagnostic events: (none returned by RPC)");
    console.error("resultMetaXdr:", r.resultMetaXdr.toXDR("base64"));
    return;
  }

  // `core_metrics` events are pure instrumentation and drown out the error.
  const interesting = humanizeEvents(diagnostics).filter(
    (e) => e.topics[0] !== "core_metrics",
  );
  console.error("diagnostic events:");
  for (const e of interesting) {
    console.error(" ", JSON.stringify(e, jsonReplacer));
  }
}

/** Renders bigints as decimal strings and byte arrays as hex, not as `{"0":1,…}`. */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: string }).type === "Buffer" &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    return Buffer.from((value as { data: number[] }).data).toString("hex");
  }
  return value;
}
