import type { IndexedEvent } from "../types";
import { classify, decodeScVal, decodeSymbol } from "./common";

/** One record of stellar.expert's `/explorer/{network}/contract/{id}/events`. */
export interface ExpertRecord {
  id: string;
  ts: number;
  contract: string;
  topicsXdr: string[];
  bodyXdr: string;
  paging_token?: string;
}

/** `id` is `<toid>-<event index>`; the TOID packs ledger, tx order and op index. */
export function toidOf(id: string): bigint {
  return BigInt(id.split("-")[0]);
}

export function ledgerOf(id: string): number {
  return Number(toidOf(id) >> 32n);
}

export function txOrderOf(id: string): number {
  return Number((toidOf(id) >> 12n) & 0xfffffn);
}

/** The TOID of the enclosing transaction, as Horizon prints it in `paging_token`. */
export function txToidOf(id: string): string {
  const t = toidOf(id);
  return (t - (t & 0xfffn)).toString();
}

export function fromExpertRecord(r: ExpertRecord): IndexedEvent | null {
  try {
    const topics = r.topicsXdr.map((t) => decodeSymbol(t) ?? "");
    const data = decodeScVal(r.bodyXdr);
    const hit = classify(topics, r.topicsXdr, data);
    if (!hit) return null;
    return {
      eventId: `se:${r.id}`,
      ledger: ledgerOf(r.id),
      txHash: null,
      ts: new Date(r.ts * 1000).toISOString(),
      contract: r.contract,
      kind: hit.kind,
      payload: hit.payload,
    };
  } catch {
    return null;
  }
}
