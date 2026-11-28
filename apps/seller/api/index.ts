import { handle } from "hono/vercel";
import { createSellerApp } from "../src/app.js";
import { configFromEnv } from "../src/config.js";

const app = createSellerApp(configFromEnv(process.env));

export default handle(app);
