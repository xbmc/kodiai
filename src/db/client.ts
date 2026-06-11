import postgres from "postgres";
import type { Logger } from "pino";

export type Sql = ReturnType<typeof postgres>;

export type DbClient = {
  sql: Sql;
  close(): Promise<void>;
};

/**
 * Create a postgres.js client connected via DATABASE_URL or explicit connection string.
 *
 * Returns a tagged-template `sql` instance and a `close()` function.
 * Throws immediately if no connection string is available.
 */
export function createDbClient(opts: {
  connectionString?: string;
  logger: Logger;
}): DbClient {
  const connectionString =
    opts.connectionString ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL environment variable is not set and no connectionString was provided. " +
        "Set DATABASE_URL or pass connectionString to createDbClient().",
    );
  }

  const poolMaxRaw = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10);
  const poolMax = Number.isFinite(poolMaxRaw) && poolMaxRaw > 0 ? poolMaxRaw : 10;

  const sql = postgres(connectionString, {
    max: poolMax,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  opts.logger.debug("PostgreSQL client created");

  return {
    sql,
    async close() {
      await sql.end();
      opts.logger.debug("PostgreSQL client closed");
    },
  };
}
