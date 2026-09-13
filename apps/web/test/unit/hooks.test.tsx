import { Account, Asset, Operation, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import type { AssembledTransaction } from "@stellar/stellar-sdk/contract";

import type { CardInfo, Wallet } from "../../lib/chain/card";

const PASSPHRASE = "Test SDF Network ; September 2015";
const OWNER = "GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD";
const CARD = "CBXHE6IOGUVDJEKAHPJGFXRPYSI7H6UFWQE2AYTE5HOSEOWFEXWJ6ULP";

// --- Mocks -------------------------------------------------------------

const sendTransaction = vi.fn();
const getTransaction = vi.fn();
const getLedgerEntries = vi.fn();

vi.mock("../../lib/chain/rpc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/chain/rpc")>();
  return {
    ...actual,
    getRpcServer: () => ({ sendTransaction, getTransaction, getLedgerEntries }),
  };
});

const readInfoMock = vi.fn();
const readMerchantsMock = vi.fn();

vi.mock("../../lib/chain/card", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/chain/card")>();
  return {
    ...actual,
    readInfo: (address: string) => readInfoMock(address),
    readMerchants: (address: string) => readMerchantsMock(address),
  };
});

let walletValue: { wallet: Wallet | null; networkPassphrase: string | null } = {
  wallet: null,
  networkPassphrase: PASSPHRASE,
};

vi.mock("../../lib/wallet/context", () => ({
  useWallet: () => walletValue,
}));

// Captures every options object passed to react-query's `useQuery`, while
// still delegating to the real implementation — lets a test inspect a
// `refetchInterval` function form without reimplementing react-query.
const queryOptionCalls: Array<Record<string, unknown>> = [];
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: (options: Record<string, unknown>) => {
      queryOptionCalls.push(options);
      return actual.useQuery(options as never);
    },
  };
});

import { CARD_ERRORS } from "@mooring/x402-client";

import { addCard } from "../../lib/prefs";
import { config } from "../../lib/config";
import { contractInstanceKey, deriveCardAddress, saltBytes } from "../../lib/chain/derive";
import { useCardInfo, useCards, useContractAction, useMerchants } from "../../lib/query/hooks";
import { keys } from "../../lib/query/keys";

function addressFor(owner: string, n: number): string {
  return deriveCardAddress(owner, saltBytes(n), config.factory, config.networkPassphrase);
}
function keyOf(address: string): string {
  return contractInstanceKey(address).toXDR("base64");
}

function fakeInfo(): CardInfo {
  return {
    owner: OWNER,
    signer: new Uint8Array(32),
    token: config.usdc,
    label: "test card",
    policy: { period_amount: 0n, period_duration: 0n, max_per_tx: 0n, expiry: 0n },
    state: 0,
    period: { start: 0n, spent: 0n },
    remaining: 0n,
    balance: 0n,
    allow_count: 0,
  };
}

/** A real, parseable (if unsigned) transaction envelope, for use anywhere a
 * `signedTxXdr` or a plain `Transaction` needs to survive a real
 * `TransactionBuilder.fromXDR` round trip. Its content is otherwise
 * irrelevant — `sendTransaction`/`getTransaction` are mocked. */
function realTx(): Transaction {
  const account = new Account(OWNER, "100");
  return new TransactionBuilder(account, { fee: "100", networkPassphrase: PASSPHRASE })
    .addOperation(Operation.payment({ destination: OWNER, asset: Asset.native(), amount: "1" }))
    .setTimeout(30)
    .build();
}
function realTxXdr(): string {
  return realTx().toXDR();
}

function makeWallet(signTransaction: Wallet["signTransaction"]): Wallet {
  return { publicKey: OWNER, signTransaction };
}

/** A fake `AssembledTransaction`: duck-typed (has `.simulate`/`.built`), not
 * a real instance — the real class makes network calls during simulation.
 * Its `.simulate()` sets a successful `simulation` (matching the real SDK,
 * which always populates `tx.simulation` — see `makeAssembledTxWithSimulation`
 * for a pre-simulated tx, e.g. one whose simulation already failed). */
function makeAssembledTx(): AssembledTransaction<unknown> {
  const fake: { built: { toXDR: () => string }; simulation?: unknown; simulate: ReturnType<typeof vi.fn> } = {
    built: { toXDR: () => "unsigned-blob" },
    simulate: vi.fn(async function (this: typeof fake) {
      this.simulation = { transactionData: {} }; // a successful, non-restore simulation
      return this;
    }),
  };
  return fake as unknown as AssembledTransaction<unknown>;
}

/** A fake `AssembledTransaction` that arrives already simulated (as every
 * bindings `Client` method does by default) with the given `simulation` —
 * used to exercise a failed or restore-needed simulation, which the hook
 * must catch in `preparing`, before `signing`. */
function makeAssembledTxWithSimulation(simulation: Record<string, unknown>): AssembledTransaction<unknown> {
  const fake = {
    built: { toXDR: () => "unsigned-blob" },
    simulation,
    simulate: vi.fn(async function (this: unknown) {
      return this;
    }),
  };
  return fake as unknown as AssembledTransaction<unknown>;
}

let queryClient: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryOptionCalls.length = 0;
  sendTransaction.mockReset();
  getTransaction.mockReset();
  getLedgerEntries.mockReset();
  readInfoMock.mockReset();
  readMerchantsMock.mockReset();
  walletValue = { wallet: null, networkPassphrase: PASSPHRASE };
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

// --- useContractAction ---------------------------------------------------

describe("useContractAction", () => {
  it("happy path: preparing -> signing -> submitted -> confirmed, and invalidates the given keys", async () => {
    vi.useFakeTimers();
    const signTransaction = vi.fn(async () => ({ signedTxXdr: realTxXdr() }));
    walletValue = { wallet: makeWallet(signTransaction), networkPassphrase: PASSPHRASE };
    sendTransaction.mockResolvedValue({ status: "PENDING", hash: "deadbeef", latestLedger: 1, latestLedgerCloseTime: 1 });
    getTransaction
      .mockResolvedValueOnce({ status: "NOT_FOUND" })
      .mockResolvedValueOnce({ status: "SUCCESS" });

    const assembledTx = makeAssembledTx();
    const build = vi.fn(async () => assembledTx);
    const onConfirmed = vi.fn();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(
      () => useContractAction<{ id: string }>(build, { invalidates: (args) => [keys.info(args.id)], onConfirmed }),
      { wrapper },
    );

    expect(result.current.state).toBe("idle");

    act(() => {
      void result.current.run({ id: "card1" });
    });

    // Flush the microtask chain (build -> simulate -> sign -> send) up to
    // the first poll's `setTimeout`.
    await advance(0);
    expect(build).toHaveBeenCalledWith({ id: "card1" }, walletValue.wallet);
    expect(vi.mocked(assembledTx.simulate)).toHaveBeenCalledTimes(1);
    expect(signTransaction).toHaveBeenCalledTimes(1);
    expect(sendTransaction).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe("submitted");
    expect(result.current.hash).toBe("deadbeef");

    await advance(1000); // first poll: NOT_FOUND, keeps polling
    expect(result.current.state).toBe("submitted");

    await advance(1000); // second poll: SUCCESS
    expect(result.current.state).toBe("confirmed");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: keys.info("card1") });
    expect(onConfirmed).toHaveBeenCalledWith("deadbeef");
  });

  it("a signer that throws { code: -4 } fails with the declined title and never submits", async () => {
    const signTransaction = vi.fn(async () => {
      throw { code: -4, message: "User declined access" };
    });
    walletValue = { wallet: makeWallet(signTransaction), networkPassphrase: PASSPHRASE };
    const build = vi.fn(async () => makeAssembledTx());

    const { result } = renderHook(() => useContractAction(build, { invalidates: () => [] }), { wrapper });

    await act(async () => {
      await result.current.run({});
    });

    expect(result.current.state).toBe("failed");
    expect(result.current.error?.title).toMatch(/declined/i);
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("ignores a second run() while one is already in flight", async () => {
    vi.useFakeTimers();
    const signTransaction = vi.fn(async () => ({ signedTxXdr: realTxXdr() }));
    walletValue = { wallet: makeWallet(signTransaction), networkPassphrase: PASSPHRASE };
    sendTransaction.mockResolvedValue({ status: "PENDING", hash: "deadbeef", latestLedger: 1, latestLedgerCloseTime: 1 });
    getTransaction.mockResolvedValue({ status: "SUCCESS" });

    let resolveBuild!: (tx: ReturnType<typeof makeAssembledTx>) => void;
    const build = vi.fn(
      () =>
        new Promise<ReturnType<typeof makeAssembledTx>>((resolve) => {
          resolveBuild = resolve;
        }),
    );

    const { result } = renderHook(() => useContractAction(build, { invalidates: () => [] }), { wrapper });

    act(() => {
      void result.current.run({ id: 1 });
    });
    act(() => {
      void result.current.run({ id: 2 });
    });

    expect(build).toHaveBeenCalledTimes(1);

    // Settle the first run so nothing is left dangling for later tests.
    resolveBuild(makeAssembledTx());
    await advance(0);
    await advance(1000);
    expect(result.current.state).toBe("confirmed");
  });

  it("a sendTransaction ERROR status fails with a translated error and preserves the hash", async () => {
    const signTransaction = vi.fn(async () => ({ signedTxXdr: realTxXdr() }));
    walletValue = { wallet: makeWallet(signTransaction), networkPassphrase: PASSPHRASE };
    sendTransaction.mockResolvedValueOnce({ status: "ERROR", hash: "deadbeef", latestLedger: 1, latestLedgerCloseTime: 1 });
    const build = vi.fn(async () => makeAssembledTx());

    const { result } = renderHook(() => useContractAction(build, { invalidates: () => [] }), { wrapper });

    await act(async () => {
      await result.current.run({});
    });

    expect(result.current.state).toBe("failed");
    expect(result.current.hash).toBe("deadbeef");
    expect(result.current.error).toBeTruthy();
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it("a poll timeout fails with a 'not confirmed yet' error, keeps the hash, and points at the explorer", async () => {
    vi.useFakeTimers();
    const signTransaction = vi.fn(async () => ({ signedTxXdr: realTxXdr() }));
    walletValue = { wallet: makeWallet(signTransaction), networkPassphrase: PASSPHRASE };
    sendTransaction.mockResolvedValueOnce({ status: "PENDING", hash: "deadbeef", latestLedger: 1, latestLedgerCloseTime: 1 });
    getTransaction.mockResolvedValue({ status: "NOT_FOUND" });
    const build = vi.fn(async () => makeAssembledTx());

    const { result } = renderHook(() => useContractAction(build, { invalidates: () => [] }), { wrapper });

    act(() => {
      void result.current.run({});
    });

    await advance(61_000);

    expect(result.current.state).toBe("failed");
    expect(result.current.hash).toBe("deadbeef");
    expect(result.current.error?.title).toMatch(/not confirmed/i);
    expect(result.current.error?.next).toContain("deadbeef");
  }, 15_000);

  it("signs and sends a plain Transaction build result (buildFundTransfer's shape), not just an AssembledTransaction", async () => {
    vi.useFakeTimers();
    const signTransaction = vi.fn(async () => ({ signedTxXdr: realTxXdr() }));
    walletValue = { wallet: makeWallet(signTransaction), networkPassphrase: PASSPHRASE };
    sendTransaction.mockResolvedValue({ status: "PENDING", hash: "cafebabe", latestLedger: 1, latestLedgerCloseTime: 1 });
    getTransaction.mockResolvedValue({ status: "SUCCESS" });

    const plainTx = realTx();
    const build = vi.fn(async () => plainTx);

    const { result } = renderHook(() => useContractAction(build, { invalidates: () => [] }), { wrapper });

    act(() => {
      void result.current.run({});
    });
    await advance(0);
    expect(signTransaction).toHaveBeenCalledWith(plainTx.toXDR(), { networkPassphrase: PASSPHRASE });
    await advance(1000);
    expect(result.current.state).toBe("confirmed");
  });

  it("reset() returns to idle and clears hash/error", async () => {
    const signTransaction = vi.fn(async () => {
      throw { code: -4 };
    });
    walletValue = { wallet: makeWallet(signTransaction), networkPassphrase: PASSPHRASE };
    const build = vi.fn(async () => makeAssembledTx());

    const { result } = renderHook(() => useContractAction(build, { invalidates: () => [] }), { wrapper });

    await act(async () => {
      await result.current.run({});
    });
    expect(result.current.state).toBe("failed");

    act(() => {
      result.current.reset();
    });
    expect(result.current.state).toBe("idle");
    expect(result.current.hash).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("wallet === null fails immediately with a typed 'connect a wallet' error", async () => {
    walletValue = { wallet: null, networkPassphrase: null };
    const build = vi.fn(async () => makeAssembledTx());

    const { result } = renderHook(() => useContractAction(build, { invalidates: () => [] }), { wrapper });

    await act(async () => {
      await result.current.run({});
    });

    expect(result.current.state).toBe("failed");
    expect(result.current.error).toEqual({
      title: "Connect a wallet",
      next: "Connect Freighter to continue.",
    });
    expect(build).not.toHaveBeenCalled();
  });

  it("a sendTransaction TRY_AGAIN_LATER status fails fast, without polling", async () => {
    const signTransaction = vi.fn(async () => ({ signedTxXdr: realTxXdr() }));
    walletValue = { wallet: makeWallet(signTransaction), networkPassphrase: PASSPHRASE };
    sendTransaction.mockResolvedValueOnce({
      status: "TRY_AGAIN_LATER",
      hash: "deadbeef",
      latestLedger: 1,
      latestLedgerCloseTime: 1,
    });
    const build = vi.fn(async () => makeAssembledTx());

    const { result } = renderHook(() => useContractAction(build, { invalidates: () => [] }), { wrapper });

    await act(async () => {
      await result.current.run({});
    });

    expect(result.current.state).toBe("failed");
    expect(result.current.hash).toBe("deadbeef");
    expect(result.current.error?.title).toMatch(/busy/i);
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it("a getTransaction FAILED status fails with a translated error", async () => {
    vi.useFakeTimers();
    const signTransaction = vi.fn(async () => ({ signedTxXdr: realTxXdr() }));
    walletValue = { wallet: makeWallet(signTransaction), networkPassphrase: PASSPHRASE };
    sendTransaction.mockResolvedValueOnce({ status: "PENDING", hash: "deadbeef", latestLedger: 1, latestLedgerCloseTime: 1 });
    getTransaction.mockResolvedValueOnce({ status: "FAILED", resultXdr: {} });
    const build = vi.fn(async () => makeAssembledTx());

    const { result } = renderHook(() => useContractAction(build, { invalidates: () => [] }), { wrapper });

    act(() => {
      void result.current.run({});
    });
    await advance(0);
    await advance(1000);

    expect(result.current.state).toBe("failed");
    expect(result.current.hash).toBe("deadbeef");
    expect(result.current.error).toBeTruthy();
  });

  it("unmount mid-flight: no onConfirmed after unmount, and no pending timers are left", async () => {
    vi.useFakeTimers();
    const signTransaction = vi.fn(async () => ({ signedTxXdr: realTxXdr() }));
    walletValue = { wallet: makeWallet(signTransaction), networkPassphrase: PASSPHRASE };
    sendTransaction.mockResolvedValue({ status: "PENDING", hash: "deadbeef", latestLedger: 1, latestLedgerCloseTime: 1 });
    getTransaction.mockResolvedValue({ status: "NOT_FOUND" });
    const build = vi.fn(async () => makeAssembledTx());
    const onConfirmed = vi.fn();

    const { result, unmount } = renderHook(() => useContractAction(build, { invalidates: () => [], onConfirmed }), {
      wrapper,
    });

    act(() => {
      void result.current.run({});
    });
    await advance(0); // reach "submitted", first poll timer scheduled
    expect(result.current.state).toBe("submitted");
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();
    expect(vi.getTimerCount()).toBe(0); // the pending poll timer was cleared

    // Even if the network eventually would have said SUCCESS, nothing fires
    // post-unmount: no new timer is scheduled, so this is a no-op advance.
    getTransaction.mockResolvedValue({ status: "SUCCESS" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a failed simulation fails at preparing — before signing — mapped through CARD_ERRORS", async () => {
    const signTransaction = vi.fn(async () => ({ signedTxXdr: realTxXdr() }));
    walletValue = { wallet: makeWallet(signTransaction), networkPassphrase: PASSPHRASE };
    // Neither `build()` nor `tx.simulate()` throws on a failed simulation in
    // the real SDK — the error lands in `tx.simulation`, and `tx.built`
    // stays the raw, unassembled transaction. This fake arrives already in
    // that state, as every bindings `Client` method would.
    const simTx = makeAssembledTxWithSimulation({ error: "HostError: Error(Contract, #3)", events: [] });
    const build = vi.fn(async () => simTx);

    const { result } = renderHook(() => useContractAction(build, { invalidates: () => [] }), { wrapper });

    await act(async () => {
      await result.current.run({});
    });

    expect(result.current.state).toBe("failed");
    expect(result.current.error?.code).toBe(3);
    expect(result.current.error?.title).toBe(CARD_ERRORS[3]);
    expect(vi.mocked(simTx.simulate)).not.toHaveBeenCalled();
    expect(signTransaction).not.toHaveBeenCalled();
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("a restore-preamble simulation also fails at preparing, before signing", async () => {
    const signTransaction = vi.fn(async () => ({ signedTxXdr: realTxXdr() }));
    walletValue = { wallet: makeWallet(signTransaction), networkPassphrase: PASSPHRASE };
    const simTx = makeAssembledTxWithSimulation({
      transactionData: {},
      restorePreamble: { transactionData: {} },
    });
    const build = vi.fn(async () => simTx);

    const { result } = renderHook(() => useContractAction(build, { invalidates: () => [] }), { wrapper });

    await act(async () => {
      await result.current.run({});
    });

    expect(result.current.state).toBe("failed");
    expect(result.current.error?.title).toMatch(/restored/i);
    expect(signTransaction).not.toHaveBeenCalled();
  });
});

// --- useCards --------------------------------------------------------------

describe("useCards", () => {
  it("merges discovered + added cards, discovered first, de-duplicated", async () => {
    const discovered0 = addressFor(OWNER, 0);
    const discovered1 = addressFor(OWNER, 1);
    const added = "CADDEDCARD00000000000000000000000000000000000000000AA";
    const existing = new Set([discovered0, discovered1].map(keyOf));
    getLedgerEntries.mockImplementation(async (key) =>
      existing.has(key.toXDR("base64")) ? { entries: [{}] } : { entries: [] },
    );

    addCard(OWNER, discovered0); // already discovered: must not duplicate
    addCard(OWNER, added);

    const { result } = renderHook(() => useCards(OWNER), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([discovered0, discovered1, added]);
  });

  it("surfaces a discovery error rather than pretending there are no cards", async () => {
    getLedgerEntries.mockRejectedValue(new Error("network error: connection reset"));

    const { result } = renderHook(() => useCards(OWNER), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.data).toBeUndefined();
  });
});

// --- useCardInfo / useMerchants ---------------------------------------------

describe("useCardInfo", () => {
  it("reads a card's info", async () => {
    readInfoMock.mockResolvedValue(fakeInfo());
    const { result } = renderHook(() => useCardInfo(CARD), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(fakeInfo()));
    expect(readInfoMock).toHaveBeenCalledWith(CARD);
  });

  it("refetchInterval is a function returning 10s only while the tab is visible", async () => {
    readInfoMock.mockResolvedValue(fakeInfo());
    renderHook(() => useCardInfo(CARD), { wrapper });
    await waitFor(() => expect(readInfoMock).toHaveBeenCalled());

    const call = queryOptionCalls.find(
      (c) => JSON.stringify(c.queryKey) === JSON.stringify(keys.info(CARD)),
    );
    expect(call).toBeTruthy();
    const refetchInterval = call!.refetchInterval as () => number | false;

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    expect(refetchInterval()).toBe(10_000);

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    expect(refetchInterval()).toBe(false);
  });
});

describe("useMerchants", () => {
  it("reads a card's merchant allowlist", async () => {
    readMerchantsMock.mockResolvedValue(["CMERCHANT1", "CMERCHANT2"]);
    const { result } = renderHook(() => useMerchants(CARD), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(["CMERCHANT1", "CMERCHANT2"]));
    expect(readMerchantsMock).toHaveBeenCalledWith(CARD);
  });
});
