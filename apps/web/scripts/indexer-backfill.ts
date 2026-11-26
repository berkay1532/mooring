/**
 * History import. Usage (from apps/web): `npm run indexer:backfill [-- --card C…]` — loads `.env.local`.
 * Re-running is safe: events are upserted and cards whose label is still unknown get it read on-chain.
 */
import { readInfo } from "../lib/chain/card";
import { backfillCard, backfillFactory, type BackfillDeps } from "../lib/indexer/backfill";
import { neonClient } from "../lib/indexer/db";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const factory = process.env.NEXT_PUBLIC_FACTORY_ADDRESS;
  const usdc = process.env.NEXT_PUBLIC_USDC_SAC;
  if (!factory || !usdc) throw new Error("NEXT_PUBLIC_FACTORY_ADDRESS / NEXT_PUBLIC_USDC_SAC are not set");
  const deps: BackfillDeps = {
    sql: neonClient(url),
    factory,
    usdc,
    readLabel: async (card) => (await readInfo(card)).label || null,
    async fetchJson(u) {
      const res = await fetch(u, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`${u}: HTTP ${res.status}`);
      return res.json();
    },
    log: (msg, extra) => console.log(msg, extra ?? ""),
  };
  const i = process.argv.indexOf("--card");
  const result = i > 0 ? await backfillCard(process.argv[i + 1], deps) : await backfillFactory(deps);
  console.log(JSON.stringify(result));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
