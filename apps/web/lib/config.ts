export type StellarNetwork = "stellar:testnet" | "stellar:pubnet";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} — copy apps/web/.env.example to .env.local`);
  return v;
}

export const config = {
  network: required("NEXT_PUBLIC_STELLAR_NETWORK") as StellarNetwork,
  rpcUrl: required("NEXT_PUBLIC_RPC_URL"),
  networkPassphrase: required("NEXT_PUBLIC_NETWORK_PASSPHRASE"),
  factory: required("NEXT_PUBLIC_FACTORY_ADDRESS"),
  usdc: required("NEXT_PUBLIC_USDC_SAC"),
  docsUrl:
    process.env.NEXT_PUBLIC_DOCS_URL ??
    "https://github.com/berkay1532/mooring/blob/main/docs/x402-integration.md",
  walletMode: (process.env.NEXT_PUBLIC_WALLET ?? "freighter") as "freighter" | "mock",
} as const;
