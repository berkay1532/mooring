/**
 * Pure normalisation and selection of `402` payment terms. No React, no
 * network: the server-side merchant resolver feeds it the `PAYMENT-REQUIRED`
 * header (x402 v2, base64 JSON) and/or the response body (x402 v1, JSON), or
 * the `WWW-Authenticate` header (MPP charge), and gets back the entries a card
 * could pay.
 */
import { chargeChallengesFromHeader } from "@mooring-live/x402-client";
import { decodePaymentRequiredHeader } from "@x402/core/http";

import { isPayableScheme } from "./describe";

/** One payable option from a 402 response, reduced to what a card needs. */
export interface MerchantTerms {
  /** x402 scheme (`exact`, …), or `mpp` for an MPP Stellar charge challenge. */
  scheme: string;
  network: string;
  asset: string;
  payTo: string;
  /** Base units, digits only. */
  amount: string;
}

/** Optional display metadata advertised by the service. */
export interface ServiceMeta {
  name?: string;
  description?: string;
  iconUrl?: string;
}

/** Normalised 402 terms. */
export interface ParsedTerms {
  accepts: MerchantTerms[];
  service: ServiceMeta;
  feesSponsored?: boolean;
}

/** Outcome of picking the entry a card can pay. */
export type Selection =
  | { kind: "one"; terms: MerchantTerms }
  | { kind: "none" }
  | { kind: "many"; found: MerchantTerms[] };

const MAX_NAME = 64;
const MAX_DESCRIPTION = 280;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasAccepts(v: unknown): v is Obj & { accepts: unknown[] } {
  return isObj(v) && Array.isArray(v.accepts);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

function amountOf(e: Obj): string | undefined {
  const raw = e.amount !== undefined ? e.amount : e.maxAmountRequired;
  if (typeof raw === "string" && /^[0-9]+$/.test(raw)) return raw;
  if (typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0) return String(raw);
  return undefined;
}

function normaliseEntry(raw: unknown): MerchantTerms | null {
  if (!isObj(raw)) return null;
  const scheme = str(raw.scheme);
  const network = str(raw.network);
  const asset = str(raw.asset);
  const payTo = str(raw.payTo);
  const amount = amountOf(raw);
  if (!scheme || !network || !asset || !payTo || !amount) return null;
  return { scheme, network, asset, payTo, amount };
}

function clean(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const out = v.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, max).trim();
  return out === "" ? undefined : out;
}

function firstString(...vals: unknown[]): unknown {
  return vals.find((v) => typeof v === "string" && v !== "");
}

function serviceOf(doc: Obj): ServiceMeta {
  const resource = isObj(doc.resource) ? doc.resource : {};
  const bazaar =
    isObj(doc.extensions) && isObj(doc.extensions.bazaar) && isObj(doc.extensions.bazaar.info)
      ? doc.extensions.bazaar.info
      : {};
  const name = clean(firstString(resource.serviceName, bazaar.serviceName, doc.serviceName), MAX_NAME);
  const description = clean(firstString(resource.description, doc.description), MAX_DESCRIPTION);
  const icon = firstString(resource.iconUrl, doc.iconUrl);
  const service: ServiceMeta = {};
  if (name) service.name = name;
  if (description) service.description = description;
  if (typeof icon === "string" && icon.startsWith("https://")) service.iconUrl = icon;
  return service;
}

/**
 * Parse a 402 response. The v2 `PAYMENT-REQUIRED` header wins when it decodes
 * to a document with an `accepts` array; otherwise the v1 JSON body is tried.
 * Entries missing a field or with a non-integer amount are dropped. Returns
 * `null` when neither source yields a document.
 */
export function parsePaymentRequired(header: string | null, body: string | null): ParsedTerms | null {
  let doc: Obj | null = null;
  if (typeof header === "string" && header !== "") {
    try {
      const d: unknown = decodePaymentRequiredHeader(header);
      if (hasAccepts(d)) doc = d;
    } catch {
      // fall through to the body
    }
  }
  if (!doc && typeof body === "string" && body !== "") {
    try {
      const d: unknown = JSON.parse(body);
      if (hasAccepts(d)) doc = d;
    } catch {
      // not JSON
    }
  }
  if (!doc) return null;

  const accepts = (doc.accepts as unknown[])
    .map(normaliseEntry)
    .filter((e): e is MerchantTerms => e !== null);
  const first = (doc.accepts as unknown[])[0];
  const sponsored = isObj(first) && isObj(first.extra) && first.extra.areFeesSponsored === true;

  const parsed: ParsedTerms = { accepts, service: serviceOf(doc) };
  if (sponsored) parsed.feesSponsored = true;
  return parsed;
}

/**
 * Parse a `WWW-Authenticate` value for MPP Stellar charge challenges, as
 * `scheme: "mpp"` terms. Challenges without a network are dropped (the card
 * could not tell which chain to pay on). Returns `null` when the value holds
 * no usable challenge; never throws.
 */
export function parseMppChallenge(header: string | null): ParsedTerms | null {
  try {
    const challenges = chargeChallengesFromHeader(header);
    const accepts: MerchantTerms[] = [];
    let description: string | undefined;
    for (const c of challenges) {
      const r = c.request;
      const network = str(r.methodDetails?.network);
      const asset = str(r.currency);
      const payTo = str(r.recipient);
      const amount = typeof r.amount === "string" && /^[0-9]+$/.test(r.amount) ? r.amount : undefined;
      if (!network || !asset || !payTo || !amount) continue;
      accepts.push({ scheme: "mpp", network, asset, payTo, amount });
      description ??= clean(firstString(c.description, r.description), MAX_DESCRIPTION);
    }
    if (accepts.length === 0) return null;
    return { accepts, service: description ? { description } : {} };
  } catch {
    return null;
  }
}

/**
 * Pick the payable entry (`exact`, or an MPP charge) for the card's network and asset. Several matches
 * paying the same address count as one (the first is returned); matches paying
 * different addresses are ambiguous and returned as `many`.
 */
export function selectTerms(parsed: ParsedTerms, network: string, asset: string): Selection {
  const found = parsed.accepts.filter(
    (t) => isPayableScheme(t.scheme) && t.network === network && t.asset === asset,
  );
  if (found.length === 0) return { kind: "none" };
  if (new Set(found.map((t) => t.payTo)).size === 1) return { kind: "one", terms: found[0] };
  return { kind: "many", found };
}
