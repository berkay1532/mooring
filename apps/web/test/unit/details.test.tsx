import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CardDetails } from "../../components/cards/CardDetails";
import { AddCardModal } from "../../components/cards/AddCardModal";
import { CancelModal } from "../../components/cards/CancelModal";
import { PolicyModal } from "../../components/cards/PolicyModal";
import { RenameModal } from "../../components/cards/RenameModal";
import { SignerModal } from "../../components/cards/SignerModal";
import { WithdrawModal } from "../../components/cards/WithdrawModal";
import type { CardInfo } from "../../lib/chain/card";

const BASE = 10_000_000n;
const NOW = 1_800_000_000;
const OWNER = "GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD";
const OTHER = "GDHDJL3RT6S3OABSHLOEOCBH4BMMAKLVOR5FPEHXG5ZW2DDJDRRJJSM7";
const CARD = "CAJPWJRJPFIY6XYYQIVCC3XLYFYQVNJIJ6XVPTUY4EBLNQ3CFN2AHCJ";
const MERCHANT = "GAW3KSJBGKNWX3TOWQYRT5UQ4KXWQ4M5X5VZXHBYRPLEN24TCVVTM2KA";

function info(over: Partial<CardInfo> = {}): CardInfo {
  return {
    owner: OWNER,
    signer: new Uint8Array(32).fill(7),
    token: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
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
    balance: 110_000_001n, // 11.0000001 USDC — an exact, non-round base amount
    allow_count: 1,
    ...over,
  };
}

// --- mocked data + action hooks -------------------------------------------

let cardInfo: CardInfo = info();
let infoError: unknown = null;
let merchants: string[] = [MERCHANT];
let walletBalance: { data?: bigint; error: unknown; pending?: boolean } = {
  data: 1_842_000_000n,
  error: null,
};

const runCalls: Array<{ args: unknown }> = [];

/**
 * A stand-in for `useContractAction` with real per-instance state: `run()`
 * moves *that* instance to `preparing`, which is what makes the per-card
 * busy lock observable (every other action's trigger must go disabled).
 */
function fakeUseContractAction(_build: unknown, opts: { onConfirmed?: (hash: string) => void }) {
  const [state, setState] = useState<string>("idle");
  return {
    state,
    hash: state === "idle" ? null : "HASH",
    error: null,
    reset: () => setState("idle"),
    run: async (args: unknown) => {
      runCalls.push({ args });
      setState("preparing");
      if (confirmImmediately) {
        setState("confirmed");
        opts.onConfirmed?.("HASH");
      }
    },
  };
}
let confirmImmediately = false;

vi.mock("@/lib/query/hooks", () => ({
  useCardInfo: () => ({ data: cardInfo, isLoading: false, error: infoError }),
  useMerchants: () => ({ data: merchants, isLoading: false, error: null }),
  useUsdcBalance: () => ({
    data: walletBalance.data,
    isLoading: walletBalance.pending ?? false,
    isPending: walletBalance.pending ?? false,
    error: walletBalance.error,
  }),
  useContractAction: (build: unknown, opts: never) => fakeUseContractAction(build, opts),
}));

const verifyOwnedCard = vi.fn();
vi.mock("@/lib/chain/card", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/chain/card")>();
  return { ...actual, verifyOwnedCard: (...args: unknown[]) => verifyOwnedCard(...args) };
});

const addCard = vi.fn();
vi.mock("@/lib/prefs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/prefs")>();
  return { ...actual, addCard: (...args: unknown[]) => addCard(...args) };
});

beforeEach(() => {
  cardInfo = info();
  infoError = null;
  merchants = [MERCHANT];
  walletBalance = { data: 1_842_000_000n, error: null };
  runCalls.length = 0;
  confirmImmediately = false;
  verifyOwnedCard.mockReset();
  addCard.mockReset();
});

afterEach(cleanup);

function details() {
  return render(<CardDetails address={CARD} owner={OWNER} nowUnix={NOW} onToast={() => {}} onRemoved={() => {}} />);
}

// --- tests ----------------------------------------------------------------

describe("CardDetails", () => {
  it("shows the stat row from info()", () => {
    details();
    expect(screen.getByText("11.00")).toBeInTheDocument(); // balance
    expect(screen.getByText("40.00")).toBeInTheDocument(); // remaining this period
    expect(screen.getByText("10.00")).toBeInTheDocument(); // per tx
  });

  it("offers Freeze for an active card and Unfreeze for a frozen one", () => {
    const { unmount } = details();
    expect(screen.getByRole("button", { name: "Freeze" })).toBeInTheDocument();
    unmount();

    cardInfo = info({ state: 1 });
    details();
    expect(screen.getByRole("button", { name: "Unfreeze" })).toBeInTheDocument();
  });

  it("locks every other action on the card while one is in flight", () => {
    details();
    const freeze = screen.getByRole("button", { name: "Freeze" });
    fireEvent.click(freeze);

    expect(runCalls).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Fund" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /rename/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /edit policy/i })).toBeDisabled();

    // A second click never reaches the wallet a second time.
    fireEvent.click(freeze);
    expect(runCalls).toHaveLength(1);
  });

  it("renders the agent signer as a G… strkey", () => {
    details();
    expect(screen.getByText(/^G[A-Z2-7]{3}…[A-Z2-7]{4}$/)).toBeInTheDocument();
  });

  it("lists the merchant allowlist with its count", () => {
    details();
    expect(screen.getByText(/1 \/ 32/)).toBeInTheDocument();
    expect(screen.getByText(MERCHANT)).toBeInTheDocument();
  });

  it("pauses merchant writes too when the panel says writes are paused", () => {
    infoError = new Error("rpc unreachable");
    details();
    expect(screen.getByText(/writes are paused/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^\+ add$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /remove merchant/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Fund" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /rename/i })).toBeDisabled();
  });

  it("pauses merchant writes on a cancelled card", () => {
    cardInfo = info({ state: 2 });
    details();
    expect(screen.getByRole("button", { name: /^\+ add$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /remove merchant/i })).toBeDisabled();
  });

  it("copies the card address from the details header", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    details();
    fireEvent.click(screen.getByRole("button", { name: /copy card address/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CARD));
  });
});

describe("RenameModal", () => {
  function renameModal() {
    return render(
      <RenameModal open address={CARD} info={cardInfo} onClose={() => {}} onDone={() => {}} />,
    );
  }

  it("counts UTF-8 bytes, not characters, and rejects 33 bytes", () => {
    renameModal();
    const input = screen.getByLabelText(/card name/i);

    fireEvent.change(input, { target: { value: "a".repeat(33) } });
    expect(screen.getByText("33/32 bytes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^rename$/i })).toBeDisabled();

    // 17 characters, 34 bytes — the character count alone would pass.
    fireEvent.change(input, { target: { value: "ç".repeat(17) } });
    expect(screen.getByText("34/32 bytes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^rename$/i })).toBeDisabled();

    fireEvent.change(input, { target: { value: "ç".repeat(16) } });
    expect(screen.getByText("32/32 bytes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^rename$/i })).toBeEnabled();
  });

  it("rejects an empty name and says renaming is an on-chain transaction", () => {
    renameModal();
    fireEvent.change(screen.getByLabelText(/card name/i), { target: { value: "" } });
    expect(screen.getByRole("button", { name: /^rename$/i })).toBeDisabled();
    expect(screen.getByText(/on-chain transaction/i)).toBeInTheDocument();
  });
});

describe("CancelModal", () => {
  it("keeps the confirm button disabled until 'cancel' is typed", () => {
    render(<CancelModal open address={CARD} info={cardInfo} onClose={() => {}} onDone={() => {}} />);
    const confirm = screen.getByRole("button", { name: /cancel this card/i });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/type cancel/i), { target: { value: "canc" } });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/type cancel/i), { target: { value: "cancel" } });
    expect(confirm).toBeEnabled();
  });
});

describe("WithdrawModal", () => {
  function withdrawModal() {
    return render(
      <WithdrawModal open address={CARD} info={cardInfo} owner={OWNER} onClose={() => {}} onDone={() => {}} />,
    );
  }

  it("fills Max from the exact base-unit balance, not the 2-decimal display", () => {
    withdrawModal();
    fireEvent.click(screen.getByRole("button", { name: /^max$/i }));
    expect(screen.getByLabelText(/amount/i)).toHaveValue("11.0000001");
  });

  it("compares the typed amount against the balance in base units", () => {
    withdrawModal();
    const input = screen.getByLabelText(/amount/i);

    // 11.00 is what the card *displays*; the true balance is 11.0000001,
    // so 11.0000002 must be rejected and 11.0000001 accepted.
    fireEvent.change(input, { target: { value: "11.0000002" } });
    expect(screen.getByRole("button", { name: /^withdraw$/i })).toBeDisabled();
    expect(screen.getByText(/more than the card holds/i)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "11.0000001" } });
    expect(screen.getByRole("button", { name: /^withdraw$/i })).toBeEnabled();
  });

  it("says nothing about the trustline while the balance read is still pending", () => {
    walletBalance = { data: undefined, error: null, pending: true };
    withdrawModal();
    expect(screen.queryByText(/could not read your wallet/i)).toBeNull();
    expect(screen.queryByText(/USDC trustline/i)).toBeNull();
  });

  it("explains a missing USDC trustline instead of letting the write fail", () => {
    walletBalance = { data: undefined, error: new Error("trustline entry is missing for account") };
    withdrawModal();
    fireEvent.click(screen.getByRole("button", { name: /^max$/i }));
    expect(screen.getByText(/USDC trustline/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^withdraw$/i })).toBeDisabled();
  });
});

describe("PolicyModal", () => {
  function policyModal() {
    return render(
      <PolicyModal open address={CARD} info={cardInfo} nowUnix={NOW} onClose={() => {}} onDone={() => {}} />,
    );
  }

  it("mirrors the contract's validation client-side", () => {
    policyModal();
    const perTx = screen.getByLabelText(/per transaction/i);

    fireEvent.change(perTx, { target: { value: "80" } });
    expect(screen.getByText(/cannot be larger than the period budget/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save policy/i })).toBeDisabled();

    fireEvent.change(perTx, { target: { value: "10" } });
    expect(screen.getByRole("button", { name: /save policy/i })).toBeEnabled();
  });

  it("explains that the period restarts now", () => {
    policyModal();
    expect(screen.getByText(/period restarts now/i)).toBeInTheDocument();
  });
});

describe("SignerModal", () => {
  it("validates the key and asks for a second confirmation", () => {
    render(<SignerModal open address={CARD} info={cardInfo} onClose={() => {}} onDone={() => {}} />);
    const input = screen.getByLabelText(/agent public key/i);

    fireEvent.change(input, { target: { value: "not-a-key" } });
    expect(screen.getByText(/not a Stellar public key/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeDisabled();

    fireEvent.change(input, { target: { value: OTHER } });
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));

    expect(screen.getByText(/stops working immediately/i)).toBeInTheDocument();
    expect(runCalls).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /rotate the signer/i }));
    expect(runCalls).toHaveLength(1);
  });
});

describe("AddCardModal", () => {
  function addModal(onAdded = vi.fn()) {
    render(<AddCardModal open owner={OWNER} onClose={() => {}} onAdded={onAdded} />);
    return onAdded;
  }

  it("verifies, stores and selects a card owned by this wallet", async () => {
    verifyOwnedCard.mockResolvedValue(info());
    const onAdded = addModal();
    fireEvent.change(screen.getByLabelText(/card address/i), { target: { value: CARD } });
    fireEvent.click(screen.getByRole("button", { name: /add card/i }));

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(CARD));
    expect(addCard).toHaveBeenCalledWith(OWNER, CARD);
  });

  it("shows the wrong-owner error inline", async () => {
    verifyOwnedCard.mockRejectedValue(new Error("This card belongs to another owner"));
    addModal();
    fireEvent.change(screen.getByLabelText(/card address/i), { target: { value: CARD } });
    fireEvent.click(screen.getByRole("button", { name: /add card/i }));

    expect(await screen.findByText(/belongs to another owner/i)).toBeInTheDocument();
    expect(addCard).not.toHaveBeenCalled();
  });

  it("wraps a non-Mooring contract failure", async () => {
    verifyOwnedCard.mockRejectedValue(new Error("HostError: Error(WasmVm, InvalidAction)"));
    addModal();
    fireEvent.change(screen.getByLabelText(/card address/i), { target: { value: CARD } });
    fireEvent.click(screen.getByRole("button", { name: /add card/i }));

    expect(await screen.findByText(/not a Mooring card/i)).toBeInTheDocument();
  });

  it("rejects an address that is not a contract address", async () => {
    verifyOwnedCard.mockRejectedValue(new Error(`"${OWNER}" is not a valid Stellar contract address`));
    addModal();
    fireEvent.change(screen.getByLabelText(/card address/i), { target: { value: OWNER } });
    fireEvent.click(screen.getByRole("button", { name: /add card/i }));

    expect(await screen.findByText(/starts with C/i)).toBeInTheDocument();
  });
});
