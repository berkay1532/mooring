/**
 * Normaliser for x402 discovery items (the shape Rail402, StellarSight and the
 * CDP Bazaar all serve): one `DirectoryEntry` per Stellar `accepts[]` entry.
 */
import type { DirectoryEntry, DirectorySource } from "../types";
import { arr, baseUnits, entryId, hostOf, httpsOnly, method, network, num, obj, str, tags } from "./common";

export interface X402Extras {
  verified?: boolean;
  settlements?: number;
  /** For MCP catalogues that list one row per tool. */
  tool?: string;
  method?: "GET" | "POST";
}

function hostPath(url: string): string {
  const u = new URL(url);
  return `${u.host}${u.pathname === "/" ? "" : u.pathname}`.slice(0, 64);
}

export function fromX402Item(source: DirectorySource, raw: unknown, extras: X402Extras = {}): DirectoryEntry[] {
  const item = obj(raw);
  if (!item) return [];
  const url = httpsOnly(item.resource);
  const host = url ? hostOf(url) : undefined;
  if (!url || !host) return [];
  const kind = item.type === "mcp" ? "mcp" : "http";
  const info = obj(obj(obj(item.extensions)?.bazaar)?.info);
  // Without a service name, "host/path" tells rows of the same seller apart.
  const baseName = str(item.serviceName, 64) ?? str(info?.serviceName, 64) ?? hostPath(url);
  const name = extras.tool ? `${baseName} · ${extras.tool}`.slice(0, 64) : baseName;
  const out: DirectoryEntry[] = [];
  for (const a of arr(item.accepts).map(obj)) {
    if (!a) continue;
    const net = network(a.network);
    const payTo = str(a.payTo, 64);
    const asset = str(a.asset, 64);
    const amount = baseUnits(a.amount);
    if (!net || !payTo || !asset || !amount || a.scheme !== "exact") continue;
    const e: DirectoryEntry = {
      id: "",
      source,
      url,
      host,
      name,
      description: str(item.description, 280),
      iconUrl: httpsOnly(item.iconUrl),
      payTo,
      network: net,
      asset,
      amount,
      scheme: "exact",
      kind,
      protocol: "x402",
      method: extras.method ?? method(obj(info?.input)?.method),
      tags: tags(item.tags),
      proxy: false,
      verified: extras.verified ?? false,
      settlements: extras.settlements ?? num(obj(item.quality)?.l30DaysTotalCalls),
      lastSeen: str(item.lastUpdated, 40),
    };
    e.id = entryId(source, e, extras.tool);
    out.push(e);
  }
  return out;
}
