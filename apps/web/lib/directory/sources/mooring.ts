/**
 * Mooring's own hosted example seller (`api.mooring.live`): its `GET /`
 * document lists each paid resource with the protocol it speaks, so the
 * directory always offers one x402 and one MPP service a card can pay.
 */
import type { DirectoryEntry, DirectoryProtocol } from "../types";
import { arr, baseUnits, entryId, fetchJson, hostOf, network, obj, str, type SourceFetchDeps } from "./common";

export const MOORING_SELLER_URL = process.env.MOORING_SELLER_URL ?? "https://api.mooring.live";

const PROTOCOL_LABEL: Record<DirectoryProtocol, string> = { x402: "x402", mpp: "MPP" };

function protocolOf(v: unknown): DirectoryProtocol | undefined {
  return v === "x402" || v === "mpp" ? v : undefined;
}

/** Maps the seller's `/` document (`{ name, network, payTo, resources[] }`) to one entry per resource. */
export function normalizeMooringSeller(json: unknown, base: string): DirectoryEntry[] {
  const doc = obj(json);
  const net = network(doc?.network);
  const payTo = str(doc?.payTo, 64);
  const sellerName = str(doc?.name, 48) ?? "Mooring example seller";
  if (!net || !payTo) return [];
  const root = base.replace(/\/+$/, "");
  const out: DirectoryEntry[] = [];
  for (const r of arr(doc?.resources).map(obj)) {
    const protocol = protocolOf(r?.protocol);
    const path = str(r?.path, 256);
    const amount = baseUnits(r?.amount);
    const asset = str(r?.asset, 64);
    if (!r || !protocol || !path || !path.startsWith("/") || !amount || !asset) continue;
    const url = `${root}${path}`;
    const host = hostOf(url);
    if (!host) continue;
    const e: DirectoryEntry = {
      id: "",
      source: "mooring",
      url,
      host,
      name: `${sellerName} · ${PROTOCOL_LABEL[protocol]}`,
      payTo,
      network: net,
      asset,
      amount,
      scheme: "exact",
      kind: "http",
      protocol,
      method: "GET",
      tags: ["example", protocol],
      proxy: false,
      verified: true,
    };
    e.id = entryId("mooring", e);
    out.push(e);
  }
  return out;
}

export async function fetchMooringSeller(deps: SourceFetchDeps): Promise<DirectoryEntry[]> {
  return normalizeMooringSeller(await fetchJson(`${MOORING_SELLER_URL}/`, deps), MOORING_SELLER_URL);
}
