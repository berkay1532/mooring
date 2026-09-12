/**
 * End-to-end proof on Stellar testnet: an agent pays an x402-protected API
 * from a Mooring card through the stock `@x402/express` server and the
 * OpenZeppelin Channels facilitator, and is denied — locally and by the card
 * itself — when the policy says no.
 *
 * Not part of `npm test`: it spends real testnet USDC, needs an OZ API key and
 * the live deployment in `deployed.testnet.json`. Run it with `npm run e2e`
 * from the repo root, after `scripts/testnet/reset-policy.sh`.
 *
 * Scenarios
 *  1. paid        — GET /weather ($0.001) paid from the card and settled on-chain.
 *  2. precheck    — GET /premium ($20) is above max_per_tx: refused before signing.
 *  3. card denial — an unlisted merchant with the pre-check disabled: the card's
 *                   `__check_auth` rejects the signed payment in the enforcing
 *                   simulation, so it never reaches the facilitator.
 *  4. facilitator — the same unlisted-merchant payload presented straight to OZ
 *                   Channels, to record what the facilitator itself answers.
 *
 * Prints one JSON evidence block on stdout (never a secret), and exits
 * non-zero if any scenario did not behave as documented.
 */
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { Address, Keypair, contract, nativeToScVal, rpc } from "@stellar/stellar-sdk";
import { config as loadEnv } from "dotenv";
import { createFacilitator, createMerchantApp } from "../../../examples/merchant-server/src/app.js";
import {
  CardPolicyDenied,
  createMooringFetch,
  getSettlement,
  readCardInfo,
  signCardAuthEntries,
} from "../src/index.js";
import type { CardInfo } from "../src/index.js";

const root = new URL("../../../", import.meta.url);
loadEnv({ path: new URL("scripts/agent/.env", root).pathname });
loadEnv({ path: new URL("examples/merchant-server/.env", root).pathname });

const d = JSON.parse(readFileSync(new URL("deployed.testnet.json", root), "utf8")) as {
  card: string;
  token: string;
  merchant: string;
  funder: string;
};

const RPC = "https://soroban-testnet.stellar.org";
const HORIZON = "https://horizon-testnet.stellar.org";
const PASS = "Test SDF Network ; September 2015";
const NETWORK = "stellar:testnet" as const;
const PRICE = 10_000n; // $0.001 USDC, 7 decimals

if (!process.env.AGENT_SECRET) throw new Error("AGENT_SECRET is required (scripts/agent/.env)");
if (!process.env.OZ_API_KEY) throw new Error("OZ_API_KEY is required (examples/merchant-server/.env)");
const agent = Keypair.fromSecret(process.env.AGENT_SECRET);
const facilitator = createFacilitator(process.env);
const facilitatorUrl = process.env.FACILITATOR_URL ?? "https://channels.openzeppelin.com/x402/testnet";

interface Server {
  url: string;
  close: () => Promise<void>;
}

/** Starts the example merchant app in-process on a random free port. */
async function listen(payTo: string): Promise<Server> {
  const app = createMerchantApp({ network: NETWORK, payTo, facilitator });
  return new Promise<Server>((resolve) => {
    const srv = app.listen(0, () =>
      resolve({
        url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`,
        close: () =>
          new Promise<void>((done) => {
            srv.closeAllConnections();
            srv.close(() => done());
          }),
      }),
    );
  });
}

/**
 * Reads the card until `spent` moves off `from`, or gives up. The facilitator
 * answers as soon as it has the transaction result; the RPC it answers from
 * may still be a ledger behind.
 */
async function readCardAfterSpend(from: bigint): Promise<CardInfo> {
  let info = await readCardInfo(RPC, PASS, d.card);
  for (let i = 0; i < 10 && info.period.spent === from; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    info = await readCardInfo(RPC, PASS, d.card);
  }
  return info;
}

/** The public record of a settlement: did it succeed, and what did it cost? */
async function horizonTransaction(hash: string): Promise<unknown> {
  const res = await fetch(`${HORIZON}/transactions/${hash}`);
  if (!res.ok) return { status: res.status };
  const tx = (await res.json()) as Record<string, unknown>;
  return {
    successful: tx.successful,
    ledger: tx.ledger,
    max_fee: tx.max_fee,
    fee_charged: tx.fee_charged,
    source_account: tx.source_account,
  };
}

/**
 * Builds a payment the card will refuse, and asks the facilitator to verify
 * it. `createMooringFetch` cannot produce this: the card rejects the payment
 * in the client's own enforcing simulation, so scenario 3 never reaches the
 * facilitator — but the facilitator's verdict is worth recording, because on
 * an untrusted network it, and not the client, is what stops the payment.
 */
async function askFacilitatorToVerify(payTo: string): Promise<unknown> {
  const tx = await contract.AssembledTransaction.build({
    contractId: d.token,
    method: "transfer",
    args: [
      nativeToScVal(Address.fromString(d.card), { type: "address" }),
      nativeToScVal(Address.fromString(payTo), { type: "address" }),
      nativeToScVal(PRICE, { type: "i128" }),
    ],
    networkPassphrase: PASS,
    rpcUrl: RPC,
    parseResultXdr: (r) => r,
    useUpgradedAuth: false,
  });
  const server = new rpc.Server(RPC);
  const expiration = (await server.getLatestLedger()).sequence + 12;
  await signCardAuthEntries(tx, d.card, agent, expiration);
  // Expected to fail (that is the point); it leaves the signed entries in place.
  await tx.simulate({ useUpgradedAuth: false }).catch(() => undefined);

  const requirements = {
    scheme: "exact",
    network: NETWORK,
    payTo,
    asset: d.token,
    amount: PRICE.toString(),
    maxTimeoutSeconds: 60,
    resource: "http://127.0.0.1/weather",
    description: "",
    mimeType: "application/json",
    extra: { areFeesSponsored: true },
  };
  const res = await fetch(`${facilitatorUrl}/verify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${process.env.OZ_API_KEY}`,
    },
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload: { x402Version: 2, accepted: requirements, payload: { transaction: tx.built!.toXDR() } },
      paymentRequirements: requirements,
    }),
  });
  return { status: res.status, body: await res.json() };
}

const evidence: Record<string, unknown> = {
  card: d.card,
  network: NETWORK,
  facilitator: facilitatorUrl,
  ranAt: new Date().toISOString(),
};
const failures: string[] = [];

function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}

/** Describes an unexpected throw without leaking anything but its message. */
function describeError(e: unknown): Record<string, unknown> {
  return e instanceof Error ? { name: e.name, message: e.message } : { value: String(e) };
}

try {
  // 1. Happy path: pay /weather from the card through OZ Channels.
  {
    const srv = await listen(d.merchant);
    try {
      const before = await readCardInfo(RPC, PASS, d.card);
      const pay = createMooringFetch({ card: d.card, agent, network: NETWORK });
      const res = await pay(`${srv.url}/weather`);
      const settlement = getSettlement(res);
      const body: unknown = await res.json();
      const after = await readCardAfterSpend(before.period.spent);
      evidence.paid = {
        status: res.status,
        body,
        settlement,
        spentBefore: before.period.spent,
        spentAfter: after.period.spent,
        remainingAfter: after.remaining,
        balanceAfter: after.balance,
        horizon: settlement?.transaction ? await horizonTransaction(settlement.transaction) : null,
      };
      check(res.status === 200, `happy path: expected HTTP 200, got ${res.status}`);
      check(settlement?.success === true, "happy path: settlement did not report success");
      check(
        typeof settlement?.transaction === "string" && settlement.transaction.length > 0,
        "happy path: settlement carries no transaction hash",
      );
      check(
        after.period.spent - before.period.spent === PRICE,
        `happy path: spent moved by ${after.period.spent - before.period.spent}, expected ${PRICE}`,
      );
    } catch (e) {
      evidence.paid = { error: describeError(e) };
      failures.push("happy path threw");
    } finally {
      await srv.close();
    }
  }

  // 2. Local denial: /premium is $20, above the card's 10 USDC per-payment cap.
  {
    const srv = await listen(d.merchant);
    try {
      const pay = createMooringFetch({ card: d.card, agent, network: NETWORK });
      const res = await pay(`${srv.url}/premium`);
      evidence.deniedPrecheck = { unexpectedStatus: res.status };
      failures.push("pre-check denial: the request was not denied");
    } catch (e) {
      evidence.deniedPrecheck =
        e instanceof CardPolicyDenied
          ? { reason: e.reason, stage: e.stage, message: e.message }
          : { error: describeError(e) };
      check(
        e instanceof CardPolicyDenied && e.reason === "over_per_tx_cap" && e.stage === "precheck",
        "pre-check denial: expected over_per_tx_cap at precheck",
      );
    } finally {
      await srv.close();
    }
  }

  // 3. The card's own denial: the merchant is not on the allowlist and the
  //    local pre-check is off, so only `__check_auth` can say no — which it
  //    does, in the enforcing simulation, before the payment leaves the agent.
  {
    const srv = await listen(d.funder); // holds USDC, but is not allowlisted
    try {
      const pay = createMooringFetch({ card: d.card, agent, network: NETWORK, precheck: false });
      const res = await pay(`${srv.url}/weather`);
      evidence.deniedByCard = { unexpectedStatus: res.status };
      failures.push("card denial: the request was not denied");
    } catch (e) {
      evidence.deniedByCard =
        e instanceof CardPolicyDenied
          ? { reason: e.reason, stage: e.stage, contractError: e.contractError, detail: e.detail }
          : { error: describeError(e) };
      check(
        e instanceof CardPolicyDenied && e.reason === "not_allowlisted" && e.stage === "simulate",
        "card denial: expected not_allowlisted at simulate",
      );
      check(
        e instanceof CardPolicyDenied && e.contractError === 6,
        "card denial: expected contract error #6 (NotAllowlisted)",
      );
    } finally {
      await srv.close();
    }
  }

  // 4. What the facilitator answers for that same payment.
  {
    try {
      evidence.deniedByFacilitator = await askFacilitatorToVerify(d.funder);
      const body = (evidence.deniedByFacilitator as { body?: { isValid?: boolean; invalidReason?: string } })
        .body;
      check(body?.isValid === false, "facilitator denial: verify did not report isValid false");
      check(
        typeof body?.invalidReason === "string" && body.invalidReason.includes("simulation_failed"),
        `facilitator denial: unexpected reason ${body?.invalidReason}`,
      );
    } catch (e) {
      evidence.deniedByFacilitator = { error: describeError(e) };
      failures.push("facilitator verify threw");
    }
  }
} finally {
  evidence.failures = failures;
  console.log(JSON.stringify(evidence, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
