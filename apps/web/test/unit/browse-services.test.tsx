import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowseServices } from "../../components/merchants/BrowseServices";
import type { DirectoryEntry, DirectoryResponse } from "../../lib/directory/types";
import { USDC_BY_NETWORK } from "../../lib/directory/types";

const entry = (over: Partial<DirectoryEntry>): DirectoryEntry => ({
  id: over.url ?? "id",
  source: "rail402",
  url: "https://demo.rail402.dev/weather",
  host: "demo.rail402.dev",
  name: "Rail402 demo",
  payTo: "GBSVTVRQ4AEFRNGH2MIOOWZSAVLZKOKNKI4UAGSMBZSNRP4I3FL3ELYP",
  network: "stellar:testnet",
  asset: USDC_BY_NETWORK["stellar:testnet"],
  amount: "10000",
  scheme: "exact",
  kind: "http",
  protocol: "x402",
  tags: ["weather"],
  proxy: false,
  verified: false,
  ...over,
});

const WEATHER = entry({});
const SKETCH = entry({
  url: "https://try-cli-1.onrender.com/sketch",
  host: "try-cli-1.onrender.com",
  name: "Pet Pen Portraits",
  payTo: "GBCKZHYGFWRS77UVZCOGTST55OL3HHXDSAYZRKPNBQGO5DXHSCBGRL7B",
  amount: "2500000",
  tags: ["pet-portrait", "svg"],
  verified: true,
  settlements: 75,
});
const MCP = entry({ url: "https://demo.rail402.dev/mcp", name: "Rail402 demo · forecast", kind: "mcp", method: "POST" });

const response = (over: Partial<DirectoryResponse> = {}): DirectoryResponse => ({
  network: "stellar:testnet",
  fetchedAt: "2026-11-23T12:00:00Z",
  sources: [{ source: "rail402", ok: true, count: 3 }],
  items: [SKETCH, WEATHER, MCP],
  other: {
    network: "stellar:pubnet",
    count: 448,
    proxyCount: 441,
    items: [entry({ url: "https://apiserver.mpprouter.dev/v1/services/mercury/events", host: "apiserver.mpprouter.dev", name: "Mercury", network: "stellar:pubnet", asset: USDC_BY_NETWORK["stellar:pubnet"] })],
  },
  ...over,
});

function setup(load = vi.fn(async () => response()), over: Partial<Parameters<typeof BrowseServices>[0]> = {}) {
  const onPick = vi.fn();
  render(<BrowseServices load={load} existing={[]} onPick={onPick} {...over} />);
  return { load, onPick };
}

afterEach(() => cleanup());

describe("BrowseServices", () => {
  it("marks MPP services with an MPP pill", async () => {
    const MPP = entry({ url: "https://api.mooring.live/quote/mpp", host: "api.mooring.live", name: "Mooring example seller · MPP", protocol: "mpp", source: "mooring" });
    setup(vi.fn(async () => response({ items: [MPP, WEATHER] })));
    const list = await screen.findByRole("list", { name: "Services" });
    const rows = within(list).getAllByRole("listitem");
    expect(within(rows[0]).getByText("MPP")).toBeInTheDocument();
    expect(within(rows[1]).queryByText("MPP")).toBeNull();
  });

  it("lists the network's services with price, badges and an Add button per row", async () => {
    setup();
    expect(screen.getByText("Loading the directory…")).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Services" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Pet Pen Portraits");
    expect(rows[0]).toHaveTextContent("0.25 USDC / request");
    expect(rows[0]).toHaveTextContent("verified by source");
    expect(rows[0]).toHaveTextContent("75 payments");
    expect(rows[2]).toHaveTextContent("MCP");
    expect(within(list).getAllByRole("button", { name: /^Add / })).toHaveLength(3);
    expect(screen.getByText("Listed, not vetted. Examples, not recommendations.")).toBeInTheDocument();
  });

  it("Add hands the entry to onPick; an already-allowed payee shows Allowed instead", async () => {
    const { onPick } = setup(undefined, { existing: [WEATHER.payTo] });
    const list = await screen.findByRole("list", { name: "Services" });
    fireEvent.click(within(list).getByRole("button", { name: "Add Pet Pen Portraits" }));
    expect(onPick).toHaveBeenCalledWith(SKETCH);
    expect(within(list).queryByRole("button", { name: "Add Rail402 demo" })).toBeNull();
    expect(within(list).getAllByText("Allowed")).toHaveLength(2); // weather + the mcp row share the payee
  });

  it("filters by name, host or tag", async () => {
    setup();
    const search = await screen.findByLabelText("Search services");
    fireEvent.change(search, { target: { value: "svg" } });
    expect(within(screen.getByRole("list", { name: "Services" })).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("Nothing matches “zzz”.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Services" })).toBeNull();
  });

  it("describes the other network in a collapsed section with the proxy count", async () => {
    setup();
    const summary = await screen.findByText("On Stellar mainnet · 448 services (not payable from this card)");
    const details = summary.closest("details")!;
    expect(details.open).toBe(false);
    expect(within(details).getByRole("list", { name: "Services on Stellar mainnet" })).toHaveTextContent("Mercury");
    expect(within(details).queryByRole("button")).toBeNull();
    expect(details).toHaveTextContent("Plus 441 services behind a router address");
  });

  it("empty directory and failed load both point to the URL field; Retry reloads", async () => {
    const empty = vi.fn(async () => response({ items: [], other: { network: "stellar:pubnet", count: 0, proxyCount: 0, items: [] } }));
    setup(empty);
    expect(await screen.findByText("No Stellar services listed yet. Paste a URL instead.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Search services")).toBeNull();
    cleanup();

    const failing = vi.fn().mockRejectedValueOnce(new Error("503")).mockResolvedValueOnce(response());
    setup(failing);
    expect(await screen.findByText(/The directory is unavailable right now/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByRole("list", { name: "Services" })).toBeInTheDocument());
    expect(failing).toHaveBeenCalledTimes(2);
  });
});
