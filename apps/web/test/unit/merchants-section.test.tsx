import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MerchantsSection } from "../../components/cards/MerchantsSection";
import { getMerchantLabels, setMerchantLabel } from "../../lib/prefs";

const OWNER = "GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD";
const CARD = "CAJPWJRJPFIY6XYYQIVCC3XLYFYQVNJIJ6XVPTUY4EBLNQ3CFN2AHCJ";
const PAY_TO = "GBSVQ6PHXQ6DGWCDZ6OOSSGPHNUXQNWRJRFZUOWSYIZ7P6RUV4I2ELYP";
const OTHER = Keypair.random().publicKey();
const URL_ = "https://demo.rail402.dev/weather";

const ops = vi.hoisted(() => ({
  add: { run: vi.fn(), onDone: undefined as undefined | (() => void) },
  remove: { run: vi.fn(), onDone: undefined as undefined | (() => void) },
}));

vi.mock("@/components/cards/busy", () => ({
  opButtonLabel: (_s: unknown, idle: string) => idle,
  useCardOp: (id: string, _build: unknown, opts: { onDone?: () => void }) => {
    const op = id === "merchant-add" ? ops.add : ops.remove;
    op.onDone = opts.onDone;
    return { run: op.run, mine: false, locked: false, state: "idle" };
  },
}));

const resolveMerchantUrl = vi.hoisted(() => vi.fn());
vi.mock("@/lib/merchants/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/merchants/client")>()),
  resolveMerchantUrl,
}));

function ok(payTo = PAY_TO) {
  return {
    ok: true,
    url: URL_,
    payTo,
    network: "stellar:testnet",
    asset: "CASSET",
    amount: "10000",
    scheme: "exact",
    service: { name: "Rail402 demo" },
  };
}

function section(merchants: string[]) {
  return render(<MerchantsSection address={CARD} owner={OWNER} merchants={merchants} />);
}

async function resolveAndAllow() {
  fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
  const input = screen.getByLabelText("Service URL");
  fireEvent.change(input, { target: { value: URL_ } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.click(await screen.findByRole("button", { name: "Allow demo.rail402.dev" }));
}

beforeEach(() => {
  localStorage.clear();
  ops.add.run.mockReset().mockResolvedValue(undefined);
  ops.remove.run.mockReset().mockResolvedValue(undefined);
  resolveMerchantUrl.mockReset().mockResolvedValue(ok());
});
afterEach(cleanup);

describe("MerchantsSection", () => {
  it("allows a resolved service and stores its label once the add confirms", async () => {
    section([]);
    await resolveAndAllow();
    await waitFor(() => expect(ops.add.run).toHaveBeenCalledWith(PAY_TO));
    expect(getMerchantLabels(OWNER, CARD)).toEqual({});

    act(() => ops.add.onDone?.());
    expect(getMerchantLabels(OWNER, CARD)[PAY_TO]).toEqual({ name: "Rail402 demo", url: URL_ });
    expect(screen.queryByLabelText("Service URL")).toBeNull();
  });

  it("shows the name above the shortened address for a labelled merchant", () => {
    setMerchantLabel(OWNER, CARD, PAY_TO, { name: "Rail402 demo", url: URL_ });
    section([PAY_TO, OTHER]);
    const name = screen.getByText("Rail402 demo");
    const short = screen.getByText("GBSV…ELYP");
    expect(short).toHaveAttribute("title", PAY_TO);
    expect(name.compareDocumentPosition(short) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(OTHER)).toBeInTheDocument();
  });

  it("removes a merchant and clears its label", () => {
    setMerchantLabel(OWNER, CARD, PAY_TO, { name: "Rail402 demo", url: URL_ });
    section([PAY_TO]);
    fireEvent.click(screen.getByRole("button", { name: /remove merchant/i }));
    expect(ops.remove.run).toHaveBeenCalledWith(PAY_TO);
    act(() => ops.remove.onDone?.());
    expect(getMerchantLabels(OWNER, CARD)).toEqual({});
    expect(screen.queryByText("Rail402 demo")).toBeNull();
  });

  it("reports an already-allowed service as such", async () => {
    section([PAY_TO]);
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    const input = screen.getByLabelText("Service URL");
    fireEvent.change(input, { target: { value: URL_ } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByRole("button", { name: "Already allowed" })).toBeDisabled();
  });

  it("adds a raw address through the by-address path", () => {
    section([]);
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Add by address instead" }));
    fireEvent.change(screen.getByLabelText("Merchant address"), { target: { value: OTHER } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(ops.add.run).toHaveBeenCalledWith(OTHER);
  });
});
