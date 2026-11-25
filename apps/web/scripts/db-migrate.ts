/** Applies db/schema.sql to DATABASE_URL (idempotent). Usage: npx tsx scripts/db-migrate.ts */
import { readFileSync } from "node:fs";
import path from "node:path";

import { neonClient, splitStatements } from "../lib/indexer/db";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = neonClient(url);
  const statements = splitStatements(readFileSync(path.resolve(__dirname, "../db/schema.sql"), "utf8"));
  for (const s of statements) await sql.query(s);
  console.log(`applied ${statements.length} statements`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
