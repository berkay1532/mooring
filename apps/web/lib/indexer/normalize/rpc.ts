import type { IndexedEvent } from "../types";
import { classify, decodeScVal, decodeSymbol } from "./common";

/** The subset of a `getEvents` row the normaliser reads (SDK `Api.RawEventResponse` shape). */
export interface RpcEventLike {
  id: string;
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  txHash: string;
  topic: string[];
  value: string;
  type?: string;
}

/** Normalises one RPC event; null for events that are not ours or fail to decode. Never throws. */
export function fromRpcEvent(e: RpcEventLike): IndexedEvent | null {
  try {
    if (e.type && e.type !== "contract") return null;
    const topics = e.topic.map((t) => decodeSymbol(t) ?? "");
    const data = decodeScVal(e.value);
    const hit = classify(topics, e.topic, data);
    if (!hit) return null;
    return {
      eventId: e.id,
      ledger: e.ledger,
      txHash: e.txHash,
      ts: new Date(e.ledgerClosedAt).toISOString(),
      contract: e.contractId,
      kind: hit.kind,
      payload: hit.payload,
    };
  } catch {
    return null;
  }
}
