import { Networks } from "@stellar/stellar-sdk";
import type { StellarNetwork } from "@mooring-live/x402-client";

/** The settings `.env` provides; a missing required one exits with its name. */
export function readEnv(): { network: StellarNetwork; rpcUrl: string | undefined; passphrase: string } {
  const network = (process.env.MOORING_NETWORK?.trim() || "stellar:testnet") as StellarNetwork;
  if (network !== "stellar:testnet" && network !== "stellar:pubnet") {
    fail(`MOORING_NETWORK must be stellar:testnet or stellar:pubnet (got ${network})`);
  }
  const rpcUrl = process.env.MOORING_RPC_URL?.trim() || undefined;
  if (network === "stellar:pubnet" && !rpcUrl) fail("MOORING_RPC_URL is required on stellar:pubnet");
  return { network, rpcUrl, passphrase: network === "stellar:pubnet" ? Networks.PUBLIC : Networks.TESTNET };
}

/** The Soroban RPC to read the card through: MOORING_RPC_URL, else the network's public testnet RPC. */
export function rpcUrlFor(rpcUrl: string | undefined): string {
  return rpcUrl ?? "https://soroban-testnet.stellar.org";
}

/** A required variable from `.env`. */
export function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) fail(`Missing ${name}: copy .env.example to .env and fill it in.`);
  return value;
}

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** The stellar.expert page for a transaction. */
export function explorerUrl(network: StellarNetwork, hash: string): string {
  return `https://stellar.expert/explorer/${network === "stellar:pubnet" ? "public" : "testnet"}/tx/${hash}`;
}
