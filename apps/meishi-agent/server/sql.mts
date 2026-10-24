// Storage-neutral async SQL client used by the HTTP API.
// Two implementations: node:sqlite (local/self-hosted, tests) and PostgreSQL (Neon on Vercel,
// PGlite in tests). Queries are written once with `?` placeholders in the SQL subset both engines
// share (ON CONFLICT upserts, RETURNING, CAST(... AS BIGINT)).
// The database only ever holds ciphertext and opaque metadata (see db.mts / pg.mts schemas).

export type Dialect = 'sqlite' | 'postgres';

export interface Sql {
  readonly dialect: Dialect;
  get<T>(text: string, ...params: unknown[]): Promise<T | undefined>;
  all<T>(text: string, ...params: unknown[]): Promise<T[]>;
  /** Returns the number of affected rows. */
  run(text: string, ...params: unknown[]): Promise<number>;
  /**
   * Runs `fn` in one transaction. Inside, use only the `q` handle and do no external I/O
   * (mail, AI, fetch): the SQLite implementation holds the single connection for the duration.
   */
  tx<T>(fn: (q: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** `?` → `$1, $2, …` (none of our statements contain a literal question mark). */
export function toPgParams(text: string): string {
  let i = 0;
  return text.replace(/\?/g, () => `$${++i}`);
}

/** Every row of every application table (tests use this to prove no plaintext is stored). */
export async function dumpAllRows(sql: Sql): Promise<Array<{ table: string; row: Record<string, unknown> }>> {
  const tables =
    sql.dialect === 'sqlite'
      ? await sql.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      : await sql.all<{ name: string }>("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'");
  const out: Array<{ table: string; row: Record<string, unknown> }> = [];
  for (const { name } of tables) {
    if (!/^[a-z_]+$/.test(name)) continue;
    for (const row of await sql.all<Record<string, unknown>>(`SELECT * FROM "${name}"`)) out.push({ table: name, row });
  }
  return out;
}
