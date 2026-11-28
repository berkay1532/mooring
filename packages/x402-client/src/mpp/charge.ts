import { contract, rpc } from "@stellar/stellar-sdk";
import { getNetworkPassphrase, getRpcUrl } from "@x402/stellar";
import { Credential, Method } from "mppx";
import { readCardInfo as readCardInfoRpc, readMerchants as readMerchantsRpc } from "../card.js";
import { CardPolicyDenied, DEFAULT_APP_URL, PaymentError } from "../denial.js";
import { denialFromCard, type SimDenialMerchant } from "../denial-from-sim.js";
import { precheck } from "../precheck.js";
import { authExpirationLedgers, type CardSchemeOptions } from "../scheme.js";
import { signCardAuthEntries } from "../signer.js";
import { assertSimulationOk, buildCardTransfer, type CardTransferParams } from "../transfer.js";
import { chargeMethod, type ChargeChallenge, type ChargeRequest } from "./schema.js";

/** Auth-entry lifetime assumed when a challenge carries no usable `expires`. */
const DEFAULT_CHALLENGE_SECONDS = 180;

export type CardChargeOptions = CardSchemeOptions & {
  /** Run the local policy mirror before signing (default true). */
  precheck?: boolean;
  /** The USDC SAC address; any other `currency` is refused. */
  usdc: string;
  /** Current ledger sequence (default: the RPC's latest ledger). */
  latestLedger?: () => Promise<number>;
  /** Progress events: the challenge was accepted, the credential is signed. */
  onProgress?: (e: { type: "challenge" | "signed" }) => void;
};

/** RPC-dependent collaborators, injectable for tests. */
export interface CardChargeDeps {
  buildTransfer?: (params: CardTransferParams) => Promise<contract.AssembledTransaction<unknown>>;
  readCardInfo?: typeof readCardInfoRpc;
  readMerchants?: typeof readMerchantsRpc;
  latestLedger?: () => Promise<number>;
}

const SEQUENCE_CONFLICT = /tx_?bad_seq/i;

/** True when `text` carries the network's bad-sequence result (`txBAD_SEQ` / `tx_bad_seq`). */
export function isSequenceConflict(text: string): boolean {
  return SEQUENCE_CONFLICT.test(text);
}

/** A `sequence_conflict` PaymentError, with a short reason when one is given. */
export function sequenceConflict(reason?: string): PaymentError {
  const short = reason?.split("\n")[0]?.trim().slice(0, 200);
  return new PaymentError({ kind: "rejected", detail: short ? `sequence_conflict: ${short}` : "sequence_conflict" });
}

/** True for the `sequence_conflict` PaymentError. */
export function isSequenceConflictError(err: unknown): err is PaymentError {
  return (
    err instanceof PaymentError &&
    err.kind === "rejected" &&
    (err.detail === "sequence_conflict" || (err.detail?.startsWith("sequence_conflict:") ?? false))
  );
}

/** Whole seconds from now until an ISO 8601 `expires`, or 0 when absent, past or unparseable. */
function secondsUntil(expires: string | undefined): number {
  if (!expires) return 0;
  const at = Date.parse(expires);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.floor((at - Date.now()) / 1000));
}

/** Validates the challenge's request against the charge schema. */
function parseRequest(challenge: ChargeChallenge): ChargeRequest {
  const parsed = chargeMethod.schema.request.safeParse(challenge.request);
  if (!parsed.success) {
    const why = parsed.error.issues
      .map((i) => `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}`)
      .join("; ");
    throw new PaymentError({ kind: "rejected", detail: `malformed_challenge: ${why}` });
  }
  if (!/^\d+$/.test(parsed.data.amount) || BigInt(parsed.data.amount) <= 0n) {
    throw new PaymentError({
      kind: "rejected",
      detail: `malformed_challenge: amount must be a positive integer (got ${parsed.data.amount})`,
    });
  }
  return parsed.data;
}

/**
 * The MPP Stellar charge method, paid from a Mooring card.
 *
 * Produces a pull-mode `transaction` credential: one `invokeHostFunction`
 * calling `currency.transfer(card, recipient, amount)` whose card auth entry
 * the agent key signs, so the card's `__check_auth` enforces its policy when
 * the seller broadcasts. When the server sponsors fees (`feePayer: true`) the
 * envelope keeps the SDK's all-zeros placeholder source and is left unsigned
 * for the sponsor; otherwise the agent account is the source and signs the
 * envelope (it pays the network fee, the card pays the merchant). Push
 * credentials (`signedHash`/`hash`) are not produced.
 *
 * Unsponsored credentials carry the agent account's next sequence number,
 * which is consumed only when the seller broadcasts. This method does not
 * serialize: a direct user must run agent-paid payments for one agent key
 * one at a time, from building the credential until the seller answers
 * (`pay()` does this), or the second fails with `sequence_conflict`.
 */
export function cardChargeMethod(opts: CardChargeOptions, deps: CardChargeDeps = {}) {
  const rpcUrl = getRpcUrl(opts.network, opts.rpcUrl ? { url: opts.rpcUrl } : undefined);
  const passphrase = getNetworkPassphrase(opts.network);
  const buildTransfer = deps.buildTransfer ?? buildCardTransfer;
  const readCardInfo = deps.readCardInfo ?? readCardInfoRpc;
  const readMerchants = deps.readMerchants ?? readMerchantsRpc;
  const latestLedger =
    deps.latestLedger ??
    opts.latestLedger ??
    (async () => {
      const server = new rpc.Server(rpcUrl, { allowHttp: opts.network === "stellar:testnet" });
      return (await server.getLatestLedger()).sequence;
    });
  const appUrl = opts.appUrl ?? DEFAULT_APP_URL;

  const deny = (denial: CardPolicyDenied): never => {
    opts.onDenial?.(denial);
    throw denial;
  };
  const reject = (detail: string): never => {
    const error = new PaymentError({ kind: "rejected", detail });
    opts.onPaymentError?.(error);
    throw error;
  };

  return Method.toClient(chargeMethod, {
    canHandleChallenge: ({ challenge }) =>
      challenge.method === "stellar" &&
      challenge.intent === "charge" &&
      (challenge.request as { methodDetails?: { network?: unknown } }).methodDetails?.network ===
        opts.network,

    async createCredential({ challenge }) {
      let request: ChargeRequest;
      try {
        request = parseRequest(challenge as ChargeChallenge);
      } catch (err) {
        if (err instanceof PaymentError) opts.onPaymentError?.(err);
        throw err;
      }
      const { amount, currency, recipient, methodDetails } = request;

      if (currency !== opts.usdc) reject(`unsupported_asset: ${currency}`);
      const credentialTypes = methodDetails?.credentialTypes;
      if (credentialTypes && !credentialTypes.includes("transaction")) {
        reject("mpp_push_unsupported");
      }
      opts.onProgress?.({ type: "challenge" });

      const merchant = {
        payTo: recipient,
        amount,
        network: opts.network,
        ...(opts.requestUrl ? { url: opts.requestUrl } : {}),
      };

      if (opts.precheck !== false) {
        let reason;
        try {
          const [info, merchants] = await Promise.all([
            readCardInfo(rpcUrl, passphrase, opts.card),
            readMerchants(rpcUrl, passphrase, opts.card),
          ]);
          reason = precheck(
            info,
            merchants,
            { payTo: recipient, amount, asset: currency },
            Math.floor(Date.now() / 1000),
          );
        } catch (err) {
          // Fail closed, as the x402 path does: a card we cannot read is a
          // card we cannot spend from.
          const detail = `pre-check unavailable: ${err instanceof Error ? err.message : String(err)}`;
          deny(new CardPolicyDenied("unknown", "precheck", { detail, merchant, card: opts.card, appUrl }));
        }
        if (reason) deny(new CardPolicyDenied(reason, "precheck", { merchant, card: opts.card, appUrl }));
      }

      const sponsored = methodDetails?.feePayer === true;
      return sign(challenge as ChargeChallenge, request, merchant, sponsored);
    },
  });

  /** Steps 4–6: build the card transfer, sign its auth entry, simulate, sign the envelope. */
  async function sign(
    challenge: ChargeChallenge,
    request: ChargeRequest,
    merchant: SimDenialMerchant,
    sponsored: boolean,
  ): Promise<string> {
    const { amount, currency, recipient } = request;
    const agent = opts.agent.publicKey();
    let tx: contract.AssembledTransaction<unknown>;
    try {
      tx = await buildTransfer({
        asset: currency,
        from: opts.card,
        to: recipient,
        amount: BigInt(amount),
        rpcUrl,
        passphrase,
        // Sponsored: keep the SDK's all-zeros placeholder source for the
        // sponsor to replace. Unsponsored: the agent account is the source.
        ...(sponsored ? {} : { publicKey: agent }),
      });
    } catch (err) {
      // Unsponsored, the agent account pays the network fee, so it must
      // exist: stellar-sdk's `rpc.Server.getAccount` throws exactly this for
      // an account the ledger does not have (an agent key never funded).
      if (!sponsored && err instanceof Error && err.message === `Account not found: ${agent}`) {
        reject(`agent_unfunded: ${agent} has no XLM for the network fee (testnet: fund it with friendbot)`);
      }
      throw err;
    }

    const pending = tx.needsNonInvokerSigningBy();
    if (pending.length !== 1 || pending[0] !== opts.card) {
      throw new Error(`Expected to sign with [${opts.card}], but got [${pending.join(", ")}]`);
    }

    const seconds = secondsUntil(challenge.expires) || DEFAULT_CHALLENGE_SECONDS;
    const expiration = (await latestLedger()) + authExpirationLedgers(seconds);
    await signCardAuthEntries(tx, opts.card, opts.agent, expiration);

    // Signed entries make this simulation enforcing: the card's
    // `__check_auth` runs, so a payment its policy refuses fails here,
    // before anything is handed to the seller.
    try {
      await tx.simulate({ useUpgradedAuth: false });
      assertSimulationOk(tx.simulation);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      if (isSequenceConflict(text)) {
        const conflict = sequenceConflict(text.replace(/^Stellar simulation failed: /, ""));
        opts.onPaymentError?.(conflict);
        throw conflict;
      }
      const denial = denialFromCard(err, opts.card, merchant, appUrl);
      if (!denial) throw err;
      deny(denial);
    }

    const built = tx.built!;
    // The agent signs the envelope only when it is the fee-paying source.
    if (!sponsored) built.sign(opts.agent);
    opts.onProgress?.({ type: "signed" });

    return Credential.serialize({
      challenge,
      payload: { type: "transaction", transaction: built.toXDR() },
      source: `did:pkh:${opts.network}:${opts.card}`,
    });
  }
}
