import { Hono } from "hono";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { payment } from "mppx/hono";
import { Mppx } from "mppx/server/core";
import type { SellerConfig } from "./config.js";
import { cardChargeServer, chargeRpcFromServer } from "./mpp-card-charge.js";
import { pickQuote } from "./quotes.js";

export const DOCS_URL = "https://github.com/berkay1532/mooring/blob/main/docs/seller.md";

/**
 * Mooring's example seller: the same paid resource over x402 (`/quote`,
 * settled by the facilitator) and over MPP charge (`/quote/mpp`, broadcast by
 * this server), both payable from a Mooring card.
 */
export function createSellerApp(cfg: SellerConfig): Hono {
  const { network, payTo, usdc } = cfg;
  const amount = cfg.priceBaseUnits;

  const resourceServer = new x402ResourceServer(cfg.facilitator).register(network, new ExactStellarScheme());
  const mppx = Mppx.create({
    methods: [cardChargeServer({ network, usdc, payTo, rpc: cfg.rpc ?? chargeRpcFromServer(cfg.rpcUrl, network) })],
    secretKey: cfg.mppSecretKey,
  });

  const quote = (paidWith: "x402" | "mpp") => {
    const now = Date.now();
    return { ...pickQuote(now), paidWith, ts: new Date(now).toISOString() };
  };

  const app = new Hono();

  app.get("/", (c) =>
    c.json({
      name: "Mooring example seller",
      network,
      payTo,
      resources: [
        { path: "/quote", protocol: "x402", amount, asset: usdc },
        { path: "/quote/mpp", protocol: "mpp", amount, asset: usdc },
      ],
      docs: DOCS_URL,
    }),
  );

  app.get("/health", (c) => c.json({ ok: true }));

  app.use(
    "/quote",
    paymentMiddleware(
      {
        "GET /quote": {
          accepts: { scheme: "exact", price: "$0.001", network, payTo },
          description: "A public-domain quote, paid over x402",
        },
      },
      resourceServer,
    ),
  );
  app.get("/quote", (c) => c.json(quote("x402")));

  app.get(
    "/quote/mpp",
    payment(mppx.charge, {
      amount,
      currency: usdc,
      recipient: payTo,
      description: "A public-domain quote, paid over MPP charge",
      methodDetails: { network, credentialTypes: ["transaction"] },
    }),
    (c) => c.json(quote("mpp")),
  );

  return app;
}
