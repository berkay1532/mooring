/**
 * MPP Router (`apiserver.mpprouter.dev`): a pubnet catalogue where most rows are
 * upstream APIs resold behind the router's own address — those are `proxy`.
 */
import type { DirectoryEntry } from "../types";
import { USDC_BY_NETWORK } from "../types";
import { arr, decimalToBaseUnits, entryId, fetchJson, hostOf, method, obj, str, tags, type SourceFetchDeps } from "./common";

export const MPPROUTER_URL = "https://apiserver.mpprouter.dev/v1/services/catalog";
export const MPPROUTER_PAYTO = "GDK3AVW3YE6UL3J4WLNKBMP65KSY32YPUKIOC6PXW65XJ3LEG3YIDXXB";

export function normalizeMppRouter(json: unknown): DirectoryEntry[] {
  const root = obj(json);
  const base = str(root?.base_url, 256) ?? "https://apiserver.mpprouter.dev";
  const out: DirectoryEntry[] = [];
  for (const s of arr(root?.services).map(obj)) {
    if (!s || s.payment_enabled !== true) continue;
    const hints = obj(s.payment_hints);
    const payTo = str(hints?.pay_to, 64);
    const path = str(s.public_path, 512);
    const amount = decimalToBaseUnits(str(hints?.amount_usdc) ?? str(s.price)?.replace(/\/.*$/, ""));
    if (!payTo || !path || !amount) continue;
    if ((str(hints?.network) ?? "stellar:pubnet") !== "stellar:pubnet") continue;
    const url = `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
    const host = hostOf(url);
    if (!host) continue;
    const e: DirectoryEntry = {
      id: "",
      source: "mpprouter",
      url,
      host,
      name: (str(s.name, 48) ?? host) + (str(s.operation, 40) ? ` · ${str(s.operation, 40)}` : ""),
      description: str(s.description, 280),
      payTo,
      network: "stellar:pubnet",
      asset: str(hints?.asset_sac, 64) ?? USDC_BY_NETWORK["stellar:pubnet"],
      amount,
      scheme: "exact",
      kind: "http",
      protocol: "mpp",
      method: method(s.method),
      tags: tags(s.categories),
      proxy: payTo === MPPROUTER_PAYTO,
      verified: s.charge_rozo_verified === true,
      lastSeen: str(root?.generated_at, 40),
    };
    e.id = entryId("mpprouter", e, str(s.id, 80));
    out.push(e);
  }
  return out;
}

export async function fetchMppRouter(deps: SourceFetchDeps): Promise<DirectoryEntry[]> {
  return normalizeMppRouter(await fetchJson(MPPROUTER_URL, deps));
}
