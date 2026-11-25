import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

import { splitStatements, type SqlClient } from "../../lib/indexer/db";

export const SCHEMA_PATH = path.resolve(__dirname, "../../db/schema.sql");

/** A fresh in-memory Postgres with `db/schema.sql` applied, behind the indexer's `SqlClient`. */
export async function testDb(): Promise<SqlClient & { close(): Promise<void>; applySchema(): Promise<void> }> {
  const pg = new PGlite();
  const client = {
    async query<T>(text: string, params: unknown[] = []): Promise<T[]> {
      const r = await pg.query<T>(text, params);
      return r.rows;
    },
    async applySchema() {
      for (const stmt of splitStatements(readFileSync(SCHEMA_PATH, "utf8"))) await pg.exec(stmt);
    },
    async close() {
      await pg.close();
    },
  };
  await client.applySchema();
  return client;
}
