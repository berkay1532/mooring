/**
 * Minimal JSON-RPC client for the two Stellar RPC methods the indexer polls.
 * It deliberately returns the raw (base64 XDR) event rows: the normaliser decodes
 * them exactly like the stellar.expert rows, and a fake in tests is a plain object.
 */
import type { RpcEventLike } from "./normalize/rpc";

export interface EventFilter {
  type: "contract";
  contractIds?: string[];
  topics?: string[][];
}

export interface GetEventsRequest {
  startLedger?: number;
  endLedger?: number;
  filters: EventFilter[];
  pagination: { limit: number; cursor?: string };
}

export interface GetEventsResponse {
  events: RpcEventLike[];
  cursor: string;
  latestLedger: number;
  oldestLedger: number;
  latestLedgerCloseTime?: string;
}

export interface EventsRpc {
  getEvents(req: GetEventsRequest): Promise<GetEventsResponse>;
  /** `{ sequence, oldestLedger }` from `getHealth` (one call, both bounds). */
  getLedgerBounds(): Promise<{ latest: number; oldest: number }>;
}

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export function jsonRpc(url: string, fetchImpl: typeof fetch = fetch, timeoutMs = 25_000): EventsRpc {
  async function call<T>(method: string, params?: unknown): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new RpcError(`${method}: HTTP ${res.status}`);
      const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
      if (body.error) throw new RpcError(`${method}: ${body.error.message}`, body.error.code);
      if (body.result === undefined) throw new RpcError(`${method}: empty result`);
      return body.result;
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    getEvents: (req) => call<GetEventsResponse>("getEvents", req),
    async getLedgerBounds() {
      const h = await call<{ latestLedger: number; oldestLedger: number }>("getHealth");
      return { latest: h.latestLedger, oldest: h.oldestLedger };
    },
  };
}
