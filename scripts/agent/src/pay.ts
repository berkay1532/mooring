import { contract, Keypair, rpc } from "@stellar/stellar-sdk";
import {
  agentKeypair,
  buildCardTransfer,
  env,
  loadDeployed,
  NETWORK_PASSPHRASE,
  reportFailure,
  server,
  waitForTx,
} from "./common.js";
import { signCardAuthEntries } from "./card-signer.js";

const d = loadDeployed();
const agent = agentKeypair();
const submitter = Keypair.fromSecret(env("SUBMITTER_A_SECRET"));
const amount = BigInt(process.env.AMOUNT ?? "60000000");

console.log("card    :", d.card);
console.log("merchant:", d.merchant);
console.log("amount  :", amount.toString());

const tx = await buildCardTransfer(d, submitter.publicKey(), amount);
console.log("needs signatures from:", tx.needsNonInvokerSigningBy());

const latest = (await server.getLatestLedger()).sequence;
await signCardAuthEntries(tx, d.card, agent, latest + 60);
await tx.simulate();

if (!tx.simulation || rpc.Api.isSimulationError(tx.simulation)) {
  throw new Error(
    `simulation after signing failed: ${tx.simulation ? tx.simulation.error : "not simulated"}`,
  );
}

const sim = tx.simulation as rpc.Api.SimulateTransactionSuccessResponse;
console.log("minResourceFee (stroops):", sim.minResourceFee);

const sent = await tx.signAndSend({
  signTransaction: contract.basicNodeSigner(submitter, NETWORK_PASSPHRASE)
    .signTransaction,
});
const hash = sent.sendTransactionResponse!.hash;
const final = await waitForTx(hash);

// pay.ts is the expected-SUCCESS script: a FAILED payment is an error, and the
// reason has to be visible at the terminal rather than buried on an explorer.
if (final.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
  reportFailure(hash, final);
  process.exit(1);
}

console.log("tx:", hash, "status:", final.status);
