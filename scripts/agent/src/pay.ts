import { Address, contract, Keypair, nativeToScVal, rpc } from "@stellar/stellar-sdk";
import {
  agentKeypair,
  env,
  loadDeployed,
  NETWORK_PASSPHRASE,
  RPC_URL,
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

const tx = await contract.AssembledTransaction.build({
  contractId: d.token,
  method: "transfer",
  args: [
    nativeToScVal(Address.fromString(d.card), { type: "address" }),
    nativeToScVal(Address.fromString(d.merchant), { type: "address" }),
    nativeToScVal(amount, { type: "i128" }),
  ],
  networkPassphrase: NETWORK_PASSPHRASE,
  rpcUrl: RPC_URL,
  publicKey: submitter.publicKey(),
  parseResultXdr: (r) => r,
});

// The recording simulation must succeed, otherwise no auth entries are
// recorded and `signAuthEntries` below would silently sign nothing.
if (!tx.simulation || rpc.Api.isSimulationError(tx.simulation)) {
  throw new Error(
    `initial simulation failed: ${tx.simulation ? tx.simulation.error : "not simulated"}`,
  );
}

const needs = tx.needsNonInvokerSigningBy();
console.log("needs signatures from:", needs);
if (!needs.includes(d.card)) {
  throw new Error(
    `expected the card ${d.card} to need an auth signature, got ${JSON.stringify(needs)}`,
  );
}

const latest = (await server.getLatestLedger()).sequence;
await signCardAuthEntries(tx, d.card, agent, latest + 60);
await tx.simulate();

if (rpc.Api.isSimulationError(tx.simulation!)) {
  throw new Error(`simulation after signing failed: ${tx.simulation.error}`);
}

const sim = tx.simulation as rpc.Api.SimulateTransactionSuccessResponse;
console.log("minResourceFee (stroops):", sim.minResourceFee);

const sent = await tx.signAndSend({
  signTransaction: contract.basicNodeSigner(submitter, NETWORK_PASSPHRASE)
    .signTransaction,
});
const hash = sent.sendTransactionResponse!.hash;
const final = await waitForTx(hash);
console.log("tx:", hash, "status:", final.status);
