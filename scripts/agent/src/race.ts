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
const amount = BigInt(process.env.AMOUNT ?? "30000000");

async function buildSigned(submitter: Keypair) {
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
  if (!tx.simulation || rpc.Api.isSimulationError(tx.simulation)) {
    throw new Error(
      `initial simulation failed: ${tx.simulation ? tx.simulation.error : "not simulated"}`,
    );
  }
  const needs = tx.needsNonInvokerSigningBy();
  if (!needs.includes(d.card)) {
    throw new Error(
      `expected the card ${d.card} to need an auth signature, got ${JSON.stringify(needs)}`,
    );
  }
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
  return { hash: res.hash, status: final.status };
}

const submitterA = Keypair.fromSecret(env("SUBMITTER_A_SECRET"));
const submitterB = Keypair.fromSecret(env("SUBMITTER_B_SECRET"));

// Both are simulated against the same state, so both pass simulation.
const a = await buildSigned(submitterA);
const b = await buildSigned(submitterB);

const first = await submit(a, submitterA);
console.log("first :", first.hash, first.status); // expected SUCCESS
const second = await submit(b, submitterB);
console.log("second:", second.hash, second.status); // expected FAILED (OverBudget on-chain)
