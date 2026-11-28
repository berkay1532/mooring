import { StrKey } from "@stellar/stellar-sdk";
import { HTTPFacilitatorClient, type FacilitatorClient } from "@x402/core/server";
import { USDC_PUBNET_ADDRESS, USDC_TESTNET_ADDRESS, getRpcUrl } from "@x402/stellar";
import type { ChargeRpc } from "./mpp-card-charge.js";

export type StellarNetwork = "stellar:testnet" | "stellar:pubnet";

export interface SellerConfig {
  network: StellarNetwork;
  /** The account (G…) or contract (C…) the seller is paid to. */
  payTo: string;
  /** The USDC SAC address on `network`. */
  usdc: string;
  /** Soroban RPC URL the MPP charge simulates and broadcasts through. */
  rpcUrl: string;
  /** The x402 facilitator (OZ Channels in production). */
  facilitator: FacilitatorClient;
  /** HMAC key binding MPP challenges to their contents (at least 32 bytes). */
  mppSecretKey: string;
  /** Price of each paid resource, in USDC base units (7 decimals): 0.001 USDC. */
  priceBaseUnits: "10000";
  /** Injectable for tests; production builds one over `rpc.Server` from `rpcUrl`. */
  rpc?: ChargeRpc;
}

/** The OZ Channels testnet facilitator; pubnet has no default and needs `FACILITATOR_URL`. */
const TESTNET_FACILITATOR = "https://channels.openzeppelin.com/x402/testnet";

/** The OZ Channels facilitator, authenticated with `OZ_API_KEY`. */
export function createFacilitator(env: Record<string, string | undefined>, network: StellarNetwork): FacilitatorClient {
  const apiKey = env.OZ_API_KEY;
  if (!apiKey) {
    throw new Error("OZ_API_KEY is required. Generate one at https://channels.openzeppelin.com/testnet/gen (testnet).");
  }
  const url = env.FACILITATOR_URL || (network === "stellar:testnet" ? TESTNET_FACILITATOR : undefined);
  if (!url) throw new Error(`FACILITATOR_URL is required on ${network}`);
  return new HTTPFacilitatorClient({
    url,
    createAuthHeaders: async () => {
      const h = { Authorization: `Bearer ${apiKey}` };
      return { verify: h, settle: h, supported: h };
    },
  });
}

/**
 * Builds the seller's configuration from the environment: `STELLAR_NETWORK`
 * (default `stellar:testnet`), `SELLER_PAY_TO`, `OZ_API_KEY`,
 * `FACILITATOR_URL` (optional), `MPP_SECRET_KEY`, `SOROBAN_RPC_URL` (optional).
 */
export function configFromEnv(env: Record<string, string | undefined> = process.env): SellerConfig {
  const network = (env.STELLAR_NETWORK || "stellar:testnet") as StellarNetwork;
  if (network !== "stellar:testnet" && network !== "stellar:pubnet") {
    throw new Error(`STELLAR_NETWORK must be stellar:testnet or stellar:pubnet (got ${network})`);
  }
  const payTo = env.SELLER_PAY_TO;
  if (!payTo) throw new Error("SELLER_PAY_TO is required");
  if (!StrKey.isValidEd25519PublicKey(payTo) && !StrKey.isValidContract(payTo)) {
    // Only a prefix is echoed: enough to spot a pasted secret or a typo.
    throw new Error(
      `SELLER_PAY_TO must be a Stellar G… account or C… contract address (got "${payTo.slice(0, 4)}…")`,
    );
  }
  const mppSecretKey = env.MPP_SECRET_KEY;
  if (!mppSecretKey || mppSecretKey.length < 32) {
    throw new Error("MPP_SECRET_KEY is required (at least 32 characters)");
  }
  return {
    network,
    payTo,
    usdc: network === "stellar:pubnet" ? USDC_PUBNET_ADDRESS : USDC_TESTNET_ADDRESS,
    rpcUrl: getRpcUrl(network, env.SOROBAN_RPC_URL ? { url: env.SOROBAN_RPC_URL } : undefined),
    facilitator: createFacilitator(env, network),
    mppSecretKey,
    priceBaseUnits: "10000",
  };
}
