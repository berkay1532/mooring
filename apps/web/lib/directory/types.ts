/**
 * The merchant directory: paid Stellar services aggregated server-side from
 * public x402/MPP discovery catalogues, normalised to one shape. Entries are
 * *listed, not vetted*: the UI re-reads the live 402 before an owner allows one.
 */

/** Where an entry came from; also the dedupe priority (first wins). */
export type DirectorySource = "rail402" | "stellarsight" | "bazaar" | "mpprouter";
export const SOURCE_PRIORITY: readonly DirectorySource[] = ["rail402", "stellarsight", "bazaar", "mpprouter"];

export type DirectoryNetwork = "stellar:testnet" | "stellar:pubnet";

/** One payable service, as the UI lists it. */
export interface DirectoryEntry {
  /** Stable id: `${source}:${network}:${payTo}:${url}[#tool]`. */
  id: string;
  source: DirectorySource;
  /** The resource URL an agent calls (and the resolver re-checks). */
  url: string;
  host: string;
  name: string;
  description?: string;
  iconUrl?: string;
  payTo: string;
  network: DirectoryNetwork;
  /** Token contract (SAC) the seller accepts. */
  asset: string;
  /** Price per request in base units (7 decimals). */
  amount: string;
  scheme: "exact";
  kind: "http" | "mcp";
  method?: "GET" | "POST";
  tags: string[];
  /** One address fronts many services (a router/reseller): allowing it allows all of them. */
  proxy: boolean;
  /** The source verified the seller (domain/ownership or an end-to-end payment). */
  verified: boolean;
  /** Settlements or recent calls the source has recorded, when it says. */
  settlements?: number;
  /** ISO timestamp of the source's last update for this entry. */
  lastSeen?: string;
}

/** What one source contributed to a snapshot. */
export interface SourceReport {
  source: DirectorySource;
  ok: boolean;
  /** Entries after normalisation (before dedupe). */
  count: number;
  error?: string;
}

/** Everything the server knows at one point in time. */
export interface DirectorySnapshot {
  fetchedAt: string;
  entries: DirectoryEntry[];
  sources: SourceReport[];
}

/** The `GET /api/directory` response. */
export interface DirectoryResponse {
  network: DirectoryNetwork;
  fetchedAt: string;
  sources: SourceReport[];
  /** Services payable from a card on `network` (its USDC). */
  items: DirectoryEntry[];
  /** The other network, for the read-only "On mainnet" section. */
  other: {
    network: DirectoryNetwork;
    /** All payable entries there, proxied ones included. */
    count: number;
    /** How many of them sit behind a proxy address. */
    proxyCount: number;
    /** Non-proxy entries, capped. */
    items: DirectoryEntry[];
  };
}

/** USDC SAC per network — the token a card holds; anything else is not payable. */
export const USDC_BY_NETWORK: Record<DirectoryNetwork, string> = {
  "stellar:testnet": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  "stellar:pubnet": "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
};

export function isDirectoryNetwork(v: unknown): v is DirectoryNetwork {
  return v === "stellar:testnet" || v === "stellar:pubnet";
}

export function otherNetwork(n: DirectoryNetwork): DirectoryNetwork {
  return n === "stellar:testnet" ? "stellar:pubnet" : "stellar:testnet";
}
