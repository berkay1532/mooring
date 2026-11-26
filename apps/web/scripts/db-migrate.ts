/** Applies db/schema.sql to DATABASE_URL (idempotent). Usage: npm run db:migrate (loads .env.local) */
import { readFileSync } from "node:fs";

import { neonClient, splitStatements } from "../lib/indexer/db";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = neonClient(url);
  const statements = splitStatements(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
  for (const s of statements) await sql.query(s);
  console.log(`applied ${statements.length} statements`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
