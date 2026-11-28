import "dotenv/config";
import path from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import {
  CardPolicyDenied,
  DEFAULT_APP_URL,
  GuardDenied,
  PaymentError,
  allowMerchantUrl,
  formatUsdc,
  type Guard,
  parseGuardConfig,
  pay,
  readCardInfo,
} from "@mooring-live/x402-client";
import { appendReceipt, defaultStateDir, fileGuard, loadGuardConfig } from "@mooring-live/x402-client/node";
import { explorerUrl, fail, readEnv, required, rpcUrlFor } from "./config.js";

const card = required("MOORING_CARD");
const service = required("MOORING_SERVICE");
const { network, rpcUrl, passphrase } = readEnv();

let agent: Keypair;
try {
  agent = Keypair.fromSecret(required("AGENT_SECRET"));
} catch {
  fail("AGENT_SECRET is not a Stellar secret key (S...).");
}

// Local caps (mooring.guard.json over MOORING_DAILY_CAP / MOORING_TOTAL_CAP /
// MOORING_MAX_PER_TX) and the stop switch, checked before the agent key signs.
const stateDir = defaultStateDir();
let guard: Guard;
try {
  guard = fileGuard({ stateDir, caps: parseGuardConfig(loadGuardConfig(process.cwd())) });
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

try {
  const result = await pay(service, undefined, {
    card,
    agent,
    network,
    rpcUrl,
    guard,
    onReceipt: (r) => appendReceipt(stateDir, r),
  });

  if (result.protocol === "none") {
    console.log(`HTTP ${result.response.status}: ${service} did not ask for payment`);
  } else if (result.settlement) {
    const { amount, payTo, txHash } = result.settlement;
    console.log(`Paid ${formatUsdc(amount)} USDC to ${payTo} via ${result.protocol}`);
    console.log(`tx ${txHash} — ${explorerUrl(network, txHash)}`);
  } else {
    console.log(`Paid via ${result.protocol} (the seller reported no settlement)`);
  }

  try {
    const info = await readCardInfo(rpcUrlFor(rpcUrl), passphrase, card);
    console.log(`Remaining this period: ${formatUsdc(info.remaining)} USDC`);
  } catch (err) {
    console.log(`Remaining this period: unknown (${err instanceof Error ? err.message : String(err)})`);
  }
  if (result.receipt) {
    console.log(`Receipt ${result.receipt.id} → ${path.join(stateDir, "receipts.jsonl")}`);
  }
  console.log(await result.response.text());
} catch (err) {
  if (err instanceof GuardDenied) {
    console.log(`Refused before signing: ${err.reason}`);
    console.log(`  ${err.attempted} USDC attempted${err.limit !== undefined ? `, limit ${err.limit} USDC` : ""}`);
  } else if (err instanceof CardPolicyDenied) {
    console.log(`The card refused the payment: ${err.reason}`);
    if (err.reason === "not_allowlisted" && err.merchant?.url) {
      console.log(`Allow it: ${allowMerchantUrl(DEFAULT_APP_URL, card, err.merchant.url)}`);
    }
    if (err.reason === "insufficient_balance") {
      console.log(`Fund the card at https://app.mooring.live (card ${card})`);
    }
  } else if (err instanceof PaymentError) {
    console.log(`Payment failed (${err.kind}): ${err.detail ?? err.message}`);
    if (err.detail?.startsWith("agent_unfunded")) {
      // An agent-paid MPP charge needs the agent account to exist with XLM for the fee.
      console.log(`Fund the agent account with XLM (testnet: https://friendbot.stellar.org?addr=${agent.publicKey()})`);
    }
    if (err.transaction) console.log(`tx ${err.transaction} — ${explorerUrl(network, err.transaction)}`);
  } else {
    throw err;
  }
  process.exitCode = 1;
}
