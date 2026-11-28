import { afterEach, describe, expect, it, vi } from "vitest";
import { Asset, Keypair, Operation, StrKey, xdr } from "@stellar/stellar-sdk";
import { cardChargeMethod } from "@mooring-live/x402-client";
import { Challenge, Receipt } from "mppx";
import {
  CARD,
  LATEST_LEDGER,
  NULL_ACCOUNT,
  PAY_TO,
  TX_HASH,
  USDC,
  envelopeOf,
  fakeChargeRpc,
  rebuild,
  sellerApp,
  stubClientRpc,
  withEnvelope,
} from "./fixtures.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/** The card's `__check_auth` refusing a payment, as the RPC reports it. */
const cardRejection = (code: number) =>
  [
    "HostError: Error(Auth, InvalidAction)",
    "",
    "Event log (newest first):",
    `   0: [Diagnostic Event] contract:${USDC}, topics:[error, Error(Auth, InvalidAction)], ` +
      `data:["failed account authentication with error", ${CARD}, Error(Contract, #${code})]`,
  ].join("\n");

/**
 * Asks the seller for terms and pays them with the client's real charge
 * method, against a stubbed RPC: `payer` is the card (agent signs for it) or,
 * when `"agent"`, the agent's own account is the transfer's `from`.
 */
async function credentialFor(app: ReturnType<typeof sellerApp>, payer: "card" | "agent" = "card") {
  const agent = Keypair.random();
  stubClientRpc();
  const first = await app.request("/quote/mpp");
  expect(first.status).toBe(402);
  const challenge = Challenge.fromResponse(first);
  const method = cardChargeMethod(
    {
      card: payer === "card" ? CARD : agent.publicKey(),
      agent,
      network: "stellar:testnet",
      usdc: USDC,
      precheck: false,
    },
    { latestLedger: async () => LATEST_LEDGER },
  );
  const credential = await method.createCredential({ challenge: challenge as never });
  return { agent, credential };
}

const paid = (app: ReturnType<typeof sellerApp>, credential: string) =>
  app.request("/quote/mpp", { headers: { Authorization: credential } });

/** The problem detail (and `details.why`) of a refused credential, which comes with a fresh challenge. */
async function refusal(res: Response): Promise<{ detail: string; why: string }> {
  expect(res.status).toBe(402);
  expect(res.headers.get("WWW-Authenticate")).toMatch(/^Payment /);
  const body = await res.json();
  return { detail: String(body.detail), why: String(body.details?.why ?? "") };
}

describe("card-aware MPP charge", () => {
  it("accepts a card-paid pull credential and returns a Payment-Receipt with the tx hash", async () => {
    const rpc = fakeChargeRpc();
    const app = sellerApp(rpc);
    const { credential } = await credentialFor(app, "card");
    expect(credential).toMatch(/^Payment /);

    const res = await paid(app, credential);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ paidWith: "mpp", quote: expect.any(String) });
    const receipt = Receipt.fromResponse(res);
    expect(receipt).toMatchObject({ method: "stellar", status: "success", reference: TX_HASH });
    expect(rpc.simulate).toHaveBeenCalledTimes(1);
    expect(rpc.send).toHaveBeenCalledTimes(1);
    expect(rpc.send.mock.calls[0]![0]).toBe(envelopeOf(credential).toXDR());
    expect(rpc.wait).toHaveBeenCalledWith(TX_HASH);
  });

  it("accepts an account-paid pull credential (the agent's G… as from) and verifies its signature", async () => {
    const rpc = fakeChargeRpc();
    const app = sellerApp(rpc);
    const { agent, credential } = await credentialFor(app, "agent");
    const res = await paid(app, credential);
    expect(res.status).toBe(200);
    expect(Receipt.fromResponse(res).reference).toBe(TX_HASH);
    expect(rpc.send).toHaveBeenCalledTimes(1);
  });

  it("rejects an account-paid credential whose auth-entry signature does not verify", async () => {
    const rpc = fakeChargeRpc();
    const app = sellerApp(rpc);
    const { agent, credential } = await credentialFor(app, "agent");
    const tx = envelopeOf(credential);
    const entry = (tx.operations[0] as Operation.InvokeHostFunction).auth![0]!;
    if (entry.credentials.type !== "sorobanCredentialsAddress") throw new Error("expected v1 address credentials");
    const signed = entry.credentials.address;
    // A well-formed signature by the right key over the wrong payload.
    const wrong = xdr.ScVal.scvVec([
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("public_key"), val: xdr.ScVal.scvBytes(agent.rawPublicKey()) }),
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("signature"), val: xdr.ScVal.scvBytes(agent.sign(Buffer.alloc(32))) }),
      ]),
    ]);
    const tamperedEntry = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
        new xdr.SorobanAddressCredentials({
          address: signed.address,
          nonce: signed.nonce,
          signatureExpirationLedger: signed.signatureExpirationLedger,
          signature: wrong,
        }),
      ),
      rootInvocation: entry.rootInvocation,
    });
    const forged = rebuild(tx, { auth: [tamperedEntry], signer: agent });
    const { detail, why } = await refusal(await paid(app, withEnvelope(credential, { transaction: forged })));
    expect(detail).toContain("no authorization entry authorizes the transfer");
    expect(why).toContain("signature does not match");
    expect(rpc.simulate).not.toHaveBeenCalled();
    expect(rpc.send).not.toHaveBeenCalled();
  });

  it("rejects a DID that is not the transfer's from", async () => {
    const rpc = fakeChargeRpc();
    const app = sellerApp(rpc);
    const { credential } = await credentialFor(app, "card");
    const stranger = `did:pkh:stellar:testnet:${Keypair.random().publicKey()}`;
    const { detail, why } = await refusal(await paid(app, withEnvelope(credential, { source: stranger })));
    expect(detail).toContain("transaction is not the requested transfer");
    expect(why).toContain("not currency.transfer(from, payTo, amount)");
    expect(rpc.send).not.toHaveBeenCalled();
  });

  it("rejects a credential source that is not a Stellar DID on this network", async () => {
    const rpc = fakeChargeRpc();
    const app = sellerApp(rpc);
    const { credential } = await credentialFor(app, "card");
    for (const source of [
      `did:pkh:stellar:pubnet:${CARD}`,
      `did:pkh:eip155:1:0x0000000000000000000000000000000000000000`,
      `did:pkh:stellar:testnet:${StrKey.encodeMed25519PublicKey(Buffer.alloc(40))}`,
      `did:pkh:stellar:testnet:${CARD}:extra`,
    ]) {
      const { detail, why } = await refusal(await paid(app, withEnvelope(credential, { source })));
      expect(detail).toContain("credential source is not a Stellar DID on this network");
    }
    expect(rpc.send).not.toHaveBeenCalled();
  });

  it("rejects a transaction with two operations", async () => {
    const rpc = fakeChargeRpc();
    const app = sellerApp(rpc);
    const { agent, credential } = await credentialFor(app, "card");
    const twoOps = rebuild(envelopeOf(credential), {
      extraOps: [Operation.payment({ destination: PAY_TO, asset: Asset.native(), amount: "1" })],
      signer: agent,
    });
    const { detail, why } = await refusal(await paid(app, withEnvelope(credential, { transaction: twoOps })));
    expect(detail).toContain("transaction is not the requested transfer");
    expect(why).toContain("exactly one operation");
    expect(rpc.simulate).not.toHaveBeenCalled();
    expect(rpc.send).not.toHaveBeenCalled();
  });

  it("rejects a sponsored (all-zeros source) envelope", async () => {
    const rpc = fakeChargeRpc();
    const app = sellerApp(rpc);
    const { credential } = await credentialFor(app, "card");
    const sponsored = rebuild(envelopeOf(credential), { source: NULL_ACCOUNT });
    const { detail, why } = await refusal(await paid(app, withEnvelope(credential, { transaction: sponsored })));
    expect(detail).toContain("this seller does not sponsor fees");
    expect(rpc.send).not.toHaveBeenCalled();
  });

  it("rejects an expired auth entry", async () => {
    // The seller's ledger has moved past the entry's signatureExpirationLedger.
    const rpc = fakeChargeRpc({ latestLedger: async () => LATEST_LEDGER + 500 });
    const app = sellerApp(rpc);
    const { credential } = await credentialFor(app, "card");
    const { detail, why } = await refusal(await paid(app, credential));
    expect(detail).toContain("no authorization entry authorizes the transfer");
    expect(why).toMatch(/^auth entry expires at ledger \d+, outside \(1500, 1620\]$/);
    expect(rpc.simulate).not.toHaveBeenCalled();
    expect(rpc.send).not.toHaveBeenCalled();
  });

  it("turns a simulation failure into a 402 that keeps the host diagnostic", async () => {
    const rpc = fakeChargeRpc({ simulate: async () => ({ ok: false as const, error: cardRejection(3) }) });
    const app = sellerApp(rpc);
    const { credential } = await credentialFor(app, "card");
    const { detail, why } = await refusal(await paid(app, credential));
    expect(detail).toContain("simulation failed: HostError: Error(Auth, InvalidAction)");
    expect(detail).toContain(`"failed account authentication with error", ${CARD}, Error(Contract, #3)`);
    expect(rpc.send).not.toHaveBeenCalled();
  });

  it("refuses to settle the same credential twice", async () => {
    const rpc = fakeChargeRpc();
    const app = sellerApp(rpc);
    const { credential } = await credentialFor(app, "card");
    expect((await paid(app, credential)).status).toBe(200);
    expect((await paid(app, credential)).status).toBe(402);
    expect(rpc.send).toHaveBeenCalledTimes(1);
  });

  it("reports an on-chain failure with the transaction hash", async () => {
    const rpc = fakeChargeRpc({ wait: async () => "FAILED" as const });
    const app = sellerApp(rpc);
    const { credential } = await credentialFor(app, "card");
    const { detail, why } = await refusal(await paid(app, credential));
    expect(detail).toContain(`transaction failed on-chain: ${TX_HASH}`);
  });
});
