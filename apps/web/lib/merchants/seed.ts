/** A well-known paid service offered as a one-click starting point. */
export interface SeedService {
  name: string;
  url: string;
  note: string;
}

const RAIL402_DEMO: SeedService = {
  name: "Rail402 demo",
  url: "https://demo.rail402.dev/weather",
  note: "Current weather, 0.001 USDC",
};

const LOCAL_EXAMPLE: SeedService = {
  name: "Example merchant (local)",
  url: "http://localhost:3001/weather",
  note: "examples/merchant-server",
};

/**
 * Seed services for `network`. Testnet lists the Rail402 demo, plus the local
 * example when `allowLocal`; pubnet and unknown networks list none. This only
 * controls what the UI shows — the server decides what it will resolve.
 */
export function seedServices(network: string, allowLocal: boolean): SeedService[] {
  if (network !== "stellar:testnet") return [];
  return allowLocal ? [RAIL402_DEMO, LOCAL_EXAMPLE] : [RAIL402_DEMO];
}
