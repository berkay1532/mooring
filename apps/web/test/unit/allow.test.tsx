import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AllowScreen } from "../../components/merchants/AllowScreen";
import { getAddedCards, getMerchantLabels, getSelected } from "../../lib/prefs";

const OWNER = "GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD";
const OTHER_OWNER = "GBSVQ6PHXQ6DGWCDZ6OOSSGPHNUXQNWRJRFZUOWSYIZ7P6RUV4I2ELYP";
const CARD = "CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR";
const PAY_TO = "GBSVQ6PHXQ6DGWCDZ6OOSSGPHNUXQNWRJRFZUOWSYIZ7P6RUV4I2ELYP";
const URL_ = "https://demo.rail402.dev/weather";

const state = vi.hoisted(() => ({
  info: { data: undefined, isLoading: false, error: null } as {
    data?: { owner: string; label: string; state: number };
    isLoading: boolean;
    error: unknown;
  },
  merchants: { data: [] as string[] | undefined, isLoading: false },
  add: { run: vi.fn(), onDone: undefined as undefined | (() => void) },
}));

vi.mock("@/lib/query/hooks", () => ({
  useCardInfo: () => state.info,
  useMerchants: () => state.merchants,
}));
vi.mock("@/lib/wallet/context", () => ({ useWallet: () => ({ address: OWNER }) }));
vi.mock("@/components/cards/busy", () => ({
  CardBusyProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useCardOp: (_id: string, _build: unknown, opts: { onDone?: () => void }) => {
    state.add.onDone = opts.onDone;
    return { run: state.add.run, mine: false, locked: false, state: "idle" };
  },
}));
const resolveMerchantUrl = vi.hoisted(() => vi.fn());
vi.mock("@/lib/merchants/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/merchants/client")>()),
  resolveMerchantUrl,
}));

beforeEach(() => {
  localStorage.clear();
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

describe("AllowScreen", () => {
  it("rejects a missing or invalid card param", () => {
    render(<AllowScreen card={null} url={URL_} />);
    expect(screen.getByText("This link does not name a valid card.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to my cards" }).getAttribute("href")).toBe("/cards");
    cleanup();
    render(<AllowScreen card="nope" url={null} />);
    expect(screen.getByText("This link does not name a valid card.")).toBeTruthy();
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
    expect(resolveMerchantUrl).not.toHaveBeenCalled();
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
    fireEvent.click(await screen.findByRole("button", { name: "Allow demo.rail402.dev" }));
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

  it("drops the pending label when the add fails", async () => {
    state.add.run.mockRejectedValue(new Error("rejected"));
    render(<AllowScreen card={CARD} url={URL_} />);
    fireEvent.click(await screen.findByRole("button", { name: "Allow demo.rail402.dev" }));
    await waitFor(() => expect(state.add.run).toHaveBeenCalled());
    act(() => state.add.onDone?.());
    expect(getMerchantLabels(OWNER, CARD)).toEqual({});
  });
});
