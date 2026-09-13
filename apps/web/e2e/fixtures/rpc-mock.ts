/**
 * A route-intercepted Soroban RPC for the end-to-end suite.
 *
 * Every chain read and write in the app goes through `@stellar/stellar-sdk`'s
 * `rpc.Server`, which POSTs JSON-RPC to `NEXT_PUBLIC_RPC_URL`. This installs a
 * Playwright route on that origin and answers the methods the app actually
 * uses:
 *
 * - `getLedgerEntries` — card discovery (contract-instance probes for
 *   `saltBytes(0..)`) and the SDK's own `getAccount` before a write.
 * - `simulateTransaction` — every read (`info()`, `merchants()`, the SAC's
 *   `balance()`) and the first leg of every write. The transaction is decoded
 *   to find the invoked contract and function, so one handler serves them all.
 * - `sendTransaction` / `getTransaction` — the write path: `PENDING`, then
 *   `NOT_FOUND` for a poll or two, then `SUCCESS`.
 *
 * The mock keeps mutable state: a confirmed `freeze`/`unfreeze` flips the
 * card's state, and a confirmed `create_card` adds the new card to the set
 * discovery finds — so a flow that navigates back to the dashboard sees what
 * it just did, exactly as it would on chain.
 *
 * Anything else answers with a JSON-RPC error rather than a plausible-looking
 * default: an unhandled call should fail a test loudly, not silently pass.
 */
import type { Page, Route } from "@playwright/test";
import { Address, TransactionBuilder, scValToNative, xdr, type Transaction } from "@stellar/stellar-sdk";

import {
  DEFAULT_CARDS,
  DEFAULT_OWNER_BALANCE,
  FACTORY,
  NETWORK_PASSPHRASE,
  OWNER,
  RPC_URL,
  USDC,
  cardAddress,
  type CardFixture,
} from "./cards";
import {
  accountEntryB64,
  accountKeyB64,
  address as scAddress,
  bytes,
  contractInstanceEntryB64,
  contractInstanceKeyB64,
  emptyMetaB64,
  emptySorobanDataB64,
  i128,
  signerBytes,
  str,
  struct,
  successResultB64,
  toBase64,
  u32,
  u64,
  unit,
  vec,
} from "./scval";

const LATEST_LEDGER = 1_234_567;
const LEDGER_CLOSE_TIME = 1_757_000_000;

/** Constant for the life of the process — built once rather than per poll. */
const SUCCESS_RESULT_XDR = successResultB64();
const SUCCESS_META_XDR = emptyMetaB64();
const SOROBAN_DATA_XDR = emptySorobanDataB64();

/** The card methods that write, and therefore simulate to a unit result. */
const CARD_WRITES = new Set([
  "freeze",
  "unfreeze",
  "cancel",
  "withdraw",
  "set_label",
  "set_policy",
  "set_signer",
  "add_merchant",
  "remove_merchant",
]);

export interface RpcMockOptions {
  /** The cards that exist at salts 0, 1, … Defaults to the two standard fixtures. */
  cards?: readonly CardFixture[];
  /** The connected owner's own USDC balance. */
  ownerBalance?: bigint;
  /**
   * How many times `getTransaction` answers `NOT_FOUND` before `SUCCESS`. The
   * app waits a second between polls, so one keeps the poll loop honest
   * without turning every write test into a multi-second wait.
   */
  notFoundPolls?: number;
}

export interface RpcMock {
  /** Every JSON-RPC method the page called, in order. */
  readonly calls: string[];
  /** Contract/function pairs simulated, in order — useful when a test fails. */
  readonly simulated: Array<{ contract: string; fn: string }>;
  /** Contract/function pairs actually submitted, in order. */
  readonly submitted: Array<{ contract: string; fn: string; hash: string }>;
  /** The cards the mock currently serves, in salt order. */
  readonly cards: CardFixture[];
  /** Methods the mock was asked for and does not implement. */
  readonly unhandled: string[];
}

interface InvokedCall {
  contract: string;
  fn: string;
  args: readonly xdr.ScVal[];
}

/** The invoked contract, function and arguments of a Soroban transaction. */
function decodeInvocation(envelopeXdr: string): { tx: Transaction; call: InvokedCall | null } {
  const tx = TransactionBuilder.fromXDR(envelopeXdr, NETWORK_PASSPHRASE) as Transaction;
  const op = tx.operations[0];
  if (op?.type !== "invokeHostFunction") return { tx, call: null };
  const func = op.func;
  if (func.type !== "hostFunctionTypeInvokeContract") return { tx, call: null };
  const invoke = func.invokeContract;
  return {
    tx,
    call: {
      contract: Address.fromScAddress(invoke.contractAddress).toString(),
      fn: invoke.functionName.toString(),
      args: invoke.args,
    },
  };
}

function txHash(tx: Transaction): string {
  return Buffer.from(tx.hash()).toString("hex");
}

function remaining(card: CardFixture): bigint {
  const left = card.periodAmount - card.spent;
  return left > 0n ? left : 0n;
}

/** One card's `info()` result, as the contract's `CardInfo` struct. */
function cardInfoScVal(card: CardFixture): xdr.ScVal {
  return struct({
    allow_count: u32(card.merchants.length),
    balance: i128(card.balance),
    label: str(card.label),
    owner: scAddress(OWNER),
    period: struct({ spent: i128(card.spent), start: u64(card.periodStart) }),
    policy: struct({
      expiry: u64(card.expiry),
      max_per_tx: i128(card.maxPerTx),
      period_amount: i128(card.periodAmount),
      period_duration: u64(card.periodDuration),
    }),
    remaining: i128(remaining(card)),
    signer: bytes(signerBytes(card.signer)),
    state: u32(card.state),
    token: scAddress(USDC),
  });
}

/**
 * Installs the mock on `page`. Must run before the first navigation: card
 * discovery starts as soon as the dashboard mounts.
 */
export async function installRpcMock(page: Page, options: RpcMockOptions = {}): Promise<RpcMock> {
  const cards: CardFixture[] = (options.cards ?? DEFAULT_CARDS).map((card) => ({
    ...card,
    merchants: [...card.merchants],
  }));
  const ownerBalance = options.ownerBalance ?? DEFAULT_OWNER_BALANCE;
  const notFoundPolls = options.notFoundPolls ?? 1;

  const calls: string[] = [];
  const simulated: Array<{ contract: string; fn: string }> = [];
  const submitted: Array<{ contract: string; fn: string; hash: string }> = [];
  const unhandled: string[] = [];
  /** Submitted transactions, keyed by hash, with their poll count. */
  const pending = new Map<string, { envelope: string; polls: number; call: InvokedCall | null }>();

  const findCard = (address: string) => cards.find((card) => card.address === address);

  function simulationResult(call: InvokedCall | null): xdr.ScVal | { error: string } {
    if (!call) return { error: "mock RPC: transaction carries no contract invocation" };
    const { contract, fn, args } = call;

    if (contract === USDC) {
      if (fn === "balance") {
        const who = scValToNative(args[0]) as string;
        if (who === OWNER) return i128(ownerBalance);
        return i128(findCard(who)?.balance ?? 0n);
      }
      if (fn === "transfer") return unit();
    }

    // The factory returns the address it deployed at, which is exactly the
    // address the app derived for the next free salt.
    if (contract === FACTORY && fn === "create_card") return scAddress(cardAddress(cards.length));

    const card = findCard(contract);
    if (card) {
      if (fn === "info") return cardInfoScVal(card);
      if (fn === "merchants") return vec(card.merchants.map((merchant) => scAddress(merchant)));
      if (CARD_WRITES.has(fn)) return unit();
    }

    return { error: `mock RPC has no result for ${fn}() on ${contract}` };
  }

  /** Applies a confirmed write to the mock's own state. */
  function applyEffect(call: InvokedCall | null): void {
    if (!call) return;

    if (call.contract === FACTORY && call.fn === "create_card") {
      // `create_card(owner, signer, token, policy, label, salt)`.
      const [, signer, , policyVal, label] = call.args;
      const policy = scValToNative(policyVal) as {
        expiry: bigint;
        max_per_tx: bigint;
        period_amount: bigint;
        period_duration: bigint;
      };
      cards.push({
        address: cardAddress(cards.length),
        label: scValToNative(label) as string,
        state: 0,
        balance: 0n,
        spent: 0n,
        periodStart: BigInt(LEDGER_CLOSE_TIME),
        periodAmount: policy.period_amount,
        maxPerTx: policy.max_per_tx,
        periodDuration: policy.period_duration,
        expiry: policy.expiry,
        signer: Address.account(Buffer.from(scValToNative(signer) as Uint8Array)).toString(),
        merchants: [],
      });
      return;
    }

    const card = findCard(call.contract);
    if (!card) return;
    switch (call.fn) {
      case "freeze":
        card.state = 1;
        break;
      case "unfreeze":
        card.state = 0;
        break;
      case "cancel":
        card.state = 2;
        break;
      case "set_label":
        card.label = scValToNative(call.args[0]) as string;
        break;
      case "add_merchant": {
        const merchant = scValToNative(call.args[0]) as string;
        if (!card.merchants.includes(merchant)) card.merchants.push(merchant);
        break;
      }
      case "remove_merchant": {
        const merchant = scValToNative(call.args[0]) as string;
        card.merchants = card.merchants.filter((m) => m !== merchant);
        break;
      }
      default:
        break;
    }
  }

  function handle(method: string, params: Record<string, unknown>): unknown {
    switch (method) {
      case "getHealth":
        return {
          status: "healthy",
          latestLedger: LATEST_LEDGER,
          oldestLedger: LATEST_LEDGER - 1000,
          ledgerRetentionWindow: 1000,
        };

      case "getNetwork":
        return { passphrase: NETWORK_PASSPHRASE, protocolVersion: 23 };

      case "getLatestLedger":
        return { id: "e2e-ledger", protocolVersion: 23, sequence: LATEST_LEDGER };

      case "getLedgerEntries": {
        const keys = (params.keys ?? []) as string[];
        const byKey = new Map(cards.map((card) => [contractInstanceKeyB64(card.address), card.address]));
        const ownerKey = accountKeyB64(OWNER);
        const entries = keys.flatMap((key) => {
          const card = byKey.get(key);
          if (card) {
            return [{ key, xdr: contractInstanceEntryB64(card), lastModifiedLedgerSeq: LATEST_LEDGER }];
          }
          if (key === ownerKey) {
            return [{ key, xdr: accountEntryB64(OWNER, "4242424242"), lastModifiedLedgerSeq: LATEST_LEDGER }];
          }
          return [];
        });
        return { latestLedger: LATEST_LEDGER, entries };
      }

      case "simulateTransaction": {
        const { call } = decodeInvocation(params.transaction as string);
        if (call) simulated.push({ contract: call.contract, fn: call.fn });
        const result = simulationResult(call);
        if ("error" in result) {
          return { error: result.error, latestLedger: LATEST_LEDGER, events: [] };
        }
        return {
          transactionData: SOROBAN_DATA_XDR,
          minResourceFee: "100000",
          results: [{ auth: [], xdr: toBase64(result) }],
          latestLedger: LATEST_LEDGER,
          events: [],
        };
      }

      case "sendTransaction": {
        const envelope = params.transaction as string;
        const { tx, call } = decodeInvocation(envelope);
        const hash = txHash(tx);
        pending.set(hash, { envelope, polls: 0, call });
        if (call) submitted.push({ contract: call.contract, fn: call.fn, hash });
        return {
          status: "PENDING",
          hash,
          latestLedger: LATEST_LEDGER,
          latestLedgerCloseTime: String(LEDGER_CLOSE_TIME),
        };
      }

      case "getTransaction": {
        const hash = params.hash as string;
        const entry = pending.get(hash);
        const base = {
          latestLedger: LATEST_LEDGER,
          latestLedgerCloseTime: String(LEDGER_CLOSE_TIME),
          oldestLedger: LATEST_LEDGER - 1000,
          oldestLedgerCloseTime: String(LEDGER_CLOSE_TIME - 5000),
        };
        if (!entry) return { status: "NOT_FOUND", ...base };
        if (entry.polls < notFoundPolls) {
          entry.polls += 1;
          return { status: "NOT_FOUND", ...base };
        }
        // Apply the write's effect exactly once, the first time it confirms.
        if (entry.polls === notFoundPolls) {
          entry.polls += 1;
          applyEffect(entry.call);
        }
        return {
          status: "SUCCESS",
          txHash: hash,
          ...base,
          ledger: LATEST_LEDGER,
          createdAt: String(LEDGER_CLOSE_TIME),
          applicationOrder: 1,
          feeBump: false,
          envelopeXdr: entry.envelope,
          resultXdr: SUCCESS_RESULT_XDR,
          resultMetaXdr: SUCCESS_META_XDR,
        };
      }

      default:
        unhandled.push(method);
        return null;
    }
  }

  const rpcOrigin = new URL(RPC_URL).origin;

  await page.route(
    (url) => url.origin === rpcOrigin,
    async (route: Route) => {
      const body = route.request().postDataJSON() as {
        id?: number | string;
        method?: string;
        params?: Record<string, unknown>;
      } | null;
      if (!body?.method) {
        await route.fulfill({ status: 400, body: "mock RPC: not a JSON-RPC request" });
        return;
      }
      calls.push(body.method);
      const result = handle(body.method, body.params ?? {});
      if (result === null) {
        await route.fulfill({
          json: {
            jsonrpc: "2.0",
            id: body.id ?? 1,
            error: { code: -32601, message: `mock RPC: unhandled method ${body.method}` },
          },
        });
        return;
      }
      await route.fulfill({ json: { jsonrpc: "2.0", id: body.id ?? 1, result } });
    },
  );

  return { calls, simulated, submitted, cards, unhandled };
}
