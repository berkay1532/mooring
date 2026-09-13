import { execFileSync } from "node:child_process";
import { Keypair, rpc } from "@stellar/stellar-sdk";
import { readCardInfo } from "@mooring/x402-client";
import {
  agentKeypair,
  buildCardTransfer,
  env,
  loadDeployed,
  NETWORK_PASSPHRASE,
  RPC_URL,
  server,
} from "./common.js";
import { signCardAuthEntries } from "./card-signer.js";

/**
 * Measures the card payment `minResourceFee` twice on testnet: once against the
 * card's untouched 1-merchant allowlist (the baseline) and once with the
 * allowlist full (32 entries). The allowlist is a bounded `Vec<Address>` in
 * instance storage (see `contracts/card/src/allowlist.rs`), so a full list
 * makes `__check_auth` read and rewrite a larger instance entry than the
 * 1-merchant baseline.
 *
 * This script never submits the payment: it only builds, signs and
 * re-simulates it, exactly like `pay.ts`, then reads off `minResourceFee`
 * from the simulation result.
 *
 * The card's live allowlist is a shared testnet fixture, so this script
 * temporarily grows it to 32 with 31 freshly generated addresses and always
 * shrinks it back to 1 in a `finally`, even if a step above fails.
 */

const d = loadDeployed();
const MERCHANTS_TO_ADD = 31;

function invokeOwner(fn: string, merchant: string): void {
  execFileSync(
    "stellar",
    [
      "contract",
      "invoke",
      "--source-account",
      "mooring-owner",
      "--network",
      "testnet",
      "--id",
      d.card,
      "--",
      fn,
      "--merchant",
      merchant,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
}

async function allowCount(): Promise<number> {
  const info = await readCardInfo(RPC_URL, NETWORK_PASSPHRASE, d.card);
  return info.allow_count;
}

/**
 * Builds, signs and re-simulates a card payment (never submits it) and returns
 * the simulation's `minResourceFee`. Used twice: once against the untouched
 * 1-merchant allowlist (the baseline) and once at 32 merchants.
 */
async function measureMinResourceFee(): Promise<string> {
  const info = await readCardInfo(RPC_URL, NETWORK_PASSPHRASE, d.card);
  const amount = [info.remaining, info.policy.max_per_tx, info.balance, 60_000_000n]
    .reduce((a, b) => (b < a ? b : a));
  console.log(
    `remaining=${info.remaining} max_per_tx=${info.policy.max_per_tx} balance=${info.balance} -> amount=${amount}`,
  );

  const agent = agentKeypair();
  const submitter = Keypair.fromSecret(env("SUBMITTER_A_SECRET"));

  const tx = await buildCardTransfer(d, submitter.publicKey(), amount);
  const latest = (await server.getLatestLedger()).sequence;
  await signCardAuthEntries(tx, d.card, agent, latest + 60);
  await tx.simulate();

  if (!tx.simulation || rpc.Api.isSimulationError(tx.simulation)) {
    throw new Error(
      `simulation after signing failed: ${tx.simulation ? tx.simulation.error : "not simulated"}`,
    );
  }

  return (tx.simulation as rpc.Api.SimulateTransactionSuccessResponse).minResourceFee;
}

console.log("card:", d.card);

const startCount = await allowCount();
if (startCount !== 1) {
  throw new Error(
    `refusing to run: allow_count is ${startCount}, expected 1 (a prior run may have left the allowlist dirty)`,
  );
}
console.log("initial allow_count == 1, confirmed.");

console.log("baseline (1 merchant) minResourceFee:", await measureMinResourceFee());

const addresses = Array.from({ length: MERCHANTS_TO_ADD }, () => Keypair.random().publicKey());
let added = 0;
const failedRemovals: string[] = [];

try {
  console.log(`adding ${MERCHANTS_TO_ADD} merchants...`);
  for (let i = 0; i < addresses.length; i++) {
    console.log(`  [add ${i + 1}/${MERCHANTS_TO_ADD}] ${addresses[i]}`);
    invokeOwner("add_merchant", addresses[i]);
    added++;
  }

  const grownCount = await allowCount();
  if (grownCount !== 32) {
    throw new Error(`expected allow_count 32 after adding, got ${grownCount}`);
  }
  console.log("allow_count == 32, confirmed.");

  console.log(
    "minResourceFee (32-merchant allowlist, stroops):",
    await measureMinResourceFee(),
  );
  console.log(
    "(this script never submits — simulation only, the allowlist is restored in `finally`)",
  );
} finally {
  console.log(`restoring the allowlist (removing ${added} merchants)...`);
  for (let i = 0; i < added; i++) {
    console.log(`  [remove ${i + 1}/${added}] ${addresses[i]}`);
    try {
      invokeOwner("remove_merchant", addresses[i]);
    } catch (e) {
      console.error(`  failed to remove ${addresses[i]}:`, e);
      failedRemovals.push(addresses[i]);
    }
  }

  const finalCount = await allowCount();
  console.log("final allow_count:", finalCount);
  if (finalCount !== 1 || failedRemovals.length > 0) {
    console.error(
      `WARNING: allowlist not fully restored (allow_count=${finalCount}, failed removals: ${failedRemovals.join(", ") || "none"}). Manual cleanup required via 'stellar contract invoke ... -- remove_merchant --merchant <G>'.`,
    );
    process.exitCode = 1;
  }
}
