import { Address, Keypair, contract, nativeToScVal, rpc } from "@stellar/stellar-sdk";
import type {
  PaymentPayloadResult,
  PaymentRequirements,
  SchemeNetworkClient,
} from "@x402/core/types";
import {
  DEFAULT_ESTIMATED_LEDGER_SECONDS,
  findDefaultAsset,
  getNetworkPassphrase,
  getRpcUrl,
  validateStellarAssetAddress,
  validateStellarDestinationAddress,
} from "@x402/stellar";
import { CARD_ERROR_CODES, CardPolicyDenied, classifyContractError } from "./denial.js";
import { signCardAuthEntries } from "./signer.js";

export type StellarNetwork = "stellar:testnet" | "stellar:pubnet";

export interface CardSchemeOptions {
  /** Card contract address (C...). The card is the payer. */
  card: string;
  /** Agent keypair registered as the card's signer. */
  agent: Keypair;
  network: StellarNetwork;
  /** Required on pubnet; optional on testnet. */
  rpcUrl?: string;
  /** Called when the card rejects the payment in the enforcing simulation. */
  onDenial?: (denial: CardPolicyDenied) => void;
}

/**
 * x402 "exact" scheme client whose payer is a Mooring card (a Soroban custom
 * account). It produces exactly the same payload as `@x402/stellar`'s
 * `ExactStellarScheme` — one `invokeHostFunction` calling
 * `asset.transfer(card, payTo, amount)`, re-simulated after signing, returned
 * as a base64 transaction envelope. Only the signing differs: the card's auth
 * entries are signed by the agent key through `signCardAuthEntries`, so
 * `__check_auth` enforces the budget, allowlist and expiry at settlement.
 */
export class CardExactStellarScheme implements SchemeNetworkClient {
  readonly scheme = "exact";
  readonly findDefaultAsset = findDefaultAsset;
  private readonly card: string;
  private readonly agent: Keypair;
  private readonly network: StellarNetwork;
  private readonly rpcUrl: string;
  private readonly passphrase: string;
  private readonly onDenial?: (denial: CardPolicyDenied) => void;

  constructor(opts: CardSchemeOptions) {
    this.card = opts.card;
    this.agent = opts.agent;
    this.network = opts.network;
    this.onDenial = opts.onDenial;
    this.rpcUrl = getRpcUrl(opts.network, opts.rpcUrl ? { url: opts.rpcUrl } : undefined);
    this.passphrase = getNetworkPassphrase(opts.network);
  }

  /** Throws unless the requirements are an `exact` payment this client can make. */
  validateRequirements(req: PaymentRequirements): void {
    if (req.scheme !== "exact") throw new Error(`Unsupported scheme: ${req.scheme}`);
    if (req.network !== this.network) {
      throw new Error(`Unsupported network: ${req.network} (client is ${this.network})`);
    }
    if (!validateStellarDestinationAddress(req.payTo)) {
      throw new Error(`Invalid Stellar destination address: ${req.payTo}`);
    }
    if (!validateStellarAssetAddress(req.asset)) {
      throw new Error(`Invalid Stellar asset address: ${req.asset}`);
    }
    if (!/^\d+$/.test(req.amount) || BigInt(req.amount) <= 0n) {
      throw new Error(`Invalid amount: ${req.amount}. Amount must be a positive integer.`);
    }
    if (req.extra?.areFeesSponsored !== true) {
      throw new Error("Exact scheme requires areFeesSponsored to be true");
    }
  }

  async createPaymentPayload(
    x402Version: number,
    req: PaymentRequirements,
  ): Promise<PaymentPayloadResult> {
    this.validateRequirements(req);
    const tx = await this.buildTransfer(req.asset, this.card, req.payTo, BigInt(req.amount));

    const pending = tx.needsNonInvokerSigningBy();
    if (!pending.includes(this.card) || pending.length > 1) {
      throw new Error(`Expected to sign with [${this.card}], but got [${pending.join(", ")}]`);
    }

    // The stock client samples Horizon for the real ledger close time; the 5 s
    // constant avoids that dependency and lands on the same 12 ledgers for the
    // usual maxTimeoutSeconds = 60.
    const maxLedger =
      (await this.latestLedger()) +
      Math.ceil(req.maxTimeoutSeconds / DEFAULT_ESTIMATED_LEDGER_SECONDS);
    await this.sign(tx, maxLedger);

    // Re-simulate so the transaction carries the signed auth entries and the
    // resources they cost. Signed entries make this simulation *enforcing*:
    // the card's `__check_auth` runs, so a payment its policy refuses fails
    // here — before the facilitator, and before any fee is paid.
    try {
      await tx.simulate({ useUpgradedAuth: false });
      assertSimulationOk(tx.simulation);
    } catch (err) {
      const denial = this.denialFromCard(err);
      if (!denial) throw err;
      this.onDenial?.(denial);
      throw denial;
    }
    const still = tx.needsNonInvokerSigningBy();
    if (still.length > 0) {
      throw new Error(`unexpected signer(s) required: [${still.join(", ")}]`);
    }

    return { x402Version, payload: { transaction: tx.built!.toXDR() } };
  }

  /**
   * Turns a failed enforcing simulation into a typed denial when it was the
   * card's `__check_auth` that said no.
   *
   * The card's address alone is not evidence: it appears in the `transfer`
   * arguments of every diagnostic this transaction can produce, and the token's
   * own error codes overlap the card's 1–8 range — a SAC balance error would be
   * read as a policy decision. What identifies an auth failure is the host's
   * phrase, which names the failing account and its error together:
   *
   *   ["failed account authentication with error", <card>, Error(Contract, #N)]
   *
   * so the reason is taken from that fragment and nowhere else. Anything that
   * does not match stays an ordinary error.
   */
  private denialFromCard(err: unknown): CardPolicyDenied | null {
    const text = err instanceof Error ? err.message : String(err);
    const fragment = new RegExp(
      `failed account authentication with error"?,\\s*${this.card}\\s*,[^\\]]*`,
    ).exec(text);
    if (!fragment) return null;
    const parsed = classifyContractError(fragment[0]);
    if (!parsed || !(parsed.code in CARD_ERROR_CODES)) return null;
    return new CardPolicyDenied(parsed.reason, "simulate", {
      contractError: parsed.code,
      detail: text.split("\n")[0],
    });
  }

  // --- collaborators (protected so tests can stub them) ---

  /** Builds and simulates `asset.transfer(from, to, amount)` (SEP-41). */
  protected async buildTransfer(
    asset: string,
    from: string,
    to: string,
    amount: bigint,
  ): Promise<contract.AssembledTransaction<unknown>> {
    const tx = await contract.AssembledTransaction.build({
      contractId: asset,
      method: "transfer",
      args: [
        nativeToScVal(Address.fromString(from), { type: "address" }),
        nativeToScVal(Address.fromString(to), { type: "address" }),
        nativeToScVal(amount, { type: "i128" }),
      ],
      networkPassphrase: this.passphrase,
      rpcUrl: this.rpcUrl,
      parseResultXdr: (r) => r,
      // Record legacy (v1) address credentials rather than the CAP-71 v2 ones
      // stellar-sdk 17 asks for by default. Measured 2026-09-12 against OZ
      // Channels testnet: a v2 payload is rejected as
      // `invalid_exact_stellar_payload_malformed`, the identical v1 payload
      // verifies. The `@x402/stellar` JS library does understand v2, so the
      // refusal comes from somewhere else in the deployed facilitator stack —
      // most likely a Rust `stellar-xdr` decoder, since `stellar xdr decode`
      // (CLI 26.1.0) also fails on a v2 envelope. Both formats are valid
      // on-chain and carry the same agent signature; only the signed preimage
      // differs (v2 binds the address). Drop this once OZ Channels accepts
      // ADDRESS_V2 — and note the SDK flag is transitional: it becomes a no-op
      // in protocol 28, so that has to happen first.
      useUpgradedAuth: false,
    });
    assertSimulationOk(tx.simulation);
    return tx;
  }

  /** Signs the card's auth entries with the agent key. */
  protected async sign(
    tx: contract.AssembledTransaction<unknown>,
    expirationLedger: number,
  ): Promise<void> {
    await signCardAuthEntries(tx, this.card, this.agent, expirationLedger);
  }

  /** Current ledger sequence, used as the auth-entry expiration base. */
  protected async latestLedger(): Promise<number> {
    const server = new rpc.Server(this.rpcUrl, {
      allowHttp: this.network === "stellar:testnet",
    });
    return (await server.getLatestLedger()).sequence;
  }
}

/** Throws unless a simulation succeeded outright (no error, no restore). */
function assertSimulationOk(sim?: rpc.Api.SimulateTransactionResponse): void {
  if (!sim) throw new Error("Stellar simulation result is undefined");
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Stellar simulation failed${sim.error ? `: ${sim.error}` : ""}`);
  }
  if (rpc.Api.isSimulationRestore(sim)) {
    throw new Error("Stellar simulation requires a ledger entry restore");
  }
}
