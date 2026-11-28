import "dotenv/config";
import { formatUsdc, readCardInfo, readMerchants } from "@mooring-live/x402-client";
import { readEnv, required, rpcUrlFor } from "./config.js";

const STATES = ["active", "frozen", "cancelled"] as const;

const card = required("MOORING_CARD");
const { network, rpcUrl, passphrase } = readEnv();
const url = rpcUrlFor(rpcUrl);
const [info, merchants] = await Promise.all([
  readCardInfo(url, passphrase, card),
  readMerchants(url, passphrase, card),
]);

const expiry = new Date(Number(info.policy.expiry) * 1000).toISOString();
console.log(`Card ${card} (${info.label}) on ${network}`);
console.log(`State: ${STATES[info.state]}`);
console.log(`Balance: ${formatUsdc(info.balance)} USDC`);
console.log(
  `Budget: ${formatUsdc(info.policy.period_amount)} USDC every ${info.policy.period_duration}s, ` +
    `${formatUsdc(info.period.spent)} spent, ${formatUsdc(info.remaining)} remaining this period`,
);
console.log(`Max per payment: ${formatUsdc(info.policy.max_per_tx)} USDC`);
console.log(`Expires: ${expiry}`);
console.log(`Merchants (${merchants.length}):`);
for (const m of merchants) console.log(`  ${m}`);
