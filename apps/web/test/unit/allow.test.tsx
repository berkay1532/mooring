import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AllowScreen } from "../../components/merchants/AllowScreen";
import { getAddedCards, getMerchantLabels, getSelected } from "../../lib/prefs";

const OWNER = "GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD";
const OTHER_OWNER = "GBSVQ6PHXQ6DGWCDZ6OOSSGPHNUXQNWRJRFZUOWSYIZ7P6RUV4I2ELYP";
const CARD = "CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR";
const CARD_2 = "CBXHE6IOGUVDJEKAHPJGFXRPYSI7H6UFWQE2AYTE5HOSEOWFEXWJ6ULP";
const PAY_TO = "GBSVQ6PHXQ6DGWCDZ6OOSSGPHNUXQNWRJRFZUOWSYIZ7P6RUV4I2ELYP";
const URL_ = "https://demo.rail402.dev/weather";

const state = vi.hoisted(() => ({
  info: { data: undefined, isLoading: false, error: null } as {
    data?: { owner: string; label: string; state: number };
    isLoading: boolean;
    error: unknown;
  },
  merchants: { data: [] as string[] | undefined, isLoading: false },
  code: { data: true, error: null } as { data?: boolean; error: unknown },
  add: { run: vi.fn(), state: "idle", onDone: undefined as undefined | (() => void) },
}));

const useCardInfo = vi.hoisted(() => vi.fn());
vi.mock("@/lib/query/hooks", () => ({
  useIsMooringCard: () => state.code,
  useCardInfo: (address: string) => {
    useCardInfo(address);
    return state.info;
  },
  useMerchants: () => state.merchants,
}));
const wallet = vi.hoisted(() => ({ address: null as string | null }));
vi.mock("@/lib/wallet/context", () => ({ useWallet: () => wallet }));
vi.mock("@/components/cards/busy", () => ({
  CardBusyProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useCardOp: (_id: string, _build: unknown, opts: { onDone?: () => void }) => {
    state.add.onDone = opts.onDone;
    return { run: state.add.run, mine: false, locked: false, state: state.add.state };
  },
}));
const resolveMerchantUrl = vi.hoisted(() => vi.fn());
vi.mock("@/lib/merchants/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/merchants/client")>()),
  resolveMerchantUrl,
}));

beforeEach(() => {
  localStorage.clear();
  state.add.state = "idle";
  state.code = { data: true, error: null };
  wallet.address = OWNER;
  useCardInfo.mockReset();
  state.merchants = { data: [], isLoading: false };
  state.info = { data: { owner: OWNER, label: "Research", state: 0 }, isLoading: false, error: null };
  state.add.run.mockReset().mockResolvedValue(undefined);
  resolveMerchantUrl.mockReset().mockResolvedValue({
    ok: true,
    url: URL_,
    payTo: PAY_TO,
    network: "stellar:testnet",
    asset: "CASSET",
    amount: "10000",
    scheme: "exact",
    service: { name: "Rail402 demo" },
  });
});
afterEach(cleanup);

/** Clicks the preview's Allow button, then ticks the box and confirms in the modal. */
async function allowViaModal() {
  fireEvent.click(await screen.findByRole("button", { name: "Allow demo.rail402.dev" }));
  const dialog = await screen.findByRole("dialog", { name: "Allow demo.rail402.dev?" });
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Allow and sign" }));
}

describe("AllowScreen", () => {
  it("rejects a missing or invalid card param", () => {
    render(<AllowScreen card={null} url={URL_} />);
    expect(screen.getByText("This link does not name a valid card.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to my cards" }).getAttribute("href")).toBe("/cards");
    cleanup();
    render(<AllowScreen card="nope" url={null} />);
    expect(screen.getByText("This link does not name a valid card.")).toBeTruthy();
  });

  it("refuses a contract that does not run the Mooring card code, before reading info()", () => {
    state.code = { data: false, error: null };
    render(<AllowScreen card={CARD} url={URL_} />);
    expect(screen.getByText("This link does not point to a Mooring card.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to my cards" }).getAttribute("href")).toBe("/cards");
    expect(screen.queryByText(/belongs to/)).toBeNull();
    expect(screen.queryByText("Research")).toBeNull();
    expect(useCardInfo).not.toHaveBeenCalled();
    expect(resolveMerchantUrl).not.toHaveBeenCalled();
  });

  it("shows a loading line while the card code is checked, and an error line if it cannot be", () => {
    state.code = { data: undefined, error: null };
    render(<AllowScreen card={CARD} url={URL_} />);
    expect(screen.getByText("Loading card…")).toBeTruthy();
    expect(useCardInfo).not.toHaveBeenCalled();
    cleanup();
    state.code = { data: undefined, error: new Error("rpc down") };
    render(<AllowScreen card={CARD} url={URL_} />);
    expect(screen.getByText("Could not read this card.")).toBeTruthy();
    expect(resolveMerchantUrl).not.toHaveBeenCalled();
  });

  it("shows a loading line and an error line", () => {
    state.info = { data: undefined, isLoading: true, error: null };
    render(<AllowScreen card={CARD} url={null} />);
    expect(screen.getByText("Loading card…")).toBeTruthy();
    cleanup();
    state.info = { data: undefined, isLoading: false, error: new Error("x") };
    render(<AllowScreen card={CARD} url={null} />);
    expect(screen.getByText("Could not read this card.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to my cards" }).getAttribute("href")).toBe("/cards");
  });

  it("refuses a card owned by another wallet", () => {
    state.info = { data: { owner: OTHER_OWNER, label: "X", state: 0 }, isLoading: false, error: null };
    render(<AllowScreen card={CARD} url={URL_} />);
    expect(screen.getByText(/This card belongs to GBSV/)).toBeTruthy();
    expect(screen.getByText(/Connect that wallet to manage it\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to my cards" }).getAttribute("href")).toBe("/cards");
    expect(resolveMerchantUrl).not.toHaveBeenCalled();
  });

  it("refuses when no wallet is connected", () => {
    wallet.address = null;
    render(<AllowScreen card={CARD} url={URL_} />);
    expect(screen.getByText(/This card belongs to GCJJ/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Allow / })).toBeNull();
    expect(resolveMerchantUrl).not.toHaveBeenCalled();
  });

  it("rejects a padded or lowercased card param", () => {
    for (const card of [` ${CARD}`, `${CARD} `, CARD.toLowerCase()]) {
      render(<AllowScreen card={card} url={URL_} />);
      expect(screen.getByText("This link does not name a valid card.")).toBeTruthy();
      cleanup();
    }
    expect(resolveMerchantUrl).not.toHaveBeenCalled();
  });

  it("disables the resolver for a cancelled card", async () => {
    state.info = { data: { owner: OWNER, label: "Research", state: 2 }, isLoading: false, error: null };
    render(<AllowScreen card={CARD} url={URL_} />);
    const button = await screen.findByRole("button", { name: "Allow demo.rail402.dev" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Look up" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows Already allowed for a merchant already on the card", async () => {
    state.merchants = { data: [PAY_TO], isLoading: false };
    render(<AllowScreen card={CARD} url={URL_} />);
    const button = await screen.findByRole("button", { name: "Already allowed" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Allow demo.rail402.dev" })).toBeNull();
  });

  it("starts fresh when the link changes to another card", async () => {
    const view = render(<AllowScreen card={CARD} url={URL_} />);
    await allowViaModal();
    await waitFor(() => expect(state.add.run).toHaveBeenCalled());
    act(() => state.add.onDone?.());
    expect(screen.getByText("Merchant allowed.")).toBeTruthy();

    view.rerender(<AllowScreen card={CARD_2} url={URL_} />);
    expect(screen.queryByText("Merchant allowed.")).toBeNull();
    expect(await screen.findByRole("button", { name: "Allow demo.rail402.dev" })).toBeTruthy();
  });

  it("resolves the linked URL on mount and offers to allow it", async () => {
    render(<AllowScreen card={CARD} url={URL_} />);
    expect(screen.getByText("Research")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Allow demo.rail402.dev" })).toBeTruthy();
    expect(resolveMerchantUrl).toHaveBeenCalledWith(URL_);
    expect(screen.getByText(/came from a link/)).toBeTruthy();
  });

  it("allows the merchant, stores the label and offers the card", async () => {
    render(<AllowScreen card={CARD} url={URL_} />);
    await allowViaModal();
    await waitFor(() => expect(state.add.run).toHaveBeenCalledWith(PAY_TO));
    expect(screen.queryByText("Merchant allowed.")).toBeNull();

    act(() => state.add.onDone?.());
    expect(getMerchantLabels(OWNER, CARD)[PAY_TO]).toEqual({ name: "Rail402 demo", url: URL_ });
    expect(getAddedCards(OWNER)).toContain(CARD);
    expect(getSelected(OWNER)).toBe(CARD);
    expect(screen.getByText("Merchant allowed.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open card" }).getAttribute("href")).toBe("/cards");
  });

  it("keeps Allow disabled until the allowlist has loaded", async () => {
    state.merchants = { data: undefined, isLoading: true };
    render(<AllowScreen card={CARD} url={URL_} />);
    const button = await screen.findByRole("button", { name: "Allow demo.rail402.dev" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("drops the pending label when the add ends in the failed state", async () => {
    const view = render(<AllowScreen card={CARD} url={URL_} />);
    await allowViaModal();
    await waitFor(() => expect(state.add.run).toHaveBeenCalled());
    state.add.state = "failed";
    view.rerender(<AllowScreen card={CARD} url={URL_} />);
    act(() => state.add.onDone?.());
    expect(getMerchantLabels(OWNER, CARD)).toEqual({});
  });
});
