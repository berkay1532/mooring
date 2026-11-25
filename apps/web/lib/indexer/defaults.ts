/** Production wiring for the indexer handlers — kept out of the route files so they stay one-liners. */
import { config } from "../config";
import { createRateLimiter } from "../merchants/ratelimit";
import { lookup as dnsLookup } from "node:dns/promises";

import { closePinned, pinnedDispatcher, pinnedFetch } from "../merchants/pinned";
import { resolveMerchant } from "../merchants/resolve";
import { readContractWasmHash } from "../chain/verify";
import { readInfo } from "../chain/card";
import { getRpcServer } from "../chain/rpc";
import { getSql } from "./db";
import { createIndexerHandlers, type IndexerHandlers } from "./handlers";
import { jsonRpc } from "./rpc";

let memo: IndexerHandlers | null = null;

export function indexerHandlers(): IndexerHandlers {
  if (memo) return memo;
  memo = createIndexerHandlers({
    sql: getSql,
    tick: { rpc: jsonRpc(config.rpcUrl), factory: config.factory, usdc: config.usdc, log: (m, x) => console.warn(m, x ?? "") },
    limiter: createRateLimiter({ limit: 120, windowMs: 60_000 }),
    resolve: (url) =>
      resolveMerchant(url, {
        fetch: pinnedFetch,
        lookup: async (host) => (await dnsLookup(host, { all: true })).map((a) => a.address),
        network: config.network,
        asset: config.usdc,
        allowLocal: process.env.MOORING_RESOLVER_ALLOW_LOCAL === "1",
        userAgent: "mooring-indexer/1.0 (+https://mooring.live)",
        dispatcherFor: pinnedDispatcher,
        closeDispatcher: closePinned,
      }),
    readCard: async (card) => {
      const wasmHash = await readContractWasmHash(getRpcServer(), card);
      if (wasmHash !== config.cardWasmHash) return { wasmHash: wasmHash ?? "", owner: null };
      const info = await readInfo(card);
      return { wasmHash, owner: info.owner };
    },
    cardWasmHash: config.cardWasmHash,
    network: config.network,
    backfill: {
      async fetchJson(u) {
        const res = await fetch(u, { headers: { accept: "application/json" } });
        if (!res.ok) throw new Error(`${u}: HTTP ${res.status}`);
        return res.json();
      },
      log: (m, x) => console.warn(m, x ?? ""),
    },
    cronSecret: process.env.CRON_SECRET,
  });
  return memo;
}
