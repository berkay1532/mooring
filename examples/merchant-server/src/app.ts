import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import type { FacilitatorClient, RoutesConfig } from "@x402/core/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";

export type StellarNetwork = "stellar:testnet" | "stellar:pubnet";

export interface MerchantConfig {
  network: StellarNetwork;
  payTo: string;
  facilitator: FacilitatorClient;
  routes?: RoutesConfig;
}

export function defaultRoutes(network: StellarNetwork, payTo: string): RoutesConfig {
  return {
    "GET /weather": {
      accepts: { scheme: "exact", price: "$0.001", network, payTo },
      description: "Current weather (sample paid resource)",
    },
    "GET /premium": {
      accepts: { scheme: "exact", price: "$20", network, payTo },
      description: "Deliberately priced above a typical card per-tx cap",
    },
  };
}

export function createFacilitator(env: NodeJS.ProcessEnv): FacilitatorClient {
  const apiKey = env.OZ_API_KEY;
  if (!apiKey) {
    throw new Error("OZ_API_KEY is required. Generate one at https://channels.openzeppelin.com/testnet/gen (testnet).");
  }
  return new HTTPFacilitatorClient({
    url: env.FACILITATOR_URL ?? "https://channels.openzeppelin.com/x402/testnet",
    createAuthHeaders: async () => {
      const h = { Authorization: `Bearer ${apiKey}` };
      return { verify: h, settle: h, supported: h };
    },
  });
}

export function createMerchantApp(config: MerchantConfig): express.Express {
  const resourceServer = new x402ResourceServer(config.facilitator).register(config.network, new ExactStellarScheme());
  const app = express();
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use(paymentMiddleware(config.routes ?? defaultRoutes(config.network, config.payTo), resourceServer));
  app.get("/weather", (_req, res) => res.json({ city: "Istanbul", temp: 24, conditions: "Clear" }));
  app.get("/premium", (_req, res) => res.json({ tier: "premium" }));
  return app;
}
