import { afterEach, describe, expect, it, vi } from "vitest";
import { Address, Keypair, Transaction, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { Challenge, Credential } from "mppx";
import type { CardInfo } from "../src/card.js";
import { CardPolicyDenied, PaymentError } from "../src/denial.js";
import { cardChargeMethod } from "../src/mpp/charge.js";
import { chargeMethod, type ChargeChallenge } from "../src/mpp/schema.js";
import {
  CARD,
  MERCHANT,
  PASSPHRASE,
  TOKEN,
  cardRejection,
  stubCardTransferRpc,
} from "./fixtures/assembled.js";

const USDC = TOKEN;
/** The SDK's placeholder source when `AssembledTransaction` is built without a `publicKey`. */
const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const NOW = Math.floor(Date.now() / 1000);

afterEach(() => {
  vi.restoreAllMocks();
});

const agent = Keypair.random();
const base = { card: CARD, agent, network: "stellar:testnet" as const };

/** A real, HMAC-bound Stellar charge challenge with the given overrides. */
function challengeWith(
  over: {
    currency?: string;
    amount?: string;
    recipient?: string;
    feePayer?: boolean;
    credentialTypes?: string[];
    network?: string;
    expires?: string;
  } = {},
): ChargeChallenge {
  return Challenge.fromMethod(chargeMethod, {
    secretKey: "test",
    realm: "api.mooring.live",
    ...(over.expires ? { expires: over.expires } : {}),
    request: {
      amount: over.amount ?? "10000",
      currency: over.currency ?? USDC,
      recipient: over.recipient ?? MERCHANT,
      methodDetails: {
        network: over.network ?? "stellar:testnet",
        credentialTypes: over.credentialTypes ?? ["transaction"],
        ...(over.feePayer !== undefined ? { feePayer: over.feePayer } : {}),
      },
    },
  }) as unknown as ChargeChallenge;
}

function cardInfo(over: Partial<CardInfo> = {}): CardInfo {
  return {
    owner: Keypair.random().publicKey(),
    signer: agent.rawPublicKey(),
    token: TOKEN,
    label: "agent",
    policy: {
      period_amount: 1_000_000_000n,
      period_duration: 86_400n,
      max_per_tx: 100_000_000n,
      expiry: BigInt(NOW + 365 * 86_400),
    },
    state: 0,
    period: { start: BigInt(NOW - 100), spent: 0n },
    remaining: 1_000_000_000n,
    balance: 500_000_000n,
    allow_count: 1,
    ...over,
  };
}

/** Readers + ledger fakes for a card that allows MERCHANT. */
function readers(merchants: string[] = [MERCHANT]) {
  return {
    readCardInfo: vi.fn(async () => cardInfo()),
    readMerchants: vi.fn(async () => merchants),
    latestLedger: vi.fn(async () => 1000),
  };
}

/** Decodes a credential's envelope. */
function envelopeOf(credential: string): Transaction {
  const parsed = Credential.deserialize<{ type: string; transaction: string }>(credential);
  return TransactionBuilder.fromXDR(parsed.payload.transaction, PASSPHRASE) as Transaction;
}

/** The address credentials of the envelope's only auth entry. */
function cardCredentials(tx: Transaction) {
  const op = tx.operations[0] as { auth?: xdr.SorobanAuthorizationEntry[] };
  expect(op.auth).toHaveLength(1);
  const credentials = op.auth![0]!.credentials;
  expect(credentials.type).toBe("sorobanCredentialsAddress");
  return (credentials as any).address as xdr.SorobanAddressCredentials;
}

describe("cardChargeMethod", () => {
  it("is the stellar charge method and handles only stellar charge challenges on its network", () => {
    const m = cardChargeMethod({ ...base, usdc: USDC });
    expect(m.name).toBe("stellar");
    expect(m.intent).toBe("charge");
    expect(m.canHandleChallenge!({ challenge: challengeWith() as never })).toBe(true);
    expect(
      m.canHandleChallenge!({ challenge: challengeWith({ network: "stellar:pubnet" }) as never }),
    ).toBe(false);
    expect(
      m.canHandleChallenge!({
        challenge: { ...challengeWith(), method: "tempo" } as never,
      }),
    ).toBe(false);
    expect(
      m.canHandleChallenge!({
        challenge: { ...challengeWith(), intent: "session" } as never,
      }),
    ).toBe(false);
  });

  it("refuses a non-USDC currency before touching the RPC", async () => {
    const rpc = vi.fn();
    const m = cardChargeMethod({ ...base, usdc: USDC }, { readCardInfo: rpc, buildTransfer: rpc });
    await expect(
      m.createCredential({ challenge: challengeWith({ currency: "COTHER" }) }),
    ).rejects.toMatchObject({
      name: "PaymentError",
      kind: "rejected",
      detail: expect.stringMatching(/^unsupported_asset: COTHER/),
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a server that only accepts push credentials", async () => {
    const rpc = vi.fn();
    const m = cardChargeMethod({ ...base, usdc: USDC }, { readCardInfo: rpc, buildTransfer: rpc });
    const err = await m
      .createCredential({ challenge: challengeWith({ credentialTypes: ["signedHash"] }) })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err).toMatchObject({ kind: "rejected", detail: "mpp_push_unsupported" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("turns a request that does not match the charge schema into a malformed_challenge error", async () => {
    const rpc = vi.fn();
    const m = cardChargeMethod({ ...base, usdc: USDC }, { readCardInfo: rpc, buildTransfer: rpc });
    const bad = { ...challengeWith(), request: { amount: 10000, currency: USDC } } as never;
    await expect(m.createCredential({ challenge: bad })).rejects.toMatchObject({
      name: "PaymentError",
      kind: "rejected",
      detail: expect.stringMatching(/^malformed_challenge: /),
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("precheck denial is a CardPolicyDenied at stage precheck and nothing is built", async () => {
    const onDenial = vi.fn();
    const buildTransfer = vi.fn();
    const m = cardChargeMethod(
      { ...base, usdc: USDC, requestUrl: "https://api.test/quote", onDenial },
      { ...readers([]), buildTransfer },
    );
    const err = await m.createCredential({ challenge: challengeWith() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CardPolicyDenied);
    expect(err).toMatchObject({
      reason: "not_allowlisted",
      stage: "precheck",
      merchant: {
        payTo: MERCHANT,
        amount: "10000",
        network: "stellar:testnet",
        url: "https://api.test/quote",
      },
    });
    expect((err as Error).message).toContain(`/allow?card=${CARD}`);
    expect(onDenial).toHaveBeenCalledWith(err);
    expect(buildTransfer).not.toHaveBeenCalled();
  });

  it("fails closed when the card cannot be read for the precheck", async () => {
    const buildTransfer = vi.fn();
    const m = cardChargeMethod(
      { ...base, usdc: USDC },
      { ...readers(), readCardInfo: vi.fn(async () => { throw new Error("rpc down"); }), buildTransfer },
    );
    await expect(m.createCredential({ challenge: challengeWith() })).rejects.toMatchObject({
      name: "CardPolicyDenied",
      reason: "unknown",
      stage: "precheck",
      detail: expect.stringContaining("rpc down"),
    });
    expect(buildTransfer).not.toHaveBeenCalled();
  });

  it("skips the card reads when precheck is false", async () => {
    const r = readers();
    const { buildTransfer } = stubCardTransferRpc();
    const m = cardChargeMethod(
      { ...base, usdc: USDC, precheck: false },
      { ...r, buildTransfer },
    );
    await m.createCredential({ challenge: challengeWith({ feePayer: true }) });
    expect(r.readCardInfo).not.toHaveBeenCalled();
    expect(r.readMerchants).not.toHaveBeenCalled();
  });

  it("sponsored challenge: signs only the card auth entry and returns a transaction credential with a card DID", async () => {
    const { buildTransfer, simulate } = stubCardTransferRpc();
    const onProgress = vi.fn();
    const m = cardChargeMethod(
      { ...base, usdc: USDC, onProgress },
      { ...readers(), buildTransfer },
    );
    const challenge = challengeWith({ feePayer: true });

    const cred = await m.createCredential({ challenge });

    expect(buildTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ asset: USDC, from: CARD, to: MERCHANT, amount: 10000n }),
    );
    expect(buildTransfer.mock.calls[0]![0].publicKey).toBeUndefined();
    // build simulation + enforcing re-simulation, both with legacy v1 auth
    expect(simulate).toHaveBeenCalledTimes(2);
    expect(simulate.mock.calls.every((c) => c[3] === false)).toBe(true);

    const parsed = Credential.deserialize<{ type: string; transaction: string }>(cred);
    expect(parsed.payload.type).toBe("transaction");
    expect(parsed.source).toBe(`did:pkh:stellar:stellar:testnet:${CARD}`);
    expect(parsed.challenge.id).toBe(challenge.id);

    const tx = envelopeOf(cred);
    expect(tx.operations).toHaveLength(1);
    expect(tx.operations[0]!.type).toBe("invokeHostFunction");
    expect(tx.source).toBe(NULL_ACCOUNT);
    expect(tx.signatures).toHaveLength(0);
    const creds = cardCredentials(tx);
    expect(Address.fromScAddress(creds.address).toString()).toBe(CARD);
    // no `expires`: 1000 + authExpirationLedgers(180) = 1000 + 28
    expect(creds.signatureExpirationLedger).toBe(1028);
    expect(((creds.signature as any).vec as xdr.ScVal[]).length).toBe(1);
    expect(onProgress.mock.calls.map((c) => c[0].type)).toEqual(["challenge", "signed"]);
  });

  it("derives the auth expiration from the challenge's expires", async () => {
    const { buildTransfer } = stubCardTransferRpc();
    const m = cardChargeMethod({ ...base, usdc: USDC }, { ...readers(), buildTransfer });
    const expires = new Date(Date.now() + 60_500).toISOString();
    const cred = await m.createCredential({ challenge: challengeWith({ feePayer: true, expires }) });
    // 1000 + max(2, ceil(60 / 6) - 2)
    expect(cardCredentials(envelopeOf(cred)).signatureExpirationLedger).toBe(1008);
  });

  it("unsponsored challenge: the agent account is the source and signs the envelope", async () => {
    const { buildTransfer, getAccount } = stubCardTransferRpc();
    const m = cardChargeMethod({ ...base, usdc: USDC }, { ...readers(), buildTransfer });

    const cred = await m.createCredential({ challenge: challengeWith() });

    expect(buildTransfer.mock.calls[0]![0].publicKey).toBe(agent.publicKey());
    expect(getAccount).toHaveBeenCalledWith(agent.publicKey());
    const parsed = Credential.deserialize<{ type: string }>(cred);
    expect(parsed.payload.type).toBe("transaction");
    expect(parsed.source).toBe(`did:pkh:stellar:stellar:testnet:${CARD}`);

    const tx = envelopeOf(cred);
    expect(tx.operations).toHaveLength(1);
    expect(tx.source).toBe(agent.publicKey());
    expect(tx.signatures).toHaveLength(1);
    // ed25519 is deterministic: the decorated signature (hint + signature)
    // must be exactly the agent's signature over this envelope's hash.
    expect(tx.signatures[0]!.toXDR("base64")).toBe(agent.signDecorated(tx.hash()).toXDR("base64"));
    const creds = cardCredentials(tx);
    expect(((creds.signature as any).vec as xdr.ScVal[]).length).toBe(1);
  });

  it("an enforcing-simulation failure naming the card becomes CardPolicyDenied at stage simulate", async () => {
    const { buildTransfer } = stubCardTransferRpc({ enforcingError: cardRejection(8) });
    const onDenial = vi.fn();
    const m = cardChargeMethod(
      { ...base, usdc: USDC, onDenial, precheck: false },
      { ...readers(), buildTransfer },
    );
    const err = await m
      .createCredential({ challenge: challengeWith({ feePayer: true }) })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CardPolicyDenied);
    expect(err).toMatchObject({
      reason: "over_budget",
      stage: "simulate",
      contractError: 8,
      merchant: { payTo: MERCHANT, amount: "10000", network: "stellar:testnet" },
    });
    expect(onDenial).toHaveBeenCalledWith(err);
  });

  it("leaves an enforcing-simulation failure that is not the card's a plain error", async () => {
    const { buildTransfer } = stubCardTransferRpc({ enforcingError: "HostError: Error(Budget, ExceededLimit)" });
    const onDenial = vi.fn();
    const m = cardChargeMethod(
      { ...base, usdc: USDC, onDenial, precheck: false },
      { ...readers(), buildTransfer },
    );
    const err = await m
      .createCredential({ challenge: challengeWith({ feePayer: true }) })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(CardPolicyDenied);
    expect((err as Error).message).toMatch(/Stellar simulation failed/);
    expect(onDenial).not.toHaveBeenCalled();
  });
});
