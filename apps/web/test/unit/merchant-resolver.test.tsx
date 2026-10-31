import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MerchantResolver } from "../../components/merchants/MerchantResolver";
import type { MerchantResolverProps } from "../../components/merchants/MerchantResolver";
import { networkLabel, resolveMerchantUrl } from "../../lib/merchants/client";
import type { ResolveResult } from "../../lib/merchants/resolve";
import * as seed from "../../lib/merchants/seed";

const PAY_TO = Keypair.random().publicKey();
const URL_ = "https://demo.rail402.dev/weather";
const NOTICE =
  "Mooring only checked that this service accepts payments from this card's network and token. It does not vouch for the service. Allowing it lets your agent pay it up to the card's limits — whether to trust it is your decision.";

const ok = (over: Record<string, unknown> = {}): ResolveResult =>
  ({
    ok: true,
    url: URL_,
    payTo: PAY_TO,
    network: "stellar:testnet",
    asset: "CASSET",
    amount: "10000",
    scheme: "exact",
    service: { name: "Rail402 demo" },
    ...over,
  }) as ResolveResult;

function setup(over: Partial<MerchantResolverProps> = {}) {
  const resolve = vi.fn().mockResolvedValue(ok());
  const onConfirm = vi.fn();
  const utils = render(
    <MerchantResolver
      existing={[]}
      onConfirm={onConfirm}
      confirmLabel={(h) => `Allow ${h}`}
      resolve={resolve}
      {...over}
    />,
  );
  return { resolve, onConfirm, ...utils };
}

async function lookUp(url = URL_) {
  const input = screen.getByLabelText("Service URL");
  fireEvent.change(input, { target: { value: url } });
  fireEvent.keyDown(input, { key: "Enter" });
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("MerchantResolver", () => {
  it("resolves on Enter and shows the preview, notice and confirm button", async () => {
    const { resolve, onConfirm } = setup();
    await lookUp();
    const group = await screen.findByRole("group", { name: "Service Rail402 demo" });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(group).toHaveTextContent("0.001 USDC / request");
    expect(group).toHaveTextContent("Stellar testnet");
    expect(group).toHaveTextContent(`${PAY_TO.slice(0, 4)}…${PAY_TO.slice(-4)}`);
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Allow demo.rail402.dev" }));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ payTo: PAY_TO, host: "demo.rail402.dev", name: "Rail402 demo", amount: "10000" }),
    );
  });

  it("shows Already allowed, disabled, when payTo is in existing", async () => {
    const { onConfirm } = setup({ existing: [PAY_TO] });
    await lookUp();
    const btn = await screen.findByRole("button", { name: "Already allowed" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("keeps a failure and its found list until the input changes", async () => {
    const resolve = vi.fn().mockResolvedValue({
      ok: false,
      code: "no_match",
      message: "No payment option matches this card.",
      found: [{ network: "stellar:pubnet", asset: "CX", payTo: PAY_TO, amount: "1" }],
    });
    setup({ resolve });
    await lookUp();
    expect(await screen.findByText("No payment option matches this card.")).toBeInTheDocument();
    expect(
      screen.getByText(`This service accepts: Stellar mainnet · token CX → ${PAY_TO.slice(0, 4)}…${PAY_TO.slice(-4)}`),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Allow / })).toBeNull();
    expect(screen.getByLabelText("Service URL")).toHaveFocus();
    expect(screen.getByLabelText("Service URL")).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(screen.getByLabelText("Service URL"), { target: { value: `${URL_}x` } });
    expect(screen.queryByText("No payment option matches this card.")).toBeNull();
    expect(screen.queryByText(/This service accepts:/)).toBeNull();
  });

  it("names each offered entry's token: USDC only when it is the card's own", async () => {
    const { config } = await import("../../lib/config");
    const other = "CBXHE6IOGUVDJEKAHPJGFXRPYSI7H6UFWQE2AYTE5HOSEOWFEXWJ6ULP";
    const resolve = vi.fn().mockResolvedValue({
      ok: false,
      code: "no_match",
      message: "This service asks for a different token or scheme on Stellar testnet; this card holds USDC.",
      found: [
        { network: "stellar:testnet", asset: other, payTo: PAY_TO, amount: "1", scheme: "exact" },
        { network: "stellar:testnet", asset: config.usdc, payTo: PAY_TO, amount: "1", scheme: "upto" },
      ],
    });
    setup({ resolve });
    await lookUp();
    const short = `${PAY_TO.slice(0, 4)}…${PAY_TO.slice(-4)}`;
    expect(await screen.findByText(`This service accepts: Stellar testnet · token CBXH…6ULP → ${short}`)).toBeInTheDocument();
    expect(screen.getByText(`This service accepts: Stellar testnet · USDC → ${short}`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Allow / })).toBeNull();
  });

  it("adds the link-origin sentence only when linkOrigin", async () => {
    const { unmount } = setup({ linkOrigin: true });
    await lookUp();
    await screen.findByRole("group");
    expect(
      screen.getByText("This request came from a link. Make sure it is a service your agent is meant to use."),
    ).toBeInTheDocument();
    unmount();
    setup();
    await lookUp();
    await screen.findByRole("group");
    expect(screen.queryByText(/came from a link/)).toBeNull();
  });

  it("renders a hostile service name as truncated text", async () => {
    const name = "<img src=x onerror=alert(1)>".padEnd(100, "A");
    const { container } = setup({ resolve: vi.fn().mockResolvedValue(ok({ service: { name } })) });
    await lookUp();
    await screen.findByRole("group");
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("group")).toHaveAccessibleName(`Service ${name.slice(0, 64)}`);
    expect(screen.getByText(name.slice(0, 64))).toBeInTheDocument();
  });

  it("falls back to the host when the service has no name", async () => {
    setup({ resolve: vi.fn().mockResolvedValue(ok({ service: undefined })) });
    await lookUp();
    expect(await screen.findByRole("group", { name: "Service demo.rail402.dev" })).toBeInTheDocument();
  });

  it("shows seed services in idle state and a click starts the lookup", async () => {
    const { resolve } = setup();
    expect(screen.getByText("Examples, not recommendations.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rail402 demo" }));
    await screen.findByRole("group");
    expect(resolve).toHaveBeenCalledWith(URL_);
    expect(screen.queryByText("Examples, not recommendations.")).toBeNull();
  });

  it("hides the seed row when there are no seed services", () => {
    vi.spyOn(seed, "seedServices").mockReturnValue([]);
    setup();
    expect(screen.queryByText("Examples, not recommendations.")).toBeNull();
  });

  it("auto-resolves once on mount", async () => {
    const { resolve } = setup({ initialUrl: URL_, autoResolve: true });
    await screen.findByRole("group");
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("disables the primary button while confirming or disabled", async () => {
    setup({ confirming: true });
    await lookUp();
    expect(await screen.findByRole("button", { name: "Allow demo.rail402.dev" })).toBeDisabled();
  });

  it("calls onConfirm once on a rapid double click", async () => {
    let release: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((r) => (release = r)));
    setup({ onConfirm });
    await lookUp();
    const btn = await screen.findByRole("button", { name: "Allow demo.rail402.dev" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    release();
  });

  it("resets and re-resolves when initialUrl changes", async () => {
    const resolve = vi.fn().mockResolvedValue(ok());
    const props = { existing: [], onConfirm: vi.fn(), confirmLabel: (h: string) => `Allow ${h}`, resolve, autoResolve: true };
    const { rerender } = render(<MerchantResolver {...props} initialUrl={URL_} />);
    await screen.findByRole("group");
    rerender(<MerchantResolver {...props} initialUrl="https://other.example/x" />);
    await waitFor(() => expect(resolve).toHaveBeenCalledWith("https://other.example/x"));
    expect(screen.getByLabelText("Service URL")).toHaveValue("https://other.example/x");
  });

  it("announces failures in a polite status region", async () => {
    setup({
      resolve: vi.fn().mockResolvedValue({
        ok: false,
        code: "no_match",
        message: "Nope.",
        found: [{ network: "stellar:pubnet", asset: "CX", payTo: PAY_TO, amount: "1" }],
      }),
    });
    await lookUp();
    const msg = await screen.findByText("Nope.");
    const region = msg.closest('[role="status"]');
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("This service accepts:");
  });

  it("disables the field and Look up when disabled", () => {
    setup({ disabled: true, initialUrl: URL_ });
    expect(screen.getByLabelText("Service URL")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Look up" })).toBeDisabled();
  });

  it("labels the copy button", async () => {
    setup();
    await lookUp();
    expect(await screen.findByRole("button", { name: "Copy address" })).toBeInTheDocument();
  });

  it("adds by address through the disclosure", async () => {
    const onAddByAddress = vi.fn();
    setup({ onAddByAddress, existing: [] });
    expect(screen.queryByLabelText("Merchant address")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add by address instead" }));
    const input = screen.getByLabelText("Merchant address");
    const add = screen.getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();
    fireEvent.change(input, { target: { value: PAY_TO } });
    fireEvent.click(add);
    expect(onAddByAddress).toHaveBeenCalledWith(PAY_TO);
  });

  it("omits the disclosure without onAddByAddress", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Add by address instead" })).toBeNull();
  });
});

describe("networkLabel", () => {
  it("maps known networks and passes others through", () => {
    expect(networkLabel("stellar:testnet")).toBe("Stellar testnet");
    expect(networkLabel("stellar:pubnet")).toBe("Stellar mainnet");
    expect(networkLabel("eip155:1")).toBe("eip155:1");
  });
});

describe("resolveMerchantUrl", () => {
  it("POSTs the url and returns the JSON body", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify(ok()), { status: 200 }));
    const r = await resolveMerchantUrl(URL_, f as unknown as typeof fetch);
    expect(r.ok).toBe(true);
    const [path, init] = f.mock.calls[0];
    expect(path).toBe("/api/resolve-merchant");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ url: URL_ });
  });

  it("passes through a non-2xx JSON body", async () => {
    const body = { ok: false, code: "unreachable", message: "Slow down." };
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 429 }));
    expect(await resolveMerchantUrl(URL_, f as unknown as typeof fetch)).toEqual(body);
  });

  it("maps a thrown fetch or non-JSON to unreachable", async () => {
    const expected = { ok: false, code: "unreachable", message: "Could not reach the lookup service." };
    const boom = vi.fn().mockRejectedValue(new Error("down"));
    expect(await resolveMerchantUrl(URL_, boom as unknown as typeof fetch)).toEqual(expected);
    const html = vi.fn().mockResolvedValue(new Response("<html>", { status: 502 }));
    expect(await resolveMerchantUrl(URL_, html as unknown as typeof fetch)).toEqual(expected);
  });
});
