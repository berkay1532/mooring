import type { StellarNetwork } from "./scheme.js";

/** The Mooring contracts a network has; see `docs/testnet.md` ("Deployment v2"). */
export interface Deployment {
  factory: string;
  usdc: string;
  cardWasmHash: string;
}

export const KNOWN_DEPLOYMENTS: Partial<Record<StellarNetwork, Deployment>> = {
  "stellar:testnet": {
    factory: "CBMSK4OSNLBEXTJWNEWX422RPVDEUNFEWADTSPECGBI26ESDYW65AUSE",
    usdc: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    cardWasmHash: "158b6acf3cde928e2c9c18c9e0f79fd29f7b847b7c73908c3972ef923c85d20f",
  },
};

/** @throws when Mooring is not deployed on `network` (mainnet follows the audit). */
export function deploymentFor(network: StellarNetwork): Deployment {
  const d = KNOWN_DEPLOYMENTS[network];
  if (!d) throw new Error(`Mooring is not deployed on ${network} yet (pass --factory and --token to use your own)`);
  return d;
}
