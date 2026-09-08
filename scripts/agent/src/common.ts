import "dotenv/config";
import { readFileSync } from "node:fs";
import { Keypair, Networks, rpc } from "@stellar/stellar-sdk";

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
