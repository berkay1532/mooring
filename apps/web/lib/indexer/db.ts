import { neon } from "@neondatabase/serverless";

/**
 * The only database surface the indexer uses: positional-parameter SQL in,
 * rows out. Production wraps Neon's HTTP driver; tests wrap PGlite (see
 * `test/helpers/pglite.ts`) and run the very same statements.
 */
export interface SqlClient {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export class NoDatabaseError extends Error {
  constructor() {
    super("DATABASE_URL is not set (or MOORING_INDEXER_DISABLED=1); the indexer is off");
    this.name = "NoDatabaseError";
  }
}

export function neonClient(url: string): SqlClient {
  const sql = neon(url);
  return {
    async query<T>(text: string, params: unknown[] = []): Promise<T[]> {
      return (await sql.query(text, params)) as T[];
    },
  };
}

/** True when this process can reach a database; the app degrades to the probe otherwise. */
export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL) && process.env.MOORING_INDEXER_DISABLED !== "1";
}

let memo: SqlClient | null = null;

/** The process-wide client. Throws {@link NoDatabaseError} when there is no database. */
export function getSql(): SqlClient {
  if (!hasDatabase()) throw new NoDatabaseError();
  if (!memo) memo = neonClient(process.env.DATABASE_URL as string);
  return memo;
}

/** Splits `schema.sql` into statements (no `$$` bodies or string semicolons in our schema). */
export function splitStatements(sqlText: string): string[] {
  return sqlText
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter((s) => s.length > 0);
}
