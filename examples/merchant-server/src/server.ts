import "dotenv/config";
import { createFacilitator, createMerchantApp, type StellarNetwork } from "./app.js";

const network = (process.env.STELLAR_NETWORK ?? "stellar:testnet") as StellarNetwork;
const payTo = process.env.STELLAR_RECIPIENT;
if (!payTo) throw new Error("STELLAR_RECIPIENT is required");
const app = createMerchantApp({ network, payTo, facilitator: createFacilitator(process.env) });
const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`x402 merchant server on http://localhost:${port} (${network})`));
