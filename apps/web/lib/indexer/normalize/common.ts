import { Address, scValToNative, xdr } from "@stellar/stellar-sdk";

import { stateName, type IndexedKind, type Payload } from "../types";

/** Base64 ScVal → a JSON-safe native value (bigint → decimal string, bytes → hex). */
export function decodeScVal(base64: string): unknown {
  return jsonSafe(scValToNative(xdr.ScVal.fromXDR(base64, "base64")));
}

export function jsonSafe(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) return Buffer.from(v).toString("hex");
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = jsonSafe(val);
    return out;
  }
  return v;
}

/** Base64 ScVal of an address → strkey, or null when it is not an address. */
export function decodeAddress(base64: string): string | null {
  try {
    const sc = xdr.ScVal.fromXDR(base64, "base64");
    if (sc.type !== "scvAddress") return null;
    return Address.fromScVal(sc).toString();
  } catch {
    return null;
  }
}

export function decodeSymbol(base64: string): string | null {
  try {
    const sc = xdr.ScVal.fromXDR(base64, "base64");
    return sc.type === "scvSymbol" ? sc.sym.toString() : null;
  } catch {
    return null;
  }
}

const KINDS = new Set<IndexedKind>([
  "merchant_added",
  "merchant_removed",
  "policy_changed",
  "signer_changed",
  "label_changed",
  "state_changed",
  "withdrawn",
  "transfer",
]);

function str(v: unknown): string | null {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Turns decoded topics + data into `{ kind, payload }`, or null for anything that
 * is not one of ours. `topics[0]` is the event symbol; the contract-event macro puts
 * `#[topic]` fields in the topics and the rest in a map in `data`.
 */
export function classify(
  topics: string[],
  rawTopics: string[],
  data: unknown,
): { kind: IndexedKind; payload: Payload } | null {
  const name = topics[0];
  if (name === "card_created") {
    const owner = decodeAddress(rawTopics[1] ?? "");
    const card = str(rec(data).card);
    if (!owner || !card) return null;
    return { kind: "created", payload: { owner, card } };
  }
  if (!name || !KINDS.has(name as IndexedKind)) return null;
  const d = rec(data);
  switch (name as IndexedKind) {
    case "merchant_added":
    case "merchant_removed": {
      const merchant = decodeAddress(rawTopics[1] ?? "");
      return merchant ? { kind: name as IndexedKind, payload: { merchant } } : null;
    }
    case "policy_changed": {
      const p = rec(d.policy);
      const expiry = str(p.expiry);
      const maxPerTx = str(p.max_per_tx);
      const periodAmount = str(p.period_amount);
      const periodDuration = str(p.period_duration);
      if (!expiry || !maxPerTx || !periodAmount || !periodDuration) return null;
      return {
        kind: "policy_changed",
        payload: { expiry, max_per_tx: maxPerTx, period_amount: periodAmount, period_duration: periodDuration },
      };
    }
    case "signer_changed": {
      const signer = str(d.signer);
      return signer ? { kind: "signer_changed", payload: { signer } } : null;
    }
    case "label_changed": {
      const label = str(d.label);
      return label !== null ? { kind: "label_changed", payload: { label } } : null;
    }
    case "state_changed": {
      const state = typeof d.state === "number" ? d.state : Number(str(d.state));
      if (!Number.isInteger(state)) return null;
      return { kind: "state_changed", payload: { state, stateName: stateName(state) } };
    }
    case "withdrawn": {
      const to = str(d.to);
      const amount = str(d.amount);
      return to && amount ? { kind: "withdrawn", payload: { to, amount } } : null;
    }
    case "transfer": {
      // SAC transfer: topics ["transfer", from, to, asset]; data is the i128 amount, or
      // (muxed destinations, protocol ≥ 23) a map { amount, to_muxed_id }.
      const from = decodeAddress(rawTopics[1] ?? "");
      const to = decodeAddress(rawTopics[2] ?? "");
      const amount = typeof data === "string" ? data : str(rec(data).amount);
      if (!from || !to || !amount) return null;
      return { kind: "transfer", payload: { from, to, amount } };
    }
    default:
      return null;
  }
}
