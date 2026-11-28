import { serve } from "@hono/node-server";
import { createSellerApp } from "./app.js";
import { configFromEnv } from "./config.js";

// Local development: reads apps/seller/.env when present (see .env.example).
try {
  process.loadEnvFile(".env");
} catch {
  // No .env: the environment is used as is.
}

const cfg = configFromEnv(process.env);
const port = Number(process.env.PORT ?? 3002);
serve({ fetch: createSellerApp(cfg).fetch, port }, () => {
  console.log(`Mooring example seller on http://localhost:${port} (${cfg.network}, pays ${cfg.payTo})`);
});
