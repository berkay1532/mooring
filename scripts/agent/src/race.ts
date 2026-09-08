import { contract, Keypair, rpc } from "@stellar/stellar-sdk";
import {
  agentKeypair,
  buildCardTransfer,
  env,
  loadDeployed,
  reportFailure,
  server,
  waitForTx,
} from "./common.js";
import { signCardAuthEntries } from "./card-signer.js";

const d = loadDeployed();
const agent = agentKeypair();
const amount = BigInt(process.env.AMOUNT ?? "30000000");

async function buildSigned(submitter: Keypair) {
  const tx = await buildCardTransfer(d, submitter.publicKey(), amount);
  const latest = (await server.getLatestLedger()).sequence;
  await signCardAuthEntries(tx, d.card, agent, latest + 60);
  await tx.simulate();
  if (!tx.simulation || rpc.Api.isSimulationError(tx.simulation)) {
    throw new Error(
      `simulation after signing failed: ${tx.simulation ? tx.simulation.error : "not simulated"}`,
    );
  }
  return tx;
}

// Signs `tx.built` in place, so each AssembledTransaction is single-use here.
async function submit(
  tx: contract.AssembledTransaction<unknown>,
  submitter: Keypair,
) {
  const built = tx.built!;
  built.sign(submitter);
  const res = await server.sendTransaction(built);
  if (res.status !== "PENDING") {
    throw new Error(`send failed: ${JSON.stringify(res)}`);
  }
  const final = await waitForTx(res.hash);
  return { hash: res.hash, response: final, status: final.status };
}

const submitterA = Keypair.fromSecret(env("SUBMITTER_A_SECRET"));
const submitterB = Keypair.fromSecret(env("SUBMITTER_B_SECRET"));

// Both are simulated against the same state, so both pass simulation.
const a = await buildSigned(submitterA);
const b = await buildSigned(submitterB);

const first = await submit(a, submitterA);
console.log("first :", first.hash, first.status); // expected SUCCESS
if (first.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
  reportFailure(first.hash, first.response);
}

const second = await submit(b, submitterB);
console.log("second:", second.hash, second.status); // expected FAILED (OverBudget on-chain)
// A FAILED second transaction is the point of this script, so this is evidence,
// not an error: the diagnostics should name the card's `#8 OverBudget`.
if (second.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
  reportFailure(second.hash, second.response);
}
