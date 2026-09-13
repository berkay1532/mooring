import { StrKey } from "@stellar/stellar-sdk";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import NewCardPage from "../../app/cards/new/page";
import { CardDetails } from "../../components/cards/CardDetails";
import { FundDeepLink } from "../../components/cards/FundDeepLink";
import type { CardInfo } from "../../lib/chain/card";
import { deriveCardAddress, saltBytes } from "../../lib/chain/derive";
import { config } from "../../lib/config";
import { getSelected } from "../../lib/prefs";

const OWNER = "GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD";
const AGENT = "GDHDJL3RT6S3OABSHLOEOCBH4BMMAKLVOR5FPEHXG5ZW2DDJDRRJJSM7";
const MERCHANT = "GAIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCF6M";
const MERCHANT_2 = "CAZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGGJH";
const CARD = "CBXHE6IOGUVDJEKAHPJGFXRPYSI7H6UFWQE2AYTE5HOSEOWFEXWJ6ULP";
const BASE = 10_000_000n;
const NOW = 1_800_000_000;

// --- mocks ----------------------------------------------------------------

const push = vi.fn();
const replace = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/cards/new",
  useSearchParams: () => searchParams,
}));

vi.mock("@/lib/wallet/context", () => ({
  useWallet: () => ({
    status: "connected",
    ready: true,
    address: OWNER,
    networkPassphrase: config.networkPassphrase,
    wallet: { publicKey: OWNER, signTransaction: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
    adapter: {},
  }),
}));

const discoverCardsMock = vi.fn(async () => [] as string[]);
vi.mock("@/lib/chain/discover", () => ({
  discoverCards: (...args: unknown[]) => discoverCardsMock(...(args as [])),
}));

const runCalls: Array<{ args: unknown }> = [];
/** Every `create_card` parameter object the wizard actually built. */
const createParams: Array<Record<string, never>> = [];
const addMerchantCalls: Array<[string, string]> = [];
let confirmImmediately = false;
/** When set, `run()` lands in `failed` with this translated error. */
let failWith: { title: string; detail?: string; next?: string } | null = null;
/** What the factory's simulated `create_card` returns, if anything. */
let factoryResult: string | undefined;

const FAKE_WALLET = { publicKey: OWNER, signTransaction: vi.fn() };

vi.mock("@/lib/chain/card", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/chain/card")>();
  return {
    ...actual,
    buildCreateCard: async (params: Record<string, never>) => {
      createParams.push(params);
      return { result: factoryResult };
    },
    buildAddMerchant: async (address: string, merchant: string) => {
      addMerchantCalls.push([address, merchant]);
      return { result: undefined };
    },
  };
});

/**
 * A `useContractAction` stand-in with real per-instance state (see
 * details.test.tsx). Unlike that one it actually calls `build(args, wallet)`
 * — so the arguments the wizard hands the factory are covered — and it
 * invalidates the caller's query keys on confirmation, which is what makes
 * the salt refetch (and so the B1 regression) reproducible here.
 */
function fakeUseContractAction(
  build: (args: never, wallet: never) => Promise<unknown>,
  opts: { onConfirmed?: (hash: string) => void; invalidates: (args: never) => unknown[] },
) {
  const [state, setState] = useState<string>("idle");
  const [error, setError] = useState<typeof failWith>(null);
  const queryClient = useQueryClient();
  return {
    state,
    hash: state === "idle" ? null : "HASH",
    error,
    reset: () => setState("idle"),
    run: async (args: never) => {
      runCalls.push({ args });
      setState("preparing");
      await build(args, FAKE_WALLET as never);
      if (failWith) {
        setError(failWith);
        setState("failed");
        return;
      }
      if (confirmImmediately) {
        setState("confirmed");
        opts.onConfirmed?.("HASH");
        for (const key of opts.invalidates(args)) {
          void queryClient.invalidateQueries({ queryKey: key as never });
        }
      }
    },
  };
}

let cardInfo: CardInfo;

vi.mock("@/lib/query/hooks", () => ({
  useContractAction: (build: never, opts: never) => fakeUseContractAction(build, opts),
  useCardInfo: () => ({ data: cardInfo, isLoading: false, error: null }),
  useMerchants: () => ({ data: [MERCHANT], isLoading: false, error: null }),
  useUsdcBalance: () => ({ data: 1_842_000_000n, isLoading: false, error: null }),
}));

function info(): CardInfo {
  return {
    owner: OWNER,
    signer: new Uint8Array(32).fill(7),
    token: config.usdc,
    label: "inference-agent",
    policy: {
      period_amount: 50n * BASE,
      period_duration: 86_400n,
      max_per_tx: 10n * BASE,
      expiry: BigInt(NOW + 2_505_600),
    },
    state: 0,
    period: { start: BigInt(NOW - 3_600), spent: 10n * BASE },
    remaining: 40n * BASE,
    balance: 110_000_001n,
    allow_count: 1,
  };
}

// --- harness ---------------------------------------------------------------

function Wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function wizard() {
  return render(<NewCardPage />, { wrapper: Wrapper });
}

const type = (label: RegExp | string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const click = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));

/** Fills a valid step 1 and advances to step 2. */
function fillPolicy(over: { label?: string; budget?: string; perTx?: string } = {}) {
  type(/card name/i, over.label ?? "inference-agent");
  type(/period budget/i, over.budget ?? "50");
  type(/max per transaction/i, over.perTx ?? "10");
  click(/continue/i);
}

/** Fills a valid step 2 and advances to step 3. */
function fillAgent() {
  type(/agent public key/i, AGENT);
  click(/continue/i);
}

beforeEach(() => {
  push.mockClear();
  replace.mockClear();
  runCalls.length = 0;
  createParams.length = 0;
  addMerchantCalls.length = 0;
  confirmImmediately = false;
  failWith = null;
  factoryResult = undefined;
  discoverCardsMock.mockClear();
  discoverCardsMock.mockResolvedValue([]);
  searchParams = new URLSearchParams();
  cardInfo = info();
  localStorage.clear();
});

afterEach(cleanup);

// --- step 1: policy --------------------------------------------------------

describe("new-card wizard · step 1 (policy)", () => {
  it("shows the three steps with only the current one reachable", () => {
    wizard();
    expect(screen.getByRole("button", { name: /1 · policy/i })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: /agent & merchants/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /confirm/i })).toBeDisabled();
  });

  it("updates the preview card live as the label and budget are typed", () => {
    wizard();
    type(/card name/i, "inference-agent");
    type(/period budget/i, "50");
    expect(screen.getByTestId("footer-label")).toHaveTextContent("inference-agent");
    expect(screen.getByTestId("budget-remaining")).toHaveTextContent("50.00 / 50.00");
    expect(screen.getByTestId("status")).toHaveTextContent(/draft/i);
  });

  it("counts label bytes, not characters, and names the byte count when too long", () => {
    wizard();
    type(/card name/i, "inference-agent"); // 15 ASCII bytes
    expect(screen.getByText(/15 \/ 32 bytes/)).toBeInTheDocument();

    type(/card name/i, "çç"); // 2 characters, 4 bytes
    expect(screen.getByText(/4 \/ 32 bytes/)).toBeInTheDocument();

    type(/card name/i, "ç".repeat(17)); // 17 characters, 34 bytes
    expect(screen.getByText(/34 bytes/)).toBeInTheDocument();
  });

  it("refuses to advance with an empty label and says so", () => {
    wizard();
    type(/period budget/i, "50");
    type(/max per transaction/i, "10");
    click(/continue/i);
    expect(screen.getByText(/give the card a name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/card name/i)).toBeInTheDocument(); // still on step 1
  });

  it("rejects a per-transaction cap larger than the period budget", () => {
    wizard();
    type(/card name/i, "inference-agent");
    type(/period budget/i, "50");
    type(/max per transaction/i, "60");
    expect(screen.getByText(/larger than the period budget/i)).toBeInTheDocument();
    click(/continue/i);
    expect(screen.getByLabelText(/max per transaction/i)).toBeInTheDocument(); // still on step 1
  });

  it("counts the trimmed label, which is what gets submitted", () => {
    wizard();
    type(/card name/i, "agent   ");
    expect(screen.getByText(/5 \/ 32 bytes/)).toBeInTheDocument();
  });

  it("refuses an absurd budget rather than failing at signing time", () => {
    wizard();
    type(/card name/i, "inference-agent");
    type(/period budget/i, "9999999999999");
    expect(screen.getByText(/larger than this app supports/i)).toBeInTheDocument();
  });

  it("asks for a custom period of at least 60 seconds", () => {
    wizard();
    fireEvent.click(screen.getByRole("radio", { name: /custom/i }));
    type(/period length/i, "30");
    expect(screen.getByText(/at least 60 seconds/i)).toBeInTheDocument();
  });
});

// --- step 2: agent & merchants --------------------------------------------

describe("new-card wizard · step 2 (agent & merchants)", () => {
  it("advances from a valid policy and points at the CLI for a key", () => {
    wizard();
    fillPolicy();
    expect(screen.getByLabelText(/agent public key/i)).toBeInTheDocument();
    expect(screen.getByText(/mooring keygen/)).toBeInTheDocument();
  });

  it("rejects a key that is not a G… ed25519 public key and ticks a valid one", () => {
    wizard();
    fillPolicy();
    type(/agent public key/i, "not-a-key");
    expect(screen.getByText(/not a Stellar public key/i)).toBeInTheDocument();
    click(/continue/i);
    expect(screen.getByLabelText(/agent public key/i)).toBeInTheDocument(); // still on step 2

    type(/agent public key/i, AGENT);
    expect(screen.getByText(/valid key/i)).toBeInTheDocument();
  });

  it("deduplicates merchants and removes them from the chip list", async () => {
    wizard();
    fillPolicy();
    type(/merchant address/i, MERCHANT);
    click(/add merchant/i);
    type(/merchant address/i, MERCHANT);
    click(/add merchant/i);

    const list = screen.getByRole("list", { name: /merchants/i });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText(/already/i)).toBeInTheDocument();

    fireEvent.click(within(list).getByRole("button", { name: /remove merchant/i }));
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("warns that an empty allowlist cannot pay anyone", () => {
    wizard();
    fillPolicy();
    expect(screen.getByText(/cannot pay anyone/i)).toBeInTheDocument();
  });

  it("disables a forward chip once an earlier step stops being valid", () => {
    wizard();
    fillPolicy();
    fillAgent();
    click(/✓ policy/i);
    type(/period budget/i, "");
    expect(screen.getByRole("button", { name: /confirm/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /agent & merchants/i })).toBeDisabled();
  });

  it("keeps step 1 state when going back", () => {
    wizard();
    fillPolicy({ label: "research-agent" });
    click(/back/i);
    expect(screen.getByLabelText(/card name/i)).toHaveValue("research-agent");
    expect(screen.getByLabelText(/period budget/i)).toHaveValue("50");
  });
});

// --- step 3: confirm -------------------------------------------------------

describe("new-card wizard · step 3 (confirm)", () => {
  const expected = () => deriveCardAddress(OWNER, saltBytes(0), config.factory, config.networkPassphrase);

  it("summarises the policy in plain language and shows the expected address", async () => {
    wizard();
    fillPolicy();
    fillAgent();

    expect(screen.getByText(/up to 50\.00 USDC per day/i)).toBeInTheDocument();
    expect(screen.getByText(/at most 10\.00 USDC per request/i)).toBeInTheDocument();
    expect(screen.getByText(/freeze, change or cancel/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(expected())).toBeInTheDocument());
  });

  it("uses the first free salt from discovery", async () => {
    discoverCardsMock.mockResolvedValue([CARD, CARD]);
    wizard();
    fillPolicy();
    fillAgent();
    const address = deriveCardAddress(OWNER, saltBytes(2), config.factory, config.networkPassphrase);
    await waitFor(() => expect(screen.getByText(address)).toBeInTheDocument());
  });

  it("creates the card, selects it and lands on /cards with the fund sheet", async () => {
    confirmImmediately = true;
    wizard();
    fillPolicy();
    fillAgent();
    await waitFor(() => expect(screen.getByText(expected())).toBeInTheDocument());

    click(/create with freighter/i);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/cards?fund=1"));
    expect(runCalls).toHaveLength(1);
    expect(getSelected(OWNER)).toBe(expected());
  });

  it("builds create_card with the owner, agent key, USDC token, policy, label and salt", async () => {
    confirmImmediately = true;
    wizard();
    fillPolicy();
    fillAgent();
    await waitFor(() => expect(screen.getByText(expected())).toBeInTheDocument());

    click(/create with freighter/i);
    await waitFor(() => expect(createParams).toHaveLength(1));

    const params = createParams[0] as unknown as {
      owner: string;
      signer: Uint8Array;
      token: string;
      label: string;
      salt: Uint8Array;
      policy: { period_amount: bigint; max_per_tx: bigint; period_duration: bigint; expiry: bigint };
    };
    expect(params.owner).toBe(OWNER);
    expect(params.token).toBe(config.usdc);
    expect(params.label).toBe("inference-agent");
    expect(StrKey.encodeEd25519PublicKey(Buffer.from(params.signer))).toBe(AGENT);
    expect(Array.from(params.salt)).toEqual(Array.from(saltBytes(0)));
    expect(params.policy.period_amount).toBe(50n * BASE);
    expect(params.policy.max_per_tx).toBe(10n * BASE);
    expect(params.policy.period_duration).toBe(86_400n);
    expect(typeof params.policy.expiry).toBe("bigint");
    expect(Number(params.policy.expiry)).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("prefers the address the factory returns over the derived one", async () => {
    confirmImmediately = true;
    factoryResult = CARD;
    wizard();
    fillPolicy();
    fillAgent();
    await waitFor(() => expect(screen.getByText(expected())).toBeInTheDocument());

    click(/create with freighter/i);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/cards?fund=1"));
    expect(getSelected(OWNER)).toBe(CARD);
  });

  it("keeps showing the created card's address after the salt query refetches", async () => {
    confirmImmediately = true;
    wizard();
    fillPolicy();
    type(/merchant address/i, MERCHANT);
    click(/add merchant/i);
    fillAgent();
    await waitFor(() => expect(screen.getByText(expected())).toBeInTheDocument());

    // Once the card lands, discovery finds one more card — so a refetched
    // salt would derive the *next* card's address.
    discoverCardsMock.mockResolvedValue([expected()]);
    click(/create with freighter/i);

    await waitFor(() => expect(discoverCardsMock.mock.calls.length).toBeGreaterThan(1));
    const nextAddress = deriveCardAddress(OWNER, saltBytes(1), config.factory, config.networkPassphrase);
    expect(screen.queryByText(nextAddress)).not.toBeInTheDocument();
    expect(screen.getByText(expected())).toBeInTheDocument();
    expect(addMerchantCalls).toEqual([[expected(), MERCHANT]]);
    await waitFor(() => expect(getSelected(OWNER)).toBe(expected()));
  });

  it("sends the owner to their cards after a poll timeout instead of re-creating", async () => {
    failWith = { title: "Not confirmed yet", detail: "Still pending after 60 seconds." };
    wizard();
    fillPolicy();
    fillAgent();
    await waitFor(() => expect(screen.getByText(expected())).toBeInTheDocument());

    click(/create with freighter/i);
    await waitFor(() => expect(screen.getByRole("button", { name: /check my cards/i })).toBeInTheDocument());
    expect(screen.getByText(/may still have been created/i)).toBeInTheDocument();

    click(/check my cards/i);
    expect(push).toHaveBeenCalledWith("/cards");
    expect(runCalls).toHaveLength(1); // never re-ran create_card with the same salt
  });

  it("locks the steps while the card is being created", async () => {
    confirmImmediately = false;
    wizard();
    fillPolicy();
    fillAgent();
    await waitFor(() => expect(screen.getByText(expected())).toBeInTheDocument());

    click(/create with freighter/i);
    await waitFor(() => expect(screen.getByRole("button", { name: /← back/i })).toBeDisabled());
    expect(screen.getByRole("button", { name: /✓ policy/i })).toBeDisabled();
  });

  it("adds each collected merchant in its own transaction after the card exists", async () => {
    confirmImmediately = true;
    wizard();
    fillPolicy();
    type(/merchant address/i, MERCHANT);
    click(/add merchant/i);
    type(/merchant address/i, MERCHANT_2);
    click(/add merchant/i);
    fillAgent();
    await waitFor(() => expect(screen.getByText(expected())).toBeInTheDocument());

    expect(screen.getByText(/2 more/i)).toBeInTheDocument(); // one create + two merchant transactions
    click(/create with freighter/i);

    await waitFor(() => expect(runCalls).toHaveLength(3));
    expect(runCalls[1].args).toMatchObject({ card: expected(), merchant: MERCHANT });
    expect(runCalls[2].args).toMatchObject({ card: expected(), merchant: MERCHANT_2 });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/cards?fund=1"));
  });
});

// --- fund deep link --------------------------------------------------------

describe("fund deep link", () => {
  it("fires once for ?fund=1 and strips the parameter", async () => {
    searchParams = new URLSearchParams("fund=1");
    const onFund = vi.fn();
    const { rerender } = render(<FundDeepLink onFund={onFund} />);
    rerender(<FundDeepLink onFund={onFund} />);
    await waitFor(() => expect(onFund).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith("/cards");
  });

  it("does nothing without the parameter", async () => {
    const onFund = vi.fn();
    render(<FundDeepLink onFund={onFund} />);
    await waitFor(() => expect(replace).not.toHaveBeenCalled());
    expect(onFund).not.toHaveBeenCalled();
  });

  it("opens the fund sheet on the details panel when signalled, and reports it once", async () => {
    const onFundOpened = vi.fn();
    render(
      <CardDetails
        address={CARD}
        owner={OWNER}
        nowUnix={NOW}
        fundSignal={1}
        onFundOpened={onFundOpened}
        onToast={() => {}}
        onRemoved={() => {}}
      />,
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(screen.getByText(/fund the card/i)).toBeInTheDocument());
    expect(onFundOpened).toHaveBeenCalledTimes(1);
  });

  it("does not open the fund sheet for the next card once the signal is consumed", async () => {
    render(
      <CardDetails address={CARD} owner={OWNER} nowUnix={NOW} fundSignal={0} onToast={() => {}} onRemoved={() => {}} />,
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(screen.getByText(/inference-agent/i)).toBeInTheDocument());
    expect(screen.queryByText(/fund the card/i)).not.toBeInTheDocument();
  });
});
