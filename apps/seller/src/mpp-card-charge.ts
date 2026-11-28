import {
  Address,
  FeeBumpTransaction,
  StrKey,
  TransactionBuilder,
  rpc,
  scValToNative,
  type Operation,
  type Transaction,
  type xdr,
} from "@stellar/stellar-sdk";
import { getNetworkPassphrase } from "@x402/stellar";
import { chargeMethod, type ChargeRequest } from "@mooring-live/x402-client";
import { Errors, Method, Receipt, Store } from "mppx";
import { addressCredentials, verifyAuthEntrySignature } from "./verify-auth.js";

export type StellarNetwork = "stellar:testnet" | "stellar:pubnet";

/** The Soroban RPC calls the charge method makes; injectable for tests. */
export interface ChargeRpc {
  /** Simulates the signed envelope (enforcing: its auth entries are checked). */
  simulate(xdr: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Broadcasts the envelope; throws when the network does not accept it. */
  send(xdr: string): Promise<{ hash: string }>;
  /** The transaction's status as the RPC knows it now. */
  wait(hash: string): Promise<"SUCCESS" | "FAILED" | "NOT_FOUND">;
  latestLedger(): Promise<number>;
}

export interface CardChargeServerOptions {
  network: StellarNetwork;
  /** The USDC SAC; the only `currency` accepted. */
  usdc: string;
  /** The seller's account (`G…`) or contract (`C…`); the only `recipient` accepted. */
  payTo: string;
  rpc: ChargeRpc;
  /** Clock for receipt timestamps (default `new Date()`). */
  now?: () => Date;
  /** Replay store (default `Store.memory()`: per process, see docs/seller.md). */
  store?: Store.AtomicStore;
  /** Delay between confirmation polls (default 1000 ms; 30 polls). */
  pollIntervalMs?: number;
}

/** Furthest ahead of the latest ledger an auth entry may expire (~10 minutes). */
export const MAX_AUTH_LEDGERS = 120;
/** Confirmation polls after broadcast. */
export const WAIT_ATTEMPTS = 30;
/** How long a used challenge id or transaction hash stays claimed. */
const CLAIM_MS = 60 * 60 * 1000;

const ALL_ZEROS_ACCOUNT = StrKey.encodeEd25519PublicKey(Buffer.alloc(32));

const MSG = {
  pullOnly: "only pull-mode transaction credentials are accepted",
  badSource: "credential source is not a Stellar DID on this network",
  sponsored: "this seller does not sponsor fees",
  notTransfer: "transaction is not the requested transfer",
  noAuth: "no authorization entry authorizes the transfer",
} as const;

/**
 * A refusal: mppx answers any `PaymentError` with a fresh 402 challenge and an
 * RFC 9457 problem whose `detail` carries `reason`. A plain `Error` would be
 * reported as an opaque internal error, losing the reason.
 */
function refuse(reason: string, why?: string): never {
  throw new Errors.VerificationFailedError({ reason, ...(why ? { details: { why } } : {}) });
}

/** The `G…`/`C…` of a `did:pkh:stellar:<network>:<address>` on `network`, else `null`. */
export function parseStellarDid(source: string | undefined, network: StellarNetwork): string | null {
  if (!source) return null;
  const parts = source.split(":");
  if (parts.length !== 5 || parts[0] !== "did" || parts[1] !== "pkh") return null;
  if (`${parts[2]}:${parts[3]}` !== network) return null;
  const addr = parts[4]!;
  return StrKey.isValidEd25519PublicKey(addr) || StrKey.isValidContract(addr) ? addr : null;
}

interface ExpectedTransfer {
  currency: string;
  from: string;
  to: string;
  amount: bigint;
}

/** True when `args` are exactly `(from, to, amount)` of `expected`. */
function argsMatch(args: xdr.ScVal[], expected: ExpectedTransfer): boolean {
  if (args.length !== 3) return false;
  try {
    const [from, to, amount] = [args[0]!, args[1]!, args[2]!];
    if (from.type !== "scvAddress" || to.type !== "scvAddress" || amount.type !== "scvI128") return false;
    return (
      Address.fromScVal(from).toString() === expected.from &&
      Address.fromScVal(to).toString() === expected.to &&
      scValToNative(amount) === expected.amount
    );
  } catch {
    return false;
  }
}

/** True when `invoke` is `currency.transfer(from, to, amount)`. */
function isTransfer(invoke: xdr.InvokeContractArgs, expected: ExpectedTransfer): boolean {
  return (
    Address.fromScAddress(invoke.contractAddress).toString() === expected.currency &&
    invoke.functionName.toString() === "transfer" &&
    argsMatch(invoke.args, expected)
  );
}

/** Decodes `envelope`; a fee bump or undecodable envelope is not a transfer. */
function decode(envelope: string, passphrase: string): Transaction {
  let tx: Transaction | FeeBumpTransaction;
  try {
    tx = TransactionBuilder.fromXDR(envelope, passphrase);
  } catch {
    refuse(MSG.notTransfer, "the envelope does not decode");
  }
  if (tx instanceof FeeBumpTransaction) refuse(MSG.notTransfer, "fee-bump envelopes are not accepted");
  return tx;
}

/**
 * The Stellar charge method of MPP, server side, accepting a Mooring card
 * (`C…`, a Soroban custom account) as well as a plain account (`G…`) as the
 * payer — the stock `@stellar/mpp` server rejects contract payers.
 *
 * Only pull-mode `transaction` credentials are accepted: the payer's agent
 * account is the envelope's source and pays the network fee, the seller
 * broadcasts. `validate` (non-mutating) runs rules 1–5; `broadcast` runs 6.
 * mppx always runs `validate` immediately before `broadcast`.
 */
export function cardChargeServer(opts: CardChargeServerOptions) {
  const passphrase = getNetworkPassphrase(opts.network);
  const store = opts.store ?? Store.memory();
  const now = opts.now ?? (() => new Date());
  const pollMs = opts.pollIntervalMs ?? 1000;

  type Credential = Parameters<NonNullable<Method.Server<typeof chargeMethod>["validate"]>>[0]["credential"];

  /** Rules 1–5. Returns the decoded transaction and the payer. */
  async function check(credential: Credential, request: ChargeRequest) {
    // 1. Pull mode only: the seller broadcasts the envelope it verified.
    const payload = credential.payload;
    if (payload.type !== "transaction") refuse(MSG.pullOnly);

    // 2. The asserted payer is a Stellar account or contract on this network.
    const sourceAddr = parseStellarDid(credential.source, opts.network);
    if (!sourceAddr) refuse(MSG.badSource);

    // 3. The envelope is exactly the requested transfer, paid for by its source.
    if (request.currency !== opts.usdc || request.recipient !== opts.payTo || !/^\d+$/.test(request.amount)) {
      refuse(MSG.notTransfer, "the request is not this seller's terms");
    }
    const expected: ExpectedTransfer = {
      currency: opts.usdc,
      from: sourceAddr,
      to: opts.payTo,
      amount: BigInt(request.amount),
    };
    const tx = decode(payload.transaction, passphrase);
    if (tx.source === ALL_ZEROS_ACCOUNT) refuse(MSG.sponsored);
    if (!StrKey.isValidEd25519PublicKey(tx.source) || tx.source === opts.payTo) {
      refuse(MSG.notTransfer, "the envelope source must be the payer's own fee account");
    }
    if (tx.operations.length !== 1) refuse(MSG.notTransfer, "the envelope must carry exactly one operation");
    const op = tx.operations[0]!;
    if (op.type !== "invokeHostFunction") refuse(MSG.notTransfer, "the operation must be invokeHostFunction");
    const invoke = op as Operation.InvokeHostFunction;
    if (invoke.source && invoke.source !== tx.source) refuse(MSG.notTransfer, "the operation has its own source");
    if (invoke.func.type !== "hostFunctionTypeInvokeContract" || !isTransfer(invoke.func.invokeContract, expected)) {
      refuse(MSG.notTransfer, "the operation is not currency.transfer(from, payTo, amount)");
    }

    // 4. Every auth entry is a bounded address credential; one by `from`
    //    covers exactly this transfer. Account signatures are checked here; a
    //    contract's `__check_auth` runs in the enforcing simulation.
    const latest = await opts.rpc.latestLedger();
    let covered = false;
    for (const entry of invoke.auth ?? []) {
      const credentials = addressCredentials(entry.credentials);
      if (!credentials) refuse(MSG.noAuth, "only address credentials are accepted");
      if (entry.rootInvocation.subInvocations.length > 0) refuse(MSG.noAuth, "sub-invocations are not accepted");
      const expiry = credentials.signatureExpirationLedger;
      if (expiry <= latest || expiry > latest + MAX_AUTH_LEDGERS) {
        refuse(MSG.noAuth, `auth entry expires at ledger ${expiry}, outside (${latest}, ${latest + MAX_AUTH_LEDGERS}]`);
      }
      const authorizer = Address.fromScAddress(credentials.address).toString();
      if (StrKey.isValidEd25519PublicKey(authorizer)) {
        try {
          verifyAuthEntrySignature(entry, passphrase);
        } catch (err) {
          refuse(MSG.noAuth, err instanceof Error ? err.message : String(err));
        }
      }
      const fn = entry.rootInvocation.function;
      if (
        authorizer === expected.from &&
        fn.type === "sorobanAuthorizedFunctionTypeContractFn" &&
        isTransfer(fn.contractFn, expected)
      ) {
        covered = true;
      }
    }
    if (!covered) refuse(MSG.noAuth);

    // 5. The network would apply it: the card's policy (`__check_auth`) runs
    //    here, and its host diagnostic is kept so the client can classify it.
    const sim = await opts.rpc.simulate(payload.transaction);
    if (!sim.ok) refuse(`simulation failed: ${sim.error}`);

    return { tx, payer: sourceAddr, envelope: payload.transaction };
  }

  /** Records first use of `key`; false when it was already used. */
  const claim = async (key: string) => Store.tryClaim(store, key, now().getTime() + CLAIM_MS);

  return Method.toServer(chargeMethod, {
    // The challenge always names this seller's network and pull mode.
    request({ request }) {
      return {
        ...request,
        methodDetails: { network: opts.network, credentialTypes: ["transaction"] },
      };
    },

    async validate({ credential, request }) {
      const parsed = chargeMethod.schema.request.parse(request);
      const { payer } = await check(credential, parsed);
      return {
        challenge: credential.challenge,
        credential,
        details: { payer },
        intent: "charge",
        method: "stellar",
        payer,
        request: parsed,
        source: credential.source,
      };
    },

    // 6. Broadcast once, wait for the ledger, answer with the hash.
    async broadcast({ credential }) {
      if (credential.payload.type !== "transaction") refuse(MSG.pullOnly);
      const envelope = credential.payload.transaction;
      const txHash = Buffer.from(decode(envelope, passphrase).hash()).toString("hex");
      if (!(await claim(`mooring:charge:challenge:${credential.challenge.id}`))) {
        throw new Errors.CredentialReplayedError();
      }
      if (!(await claim(`mooring:charge:tx:${txHash}`))) {
        throw new Errors.CredentialReplayedError({ reason: "transaction already submitted" });
      }

      let hash: string;
      try {
        ({ hash } = await opts.rpc.send(envelope));
      } catch (err) {
        refuse(`transaction was not accepted: ${err instanceof Error ? err.message : String(err)}`);
      }

      for (let attempt = 0; attempt < WAIT_ATTEMPTS; attempt += 1) {
        let status: "SUCCESS" | "FAILED" | "NOT_FOUND";
        try {
          status = await opts.rpc.wait(hash);
        } catch {
          status = "NOT_FOUND";
        }
        if (status === "SUCCESS") {
          return Receipt.from({ method: "stellar", status: "success", timestamp: now().toISOString(), reference: hash });
        }
        if (status === "FAILED") refuse(`transaction failed on-chain: ${hash}`);
        if (attempt < WAIT_ATTEMPTS - 1) await new Promise((r) => setTimeout(r, pollMs));
      }
      refuse(`transaction not confirmed: ${hash}`);
    },
  });
}

/** `txBadSeq` → `tx_bad_seq`, the form clients match. */
function resultCode(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** The production `ChargeRpc` over a Soroban RPC server. */
export function chargeRpcFromServer(rpcUrl: string, network: StellarNetwork): ChargeRpc {
  const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });
  const passphrase = getNetworkPassphrase(network);
  const tx = (envelope: string) => TransactionBuilder.fromXDR(envelope, passphrase);
  return {
    async simulate(envelope) {
      const sim = await server.simulateTransaction(tx(envelope));
      if (rpc.Api.isSimulationError(sim)) return { ok: false, error: sim.error };
      if (rpc.Api.isSimulationRestore(sim)) return { ok: false, error: "a ledger entry needs a restore first" };
      return { ok: true };
    },
    async send(envelope) {
      const sent = await server.sendTransaction(tx(envelope));
      if (sent.status !== "PENDING") {
        const code = sent.errorResult ? ` ${resultCode(sent.errorResult.result.type)}` : "";
        throw new Error(`${sent.status}${code}`);
      }
      return { hash: sent.hash };
    },
    async wait(hash) {
      const got = await server.getTransaction(hash);
      return got.status === rpc.Api.GetTransactionStatus.SUCCESS
        ? "SUCCESS"
        : got.status === rpc.Api.GetTransactionStatus.FAILED
          ? "FAILED"
          : "NOT_FOUND";
    },
    async latestLedger() {
      return (await server.getLatestLedger()).sequence;
    },
  };
}
