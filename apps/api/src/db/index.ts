import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { PgDatabase } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema";

export { schema };
export type Db = PgDatabase<any, typeof schema>;

export interface DbHandle {
  db: Db;
  close(): Promise<void>;
}

export interface DbOptions {
  /** Postgres real. Si falta, se usa PGlite (Postgres embebido en WASM). */
  databaseUrl?: string;
  /** Directorio de persistencia de PGlite. Si falta, en memoria. */
  pgliteDir?: string;
}

const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function createDb(opts: DbOptions = {}): Promise<DbHandle> {
  if (opts.databaseUrl) {
    // Sin tiempo límite, un host inaccesible dejaría el arranque colgado sin ningún mensaje
    const pool = new pg.Pool({ connectionString: opts.databaseUrl, connectionTimeoutMillis: 15_000 });
    await pool.query("select 1");
    const db = drizzlePg(pool, { schema });
    await migratePg(db, { migrationsFolder: MIGRATIONS });
    return { db, close: () => pool.end() };
  }

  const client = new PGlite(opts.pgliteDir);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS });
  return { db, close: () => client.close() };
}
