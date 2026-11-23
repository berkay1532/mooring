/** Helpers shared by the source adapters: bounded JSON fetches and field coercion. */
import type { DirectoryEntry, DirectoryNetwork, DirectorySource } from "../types";
import { isDirectoryNetwork } from "../types";

export interface SourceFetchDeps {
  fetch: typeof globalThis.fetch;
  /** Per request; default 10 s. */
  timeoutMs?: number;
  /** Per response body; default 4 MB. */
  maxBytes?: number;
  userAgent?: string;
}

const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

/** GET `url` as JSON with a deadline and a body cap; throws a plain Error on any failure. */
export async function fetchJson(url: string, deps: SourceFetchDeps): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT);
  try {
    const res = await deps.fetch(url, {
      signal: ctl.signal,
      headers: { Accept: "application/json", "User-Agent": deps.userAgent ?? "mooring-directory/0.1.0" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const max = deps.maxBytes ?? DEFAULT_MAX_BYTES;
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > max) throw new Error("response too large");
    const text = await res.text();
    if (text.length > max) throw new Error("response too large");
    return JSON.parse(text) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

export const str = (v: unknown, max = 512): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

export const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

export const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function hostOf(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    return u.host;
  } catch {
    return undefined;
  }
}

export function httpsOnly(url: unknown): string | undefined {
  const s = str(url, 2048);
  return s && s.startsWith("https://") ? s : undefined;
}

/** `"12345"` base units only: digits, no sign, no decimals. */
export function baseUnits(v: unknown): string | undefined {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return String(v);
  return typeof v === "string" && /^\d+$/.test(v) ? v.replace(/^0+(?=\d)/, "") : undefined;
}

/** A decimal USDC amount (`"0.010"`, `"$0.01"`, `"1"`) → base units with 7 decimals. */
export function decimalToBaseUnits(v: unknown): string | undefined {
  const s = str(v, 64)?.replace(/^\$/, "");
  if (!s || !/^\d+(\.\d{1,7})?$/.test(s)) return undefined;
  const [whole, frac = ""] = s.split(".");
  return (BigInt(whole) * 10_000_000n + BigInt(frac.padEnd(7, "0"))).toString();
}

export function tags(v: unknown): string[] {
  return arr(v)
    .map((t) => str(t, 32))
    .filter((t): t is string => !!t)
    .slice(0, 12);
}

export function method(v: unknown): "GET" | "POST" | undefined {
  const m = str(v, 8)?.toUpperCase();
  return m === "GET" || m === "POST" ? m : undefined;
}

export function network(v: unknown): DirectoryNetwork | undefined {
  return isDirectoryNetwork(v) ? v : undefined;
}

export function entryId(source: DirectorySource, e: Pick<DirectoryEntry, "network" | "payTo" | "url">, extra?: string): string {
  return `${source}:${e.network}:${e.payTo}:${e.url}${extra ? `#${extra}` : ""}`;
}

/** Drops the query, fragment and a trailing slash so one resource has one key. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}
